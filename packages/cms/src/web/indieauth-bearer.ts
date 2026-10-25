import type { Context, MiddlewareHandler } from 'hono';

import type { GeekityEnv } from './env.ts';
import { findUserById } from '../site/users.ts';
import type { User } from '../site/users.ts';
import { PROTECTED_RESOURCE_METADATA_PATH } from './indieauth-discovery.ts';
import type { Scope } from '../indieauth/request.ts';
import { findAccessToken, recordUse, verifyAccessToken } from '../indieauth/tokens.ts';
import type { Audience, StoredToken } from '../indieauth/tokens.ts';

/**
 * What a route asks of a token.
 *
 * `audience` is the resource server checking it, which decides whether a
 * token bound to a resource, or bound to none, is good here.
 * The authorization server's own endpoints, introspection and userinfo, take
 * any live token it issued, wherever the token is bound.
 */
export interface Guard {
  readonly audience: Audience | 'authorization-server';
  readonly scopes?: Scopes;
  readonly insufficientScopeStatus?: InsufficientScopeStatus;
  /**
   * Where a refused client reads the protected resource metadata, for a
   * resource server with its own identifier. Defaults to the site's.
   */
  readonly resourceMetadataPath?: string;
}

export type InsufficientScopeStatus = 401 | 403;

export type Scopes = readonly [Scope, ...Scope[]];

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
 * refuse the request when it has none, a bad one, or one without any of
 * `scopes`.
 *
 * The token comes from an `Authorization: Bearer` header or, as Micropub
 * allows, an `access_token` field of a form body. A refusal carries
 * `WWW-Authenticate: Bearer` naming the protected resource metadata (RFC
 * 9728), which is how an MCP client finds out where to sign in.
 */
export function requireBearer(guard: Guard): MiddlewareHandler<BearerEnv> {
  return async (c, next) => {
    const { config } = c.var;
    const refuse = (
      status: 400 | 401 | 403,
      error: string,
      description: string,
      params: Readonly<Record<string, string>>,
    ): Response => refusal(c, status, error, description, params, guard.resourceMetadataPath);
    const { tokens, unreadableBody } = await presentedTokens(c);
    if (tokens.size > 1) {
      const description = 'The header and the body carry different access tokens.';
      return refuse(400, 'invalid_request', description, { error: 'invalid_request' });
    }
    const [presented] = tokens;
    if (presented === undefined && unreadableBody) {
      const description = 'The form body could not be read, so no access token was found.';
      return refuse(400, 'invalid_request', description, { error: 'invalid_request' });
    }
    if (presented === undefined) {
      return refuse(401, 'unauthorized', 'An access token is required.', {});
    }

    const now = config.now();
    const token =
      guard.audience === 'authorization-server'
        ? findAccessToken(config.dataDir, presented, now)
        : verifyAccessToken(config.dataDir, presented, guard.audience, now);
    const user = token === undefined ? undefined : findUserById(config.dataDir, token.userId);
    if (token === undefined || user === undefined) {
      const description = 'The access token is unknown, expired, revoked or not for this resource.';
      return refuse(401, 'invalid_token', description, { error: 'invalid_token' });
    }

    if (guard.scopes !== undefined && !guard.scopes.some((scope) => token.scopes.includes(scope))) {
      return insufficientScope(
        c,
        guard.scopes,
        guard.insufficientScopeStatus ?? 403,
        guard.resourceMetadataPath,
      );
    }

    await recordUse(config.dataDir, token, now);
    c.set('bearer', { token, user });
    await next();
  };
}

/**
 * The refusal of a token that lacks every one of `scopes`, for a route that
 * only learns which scope it needs from the request, as a Micropub POST does
 * from its action.
 */
export function insufficientScope(
  c: Context<BearerEnv>,
  scopes: Scopes,
  status: InsufficientScopeStatus,
  resourceMetadataPath?: string,
): Response {
  const description = `The access token was not granted the ${scopes.join(' or ')} scope.`;
  return refusal(
    c,
    status,
    'insufficient_scope',
    description,
    { error: 'insufficient_scope', scope: scopes.join(' ') },
    resourceMetadataPath,
  );
}

/**
 * A `WWW-Authenticate: Bearer` challenge with `params`, naming the protected
 * resource metadata at `resourceMetadataPath` (RFC 9728), the site's own by
 * default.
 */
export function bearerChallenge(
  baseUrl: string,
  params: Readonly<Record<string, string>>,
  resourceMetadataPath = PROTECTED_RESOURCE_METADATA_PATH,
): string {
  const challenge = Object.entries({
    ...params,
    resource_metadata: `${baseUrl}${resourceMetadataPath}`,
  })
    .map(([name, value]) => `${name}="${value}"`)
    .join(', ');
  return `Bearer ${challenge}`;
}

/**
 * RFC 6750 section 3.1 says a client sends one token, but Quill sends the same
 * token in the header and a form body for servers that drop the header, so
 * only two different tokens are refused.
 */
async function presentedTokens(
  c: Context,
): Promise<{ tokens: Set<string>; unreadableBody: boolean }> {
  const tokens = new Set<string>();
  const header = /^Bearer +(\S+)$/i.exec(c.req.header('authorization') ?? '');
  if (header?.[1] !== undefined) tokens.add(header[1]);
  const type = c.req.header('content-type') ?? '';
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(type)) {
    return { tokens, unreadableBody: false };
  }
  try {
    const field = (await c.req.parseBody())['access_token'];
    if (typeof field === 'string' && field !== '') tokens.add(field);
    return { tokens, unreadableBody: false };
  } catch {
    return { tokens, unreadableBody: true };
  }
}

function refusal(
  c: Context<BearerEnv>,
  status: 400 | 401 | 403,
  error: string,
  description: string,
  params: Readonly<Record<string, string>>,
  resourceMetadataPath: string | undefined,
): Response {
  c.header('www-authenticate', bearerChallenge(c.var.config.baseUrl, params, resourceMetadataPath));
  c.header('cache-control', 'no-store');
  return c.json({ error, error_description: description }, status);
}
