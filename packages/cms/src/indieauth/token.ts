import type { Context, Hono } from 'hono';

import { findUserById } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import type { GeekityEnv } from '../env.ts';
import { logTokenRequest, noteActivity } from './activity-log.ts';
import { requireBearer } from './bearer.ts';
import {
  INTROSPECTION_PATH,
  REVOCATION_PATH,
  TOKEN_PATH,
  USERINFO_PATH,
  siteBaseUrl,
} from './discovery.ts';
import { profileResponse, redeemCode, redemptionForm } from './redeem.ts';
import type { RedemptionForm } from './redeem.ts';
import {
  ACCESS_TOKEN_LIFETIME_MS,
  findAccessToken,
  issueTokens,
  refreshTokens,
  revokeToken,
} from './tokens.ts';
import type { IssuedTokens } from './tokens.ts';

/**
 * The token endpoint (TASK-160): a client redeems its code here for a bearer
 * token, or trades a refresh token for a new pair.
 *
 * A code is checked by the same {@link redeemCode} profile redemption uses, so
 * a code spent at one endpoint is spent at both. Outside `/admin`, because the
 * client posting here has no admin session, and not exempt from maintenance
 * mode, like the authorization endpoint beside it.
 */
export function mountTokenEndpoint(app: Hono<GeekityEnv>): void {
  app.post(TOKEN_PATH, logTokenRequest, async (c) => {
    c.header('cache-control', 'no-store');
    const form = redemptionForm(await c.req.parseBody());
    const now = c.var.config.now();

    if (form['grant_type'] === 'refresh_token') {
      const refreshed = await refreshTokens(c.var.config.dataDir, form, now);
      if (!refreshed.ok) return refuse(c, refreshed.error, refreshed.description);
      const user = findUserById(c.var.config.dataDir, refreshed.issued.token.userId);
      if (user === undefined) return refuse(c, 'invalid_grant', GONE);
      return answer(c, refreshed.issued, user);
    }

    const redeemed = redeemCode(c.var.indieauth.codes, form);
    if (!redeemed.ok) return refuse(c, redeemed.error, redeemed.description);
    const { grant } = redeemed;
    if (grant.scopes.length === 0) {
      return refuse(c, 'invalid_grant', 'The code was approved with no scope, so earns no token.');
    }
    if (!sameResource(form, grant.resource)) {
      return refuse(c, 'invalid_target', 'resource must be the one the person approved.');
    }
    const user = findUserById(c.var.config.dataDir, grant.userId);
    if (user === undefined) return refuse(c, 'invalid_grant', GONE);
    return answer(c, await issueTokens(c.var.config.dataDir, grant, now), user);
  });
}

const GONE = 'The person who approved this is gone.';

/** Whether the request names no resource, or the one the code was approved for (RFC 8707). */
function sameResource(form: RedemptionForm, approved: string | undefined): boolean {
  const named = form['resource'];
  return named === undefined || named === approved;
}

function answer(c: Context<GeekityEnv>, issued: IssuedTokens, user: User): Response {
  const { token } = issued;
  noteActivity(c, { user: user.username, scopes: token.scopes });
  return c.json({
    access_token: issued.accessToken,
    token_type: 'Bearer',
    scope: token.scopes.join(' '),
    expires_in: ACCESS_TOKEN_LIFETIME_MS / 1000,
    refresh_token: issued.refreshToken,
    ...profileResponse(token, user, siteBaseUrl(c)),
  });
}

function refuse<E extends GeekityEnv>(c: Context<E>, error: string, description: string): Response {
  return c.json({ error, error_description: description }, 400);
}

/**
 * The endpoints that answer for a token once it is issued (TASK-161):
 * introspection, revocation and userinfo. Outside `/admin` and behind the
 * maintenance gate, like the token endpoint.
 */
export function mountTokenInfoEndpoints(app: Hono<GeekityEnv>): void {
  // RFC 7662. The IndieAuth spec asks that introspection need authorization
  // of its own: here, another live token, and it answers only for tokens held
  // by the same person, so one person's token can never tell anything about
  // another's.
  app.post(INTROSPECTION_PATH, requireBearer({ audience: 'authorization-server' }), async (c) => {
    c.header('cache-control', 'no-store');
    const presented = (await c.req.parseBody())['token'];
    if (typeof presented !== 'string' || presented === '') {
      return refuse(c, 'invalid_request', 'token is required.');
    }
    const token = findAccessToken(c.var.config.dataDir, presented, c.var.config.now());
    if (token === undefined || token.userId !== c.var.bearer.user.id) {
      return c.json({ active: false });
    }
    return c.json({
      active: true,
      me: token.me,
      client_id: token.clientId,
      scope: token.scopes.join(' '),
      exp: Math.floor(Date.parse(token.expiresAt) / 1000),
    });
  });

  // RFC 7009: holding the token is the authorization, and the answer is 200
  // whether or not it was one, so a client learns nothing by guessing.
  app.post(REVOCATION_PATH, async (c) => {
    c.header('cache-control', 'no-store');
    const presented = (await c.req.parseBody())['token'];
    if (typeof presented !== 'string' || presented === '') {
      return refuse(c, 'invalid_request', 'token is required.');
    }
    await revokeToken(c.var.config.dataDir, presented, c.var.config.now());
    return c.body(null, 200);
  });

  app.get(
    USERINFO_PATH,
    requireBearer({ audience: 'authorization-server', scope: 'profile' }),
    (c) => {
      c.header('cache-control', 'no-store');
      const { token, user } = c.var.bearer;
      return c.json(profileResponse(token, user, siteBaseUrl(c)).profile ?? {});
    },
  );
}
