/**
 * The bearer-token guard in front of an API route (TASK-161): what a route
 * behind it is handed for a good token, and what a client is told for a bad
 * one, including where to go to find out how to get a good one.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { Hono } from 'hono';

import { sandbox } from '../admin/__testing__/harness.ts';
import { createUser } from '../admin/accounts.ts';
import type { GeekityEnv } from '../env.ts';
import type { Cms } from '../index.ts';
import { requireBearer } from './bearer.ts';
import type { Guard } from './bearer.ts';
import type { AuthorizationCode } from './grants.ts';
import { ACCESS_TOKEN_LIFETIME_MS, issueTokens, revokeToken } from './tokens.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const RESOURCE_METADATA = `${BASE}/.well-known/oauth-protected-resource`;
const MICROPUB = { resource: `${BASE}/micropub`, acceptsUnbound: true };

interface Site {
  cms: Cms;
  grant: AuthorizationCode;
}

async function site(): Promise<Site> {
  const cms = await box.site({ baseUrl: BASE });
  const ada = await createUser({
    dataDir: cms.config.dataDir,
    username: 'ada',
    password: 'correct horse battery',
  });
  const grant: AuthorizationCode = {
    clientId: 'https://app.example/',
    redirectUri: 'https://app.example/callback',
    codeChallenge: 'unused',
    userId: ada.id,
    me: `${BASE}/author/ada/`,
    scopes: ['create', 'media'],
  };
  return { cms, grant };
}

/** An app with one route behind `guard` that answers who it was handed. */
function guarded(cms: Cms, guard: Guard): Hono<GeekityEnv> {
  const app = new Hono<GeekityEnv>();
  app.use('*', async (c, next) => {
    c.set('config', cms.config);
    await next();
  });
  app.post('/thing', requireBearer(guard), (c) =>
    c.json({ username: c.var.bearer.user.username, scopes: c.var.bearer.token.scopes }),
  );
  return app;
}

function withHeader(token: string, body = ''): RequestInit {
  return {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  };
}

describe('a route behind the bearer guard', () => {
  it('is handed the user and the granted scopes for a token in the header', async () => {
    const { cms, grant } = await site();
    const { accessToken } = await issueTokens(cms.config.dataDir, grant, new Date());
    const response = await guarded(cms, { audience: MICROPUB }).request(
      '/thing',
      withHeader(accessToken),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { username: 'ada', scopes: ['create', 'media'] });
  });

  it('takes the token from an access_token form field, as Micropub allows', async () => {
    const { cms, grant } = await site();
    const { accessToken } = await issueTokens(cms.config.dataDir, grant, new Date());
    const response = await guarded(cms, { audience: MICROPUB }).request('/thing', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ h: 'entry', access_token: accessToken }).toString(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { username: 'ada', scopes: ['create', 'media'] });
  });

  it('lets the route require a scope the token holds', async () => {
    const { cms, grant } = await site();
    const { accessToken } = await issueTokens(cms.config.dataDir, grant, new Date());
    const response = await guarded(cms, { audience: MICROPUB, scope: 'media' }).request(
      '/thing',
      withHeader(accessToken),
    );
    assert.equal(response.status, 200);
  });

  it('answers 401 with no error and points at the resource metadata when no token came', async () => {
    const { cms } = await site();
    const response = await guarded(cms, { audience: MICROPUB }).request('/thing', {
      method: 'POST',
    });
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get('www-authenticate'),
      `Bearer resource_metadata="${RESOURCE_METADATA}"`,
    );
    assert.equal(((await response.json()) as { error: string }).error, 'unauthorized');
  });

  const refusals: [string, (site: Site) => Promise<string>][] = [
    ['an unknown token', () => Promise.resolve('made-up')],
    [
      'an expired token',
      async ({ cms, grant }) =>
        (
          await issueTokens(
            cms.config.dataDir,
            grant,
            new Date(Date.now() - ACCESS_TOKEN_LIFETIME_MS - 1000),
          )
        ).accessToken,
    ],
    [
      'a revoked token',
      async ({ cms, grant }) => {
        const { accessToken } = await issueTokens(cms.config.dataDir, grant, new Date());
        await revokeToken(cms.config.dataDir, accessToken, new Date());
        return accessToken;
      },
    ],
    [
      'a token bound to another resource',
      async ({ cms, grant }) =>
        (await issueTokens(cms.config.dataDir, { ...grant, resource: `${BASE}/mcp` }, new Date()))
          .accessToken,
    ],
    [
      'a refresh token',
      async ({ cms, grant }) =>
        (await issueTokens(cms.config.dataDir, grant, new Date())).refreshToken,
    ],
  ];
  for (const [what, token] of refusals) {
    it(`answers 401 invalid_token for ${what}`, async () => {
      const current = await site();
      const response = await guarded(current.cms, { audience: MICROPUB }).request(
        '/thing',
        withHeader(await token(current)),
      );
      assert.equal(response.status, 401);
      assert.equal(
        response.headers.get('www-authenticate'),
        `Bearer error="invalid_token", resource_metadata="${RESOURCE_METADATA}"`,
      );
      assert.equal(((await response.json()) as { error: string }).error, 'invalid_token');
    });
  }

  it('answers 403 insufficient_scope, naming the scope, for a token without it', async () => {
    const { cms, grant } = await site();
    const { accessToken } = await issueTokens(cms.config.dataDir, grant, new Date());
    const response = await guarded(cms, { audience: MICROPUB, scope: 'delete' }).request(
      '/thing',
      withHeader(accessToken),
    );
    assert.equal(response.status, 403);
    assert.equal(
      response.headers.get('www-authenticate'),
      `Bearer error="insufficient_scope", scope="delete", resource_metadata="${RESOURCE_METADATA}"`,
    );
    assert.deepEqual(((await response.json()) as { error: string }).error, 'insufficient_scope');
  });
});
