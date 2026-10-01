/**
 * The authorization server's endpoints for a token it has issued (TASK-161):
 * introspection, which says what a token is good for; revocation, which ends
 * it; and userinfo, which answers the profile it was approved to see.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { createUser, setUserProfile } from '../admin/accounts.ts';
import type { Cms } from '../index.ts';
import type { AuthorizationCode } from './grants.ts';
import type { Scope } from './request.ts';
import { ACCESS_TOKEN_LIFETIME_MS, issueTokens, listTokens } from './tokens.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const INTROSPECT = '/_geekity/indieauth/introspect';
const REVOKE = '/_geekity/indieauth/revoke';
const USERINFO = '/_geekity/indieauth/userinfo';
const RESOURCE_METADATA = `${BASE}/.well-known/oauth-protected-resource`;

interface Site {
  cms: Cms;
  dataDir: string;
  /** Issue a token to ada, or to bob, for `scopes`. */
  issue: (scopes: Scope[], options?: { who?: 'ada' | 'bob'; at?: Date }) => Promise<string>;
}

async function site(config: { maintenance?: boolean } = {}): Promise<Site> {
  const cms = await box.site({ baseUrl: BASE, ...config });
  const { dataDir } = cms.config;
  const ada = await createUser({
    dataDir,
    username: 'ada',
    email: 'ada@blog.example',
    password: 'correct horse battery',
  });
  await setUserProfile({
    dataDir,
    userId: ada.id,
    profile: { displayName: 'Ada Lovelace', avatar: '/uploads/2026/09/ada.png' },
  });
  const bob = await createUser({ dataDir, username: 'bob', password: 'another horse battery' });
  return {
    cms,
    dataDir,
    async issue(scopes, { who = 'ada', at = new Date() } = {}) {
      const grant: AuthorizationCode = {
        clientId: 'https://app.example/',
        redirectUri: 'https://app.example/callback',
        codeChallenge: 'unused',
        userId: who === 'ada' ? ada.id : bob.id,
        me: `${BASE}/author/${who}/`,
        scopes,
      };
      return (await issueTokens(dataDir, grant, at)).accessToken;
    },
  };
}

async function post(
  cms: Cms,
  pathname: string,
  fields: Record<string, string>,
  authorization?: string,
): Promise<Response> {
  return await cms.app.request(pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      ...(authorization === undefined ? {} : { authorization: `Bearer ${authorization}` }),
    },
    body: new URLSearchParams(fields).toString(),
  });
}

async function introspect(
  cms: Cms,
  token: string,
  authorization: string,
): Promise<Record<string, unknown>> {
  const response = await post(cms, INTROSPECT, { token }, authorization);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return (await response.json()) as Record<string, unknown>;
}

describe('the introspection endpoint', () => {
  it('answers active, me, client_id, scope and exp for a live token', async () => {
    const { cms, dataDir, issue } = await site();
    const token = await issue(['create', 'media']);
    const record = listTokens(dataDir)[0];
    assert.deepEqual(await introspect(cms, token, token), {
      active: true,
      me: `${BASE}/author/ada/`,
      client_id: 'https://app.example/',
      scope: 'create media',
      exp: Math.floor(Date.parse(record?.expiresAt ?? '') / 1000),
    });
  });

  it('answers another live token of the same person as well as its own', async () => {
    const { cms, issue } = await site();
    const token = await issue(['create']);
    const resourceServer = await issue(['update']);
    assert.equal((await introspect(cms, token, resourceServer))['active'], true);
  });

  it('answers only active false for a token that is unknown or expired', async () => {
    const { cms, issue } = await site();
    const authorization = await issue(['create']);
    const expired = await issue(['create'], {
      at: new Date(Date.now() - ACCESS_TOKEN_LIFETIME_MS - 1000),
    });
    assert.deepEqual(await introspect(cms, 'made-up', authorization), { active: false });
    assert.deepEqual(await introspect(cms, expired, authorization), { active: false });
  });

  it('answers active false for somebody else’s token', async () => {
    const { cms, issue } = await site();
    const bobs = await issue(['create'], { who: 'bob' });
    assert.deepEqual(await introspect(cms, bobs, await issue(['create'])), { active: false });
  });

  it('requires a token of its own, and says so with 401', async () => {
    const { cms, issue } = await site();
    const token = await issue(['create']);
    for (const authorization of [undefined, 'made-up']) {
      const response = await post(cms, INTROSPECT, { token }, authorization);
      assert.equal(response.status, 401);
      assert.match(response.headers.get('www-authenticate') ?? '', /^Bearer /);
      assert.equal('active' in ((await response.json()) as object), false);
    }
  });

  it('refuses a request naming no token with invalid_request', async () => {
    const { cms, issue } = await site();
    const response = await post(cms, INTROSPECT, {}, await issue(['create']));
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { error: string }).error, 'invalid_request');
  });
});

