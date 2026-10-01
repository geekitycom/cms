import type { Context, MiddlewareHandler } from 'hono';

import { findUserById } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import type { GeekityEnv } from '../env.ts';
import { PROTECTED_RESOURCE_METADATA_PATH, siteBaseUrl } from './discovery.ts';
import type { Scope } from './request.ts';
import { findAccessToken, verifyAccessToken } from './tokens.ts';
import type { Audience, StoredToken } from './tokens.ts';

/**
 * What a route asks of a token (TASK-161).
 *
 * `audience` is the resource server checking it, which decides whether a
 * token bound to a resource, or bound to none, is good here (decision-24).
 * The authorization server's own endpoints, introspection and userinfo, take
 * any live token it issued, wherever the token is bound.
 */
export interface Guard {
  readonly audience: Audience | 'authorization-server';
  /** The scope the route needs, when it needs one. */
  readonly scope?: Scope;
}

/** What a guarded route is handed: the connection and the person behind it. */
export interface Bearer {
  readonly token: StoredToken;
  readonly user: User;
}

export interface BearerEnv {
  Variables: GeekityEnv['Variables'] & { bearer: Bearer };
}

/**
 * Turn the access token on a request into the user and scopes it grants, and
 * refuse the request when it has none, a bad one, or one without `scope`.
 *
 * The token comes from an `Authorization: Bearer` header or, as Micropub
 * allows, an `access_token` field of a form body. A refusal carries
 * `WWW-Authenticate: Bearer` naming the protected resource metadata (RFC
 * 9728), which is how an MCP client finds out where to sign in.
 */
export function requireBearer(guard: Guard): MiddlewareHandler<BearerEnv> {
  return async (c, next) => {
    const { config } = c.var;
    const presented = await presentedToken(c);
    if (presented === undefined) {
      return refuse(c, 401, 'unauthorized', 'An access token is required.', {});
    }

    const now = config.now();
    const token =
      guard.audience === 'authorization-server'
        ? findAccessToken(config.dataDir, presented, now)
        : verifyAccessToken(config.dataDir, presented, guard.audience, now);
    const user = token === undefined ? undefined : findUserById(config.dataDir, token.userId);
    if (token === undefined || user === undefined) {
      const description = 'The access token is unknown, expired, revoked or not for this resource.';
      return refuse(c, 401, 'invalid_token', description, { error: 'invalid_token' });
    }

    if (guard.scope !== undefined && !token.scopes.includes(guard.scope)) {
      const description = `The access token was not granted the ${guard.scope} scope.`;
      return refuse(c, 403, 'insufficient_scope', description, {
        error: 'insufficient_scope',
        scope: guard.scope,
      });
    }

    c.set('bearer', { token, user });
    await next();
  };
}

async function presentedToken(c: Context): Promise<string | undefined> {
  const header = /^Bearer +(\S+)$/i.exec(c.req.header('authorization') ?? '');
  if (header !== null) return header[1];
  const type = c.req.header('content-type') ?? '';
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(type)) {
    return undefined;
  }
  const field = (await c.req.parseBody())['access_token'];
  return typeof field === 'string' && field !== '' ? field : undefined;
}

function refuse(
  c: Context<BearerEnv>,
  status: 401 | 403,
  error: string,
  description: string,
  params: Readonly<Record<string, string>>,
): Response {
  const challenge = Object.entries({
    ...params,
    resource_metadata: `${siteBaseUrl(c)}${PROTECTED_RESOURCE_METADATA_PATH}`,
  })
    .map(([name, value]) => `${name}="${value}"`)
    .join(', ');
  c.header('www-authenticate', `Bearer ${challenge}`);
  c.header('cache-control', 'no-store');
  return c.json({ error, error_description: description }, status);
}