describe('the revocation endpoint', () => {
  it('revokes a token so introspection and the bearer guard refuse it at once', async () => {
    const { cms, issue } = await site();
    const token = await issue(['profile']);
    const other = await issue(['create']);
    assert.equal((await cms.app.request(USERINFO, bearer(token))).status, 200);

    const response = await post(cms, REVOKE, { token });

    assert.equal(response.status, 200);
    assert.deepEqual(await introspect(cms, token, other), { active: false });
    const refused = await cms.app.request(USERINFO, bearer(token));
    assert.equal(refused.status, 401);
    assert.equal((await introspect(cms, other, other))['active'], true, 'others are untouched');
  });

  it('answers 200 for a token it does not know, as RFC 7009 asks', async () => {
    const { cms } = await site();
    assert.equal((await post(cms, REVOKE, { token: 'made-up' })).status, 200);
  });

  it('refuses a request naming no token with invalid_request', async () => {
    const { cms } = await site();
    const response = await post(cms, REVOKE, {});
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { error: string }).error, 'invalid_request');
  });
});

function bearer(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } };
}

describe('the userinfo endpoint', () => {
  it('answers the name, url and photo for the profile scope', async () => {
    const { cms, issue } = await site();
    const response = await cms.app.request(USERINFO, bearer(await issue(['profile'])));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      name: 'Ada Lovelace',
      url: `${BASE}/author/ada/`,
      photo: `${BASE}/uploads/2026/09/ada.png`,
    });
  });

  it('adds the email for the email scope', async () => {
    const { cms, issue } = await site();
    const response = await cms.app.request(USERINFO, bearer(await issue(['profile', 'email'])));
    assert.equal(((await response.json()) as { email: string }).email, 'ada@blog.example');
  });

  it('answers 403 insufficient_scope for a token without the profile scope', async () => {
    const { cms, issue } = await site();
    const response = await cms.app.request(USERINFO, bearer(await issue(['create', 'email'])));
    assert.equal(response.status, 403);
    assert.equal(
      response.headers.get('www-authenticate'),
      `Bearer error="insufficient_scope", scope="profile", resource_metadata="${RESOURCE_METADATA}"`,
    );
  });

  it('answers 401 without a token', async () => {
    const { cms } = await site();
    const response = await cms.app.request(USERINFO);
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get('www-authenticate'),
      `Bearer resource_metadata="${RESOURCE_METADATA}"`,
    );
  });
});

describe('in maintenance mode', () => {
  for (const [pathname, method] of [
    [INTROSPECT, 'POST'],
    [REVOKE, 'POST'],
    [USERINFO, 'GET'],
    ['/.well-known/oauth-protected-resource', 'GET'],
  ] as const) {
    it(`${pathname} is down`, async () => {
      const { cms } = await site({ maintenance: true });
      const response = await cms.app.request(pathname, {
        method,
        headers: { accept: 'application/json' },
      });
      assert.equal(response.status, 503);
    });
  }
});
