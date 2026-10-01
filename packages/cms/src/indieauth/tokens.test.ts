/**
 * The access tokens the token endpoint issues (TASK-160): what is kept of
 * them in `data/`, how long they live, how a refresh rotates them, which
 * resource each is good for, and that they go with the user who holds them.
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { createUser, deleteUser } from '../admin/accounts.ts';
import type { AuthorizationCode } from './grants.ts';
import {
  ACCESS_TOKEN_LIFETIME_MS,
  REFRESH_TOKEN_LIFETIME_MS,
  TOKENS_FILE,
  issueTokens,
  listTokens,
  refreshTokens,
  revokeToken,
  verifyAccessToken,
} from './tokens.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const MICROPUB = { resource: `${BASE}/micropub`, acceptsUnbound: true };
const MCP = { resource: `${BASE}/mcp`, acceptsUnbound: false };
const T0 = new Date('2026-10-01T00:00:00Z');

const GRANT: AuthorizationCode = {
  clientId: 'https://app.example/',
  redirectUri: 'https://app.example/callback',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  userId: 1,
  me: `${BASE}/`,
  scopes: ['create', 'media', 'profile'],
};

function later(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

function refreshForm(refreshToken: string, changes: Record<string, string | undefined> = {}) {
  return {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: GRANT.clientId,
    ...changes,
  };
}

async function dataDir(): Promise<string> {
  return await box.dir('geekity-tokens-data-');
}

describe('issuing a token', () => {
  it('keeps a hash of each token in a 0600 file, never the token itself', async () => {
    const dir = await dataDir();
    const issued = await issueTokens(dir, GRANT, T0);
    const file = path.join(dir, TOKENS_FILE);
    const text = await readFile(file, 'utf8');

    assert.equal(text.includes(issued.accessToken), false, 'no access token in the file');
    assert.equal(text.includes(issued.refreshToken), false, 'no refresh token in the file');
    assert.equal((await stat(file)).mode & 0o777, 0o600);

    const [stored] = listTokens(dir);
    assert.ok(stored !== undefined);
    assert.equal(stored.userId, 1);
    assert.equal(stored.clientId, GRANT.clientId);
    assert.equal(stored.me, GRANT.me);
    assert.deepEqual(stored.scopes, GRANT.scopes);
    assert.equal(stored.issuedAt, T0.toISOString());
    assert.equal(stored.expiresAt, later(ACCESS_TOKEN_LIFETIME_MS).toISOString());
  });

  it('hands out a different token every time', async () => {
    const dir = await dataDir();
    const first = await issueTokens(dir, GRANT, T0);
    const second = await issueTokens(dir, GRANT, T0);
    assert.notEqual(first.accessToken, second.accessToken);
    assert.equal(listTokens(dir).length, 2);
  });
});

describe('verifying a token', () => {
  it('answers what a live token was issued for', async () => {
    const dir = await dataDir();
    const { accessToken } = await issueTokens(dir, GRANT, T0);
    const found = verifyAccessToken(dir, accessToken, MICROPUB, T0);
    assert.equal(found?.userId, 1);
    assert.deepEqual(found.scopes, GRANT.scopes);
  });

  it('refuses a token nobody issued', async () => {
    const dir = await dataDir();
    await issueTokens(dir, GRANT, T0);
    assert.equal(verifyAccessToken(dir, 'made-up', MICROPUB, T0), undefined);
  });

  it('refuses a token once it has expired', async () => {
    const dir = await dataDir();
    const { accessToken } = await issueTokens(dir, GRANT, T0);
    assert.ok(verifyAccessToken(dir, accessToken, MICROPUB, later(ACCESS_TOKEN_LIFETIME_MS - 1)));
    assert.equal(
      verifyAccessToken(dir, accessToken, MICROPUB, later(ACCESS_TOKEN_LIFETIME_MS)),
      undefined,
    );
  });

  it('refuses a refresh token offered as an access token', async () => {
    const dir = await dataDir();
    const { refreshToken } = await issueTokens(dir, GRANT, T0);
    assert.equal(verifyAccessToken(dir, refreshToken, MICROPUB, T0), undefined);
  });
});

describe('the resource a token is bound to', () => {
  it('is good at the resource it was issued for and refused at another', async () => {
    const dir = await dataDir();
    const { accessToken } = await issueTokens(dir, { ...GRANT, resource: MCP.resource }, T0);
    assert.ok(verifyAccessToken(dir, accessToken, MCP, T0), 'the MCP endpoint takes it');
    assert.equal(
      verifyAccessToken(dir, accessToken, MICROPUB, T0),
      undefined,
      'the Micropub endpoint refuses a token issued for MCP',
    );
  });

  it('is good only where unbound tokens are accepted when none was named', async () => {
    const dir = await dataDir();
    const { accessToken } = await issueTokens(dir, GRANT, T0);
    assert.ok(verifyAccessToken(dir, accessToken, MICROPUB, T0), 'Micropub clients name none');
    assert.equal(verifyAccessToken(dir, accessToken, MCP, T0), undefined);
  });
});

describe('refreshing a token', () => {
  it('rotates both tokens, and the old ones stop working', async () => {
    const dir = await dataDir();
    const old = await issueTokens(dir, GRANT, T0);
    const refreshed = await refreshTokens(dir, refreshForm(old.refreshToken), later(1000));
    assert.ok(refreshed.ok);
    const { issued } = refreshed;

    assert.notEqual(issued.accessToken, old.accessToken);
    assert.notEqual(issued.refreshToken, old.refreshToken);
    assert.equal(verifyAccessToken(dir, old.accessToken, MICROPUB, later(1000)), undefined);
    assert.ok(verifyAccessToken(dir, issued.accessToken, MICROPUB, later(1000)));
    assert.equal(
      (await refreshTokens(dir, refreshForm(old.refreshToken), later(2000))).ok,
      false,
      'a spent refresh token is refused',
    );
    assert.equal(listTokens(dir).length, 1, 'the connection is the same one');
    assert.equal(listTokens(dir)[0]?.issuedAt, T0.toISOString(), 'and keeps when it was made');
    assert.equal(issued.token.expiresAt, later(1000 + ACCESS_TOKEN_LIFETIME_MS).toISOString());
  });

  it('keeps the scopes and the resource the person approved', async () => {
    const dir = await dataDir();
    const old = await issueTokens(dir, { ...GRANT, resource: MCP.resource }, T0);
    const refreshed = await refreshTokens(dir, refreshForm(old.refreshToken), T0);
    assert.ok(refreshed.ok);
    assert.deepEqual(refreshed.issued.token.scopes, GRANT.scopes);
    assert.ok(verifyAccessToken(dir, refreshed.issued.accessToken, MCP, T0));
  });

  it('refuses a refresh from another client, and the token still works for its own', async () => {
    const dir = await dataDir();
    const old = await issueTokens(dir, GRANT, T0);
    const refused = await refreshTokens(
      dir,
      refreshForm(old.refreshToken, { client_id: 'https://other.example/' }),
      T0,
    );
    assert.equal(!refused.ok && refused.error, 'invalid_grant');
  });

  it('refuses a refresh token that has expired', async () => {
    const dir = await dataDir();
    const old = await issueTokens(dir, GRANT, T0);
    const refused = await refreshTokens(
      dir,
      refreshForm(old.refreshToken),
      later(REFRESH_TOKEN_LIFETIME_MS),
    );
    assert.equal(!refused.ok && refused.error, 'invalid_grant');
  });

  it('writes nothing for a refresh token nobody issued', async () => {
    const dir = await dataDir();
    const refused = await refreshTokens(dir, refreshForm('made-up'), T0);
    assert.equal(!refused.ok && refused.error, 'invalid_grant');
    await assert.rejects(stat(path.join(dir, TOKENS_FILE)), { code: 'ENOENT' });
  });

  it('refuses a request missing the refresh token or client_id', async () => {
    const dir = await dataDir();
    const old = await issueTokens(dir, GRANT, T0);
    for (const missing of ['refresh_token', 'client_id']) {
      const refused = await refreshTokens(
        dir,
        refreshForm(old.refreshToken, { [missing]: undefined }),
        T0,
      );
      assert.equal(!refused.ok && refused.error, 'invalid_request', missing);
    }
  });

  it('forgets a connection whose refresh token has expired the next time it writes', async () => {
    const dir = await dataDir();
    await issueTokens(dir, GRANT, T0);
    await issueTokens(dir, GRANT, later(REFRESH_TOKEN_LIFETIME_MS));
    assert.equal(listTokens(dir).length, 1);
  });
});

describe('revoking a token', () => {
  for (const which of ['accessToken', 'refreshToken'] as const) {
    it(`ends the connection when handed its ${which === 'accessToken' ? 'access' : 'refresh'} token`, async () => {
      const dir = await dataDir();
      const issued = await issueTokens(dir, GRANT, T0);
      const other = await issueTokens(dir, GRANT, T0);

      assert.equal(await revokeToken(dir, issued[which], T0), true);

      assert.equal(verifyAccessToken(dir, issued.accessToken, MICROPUB, T0), undefined);
      const refreshed = await refreshTokens(dir, refreshForm(issued.refreshToken), T0);
      assert.equal(refreshed.ok, false);
      assert.deepEqual(
        listTokens(dir).map((token) => token.id),
        [other.token.id],
      );
    });
  }

  it('writes nothing for a token nobody issued', async () => {
    const dir = await dataDir();
    assert.equal(await revokeToken(dir, 'made-up', T0), false);
    await assert.rejects(stat(path.join(dir, TOKENS_FILE)), { code: 'ENOENT' });
  });
});

describe('deleting a user', () => {
  it('revokes every token they hold and nobody else’s', async () => {
    const dir = await dataDir();
    const ada = await createUser({ dataDir: dir, username: 'ada', password: 'correct horse b' });
    const bob = await createUser({ dataDir: dir, username: 'bob', password: 'another horse b' });
    const adas = [
      await issueTokens(dir, { ...GRANT, userId: ada.id }, T0),
      await issueTokens(dir, { ...GRANT, userId: ada.id, resource: MCP.resource }, T0),
    ];
    const bobs = await issueTokens(dir, { ...GRANT, userId: bob.id }, T0);

    await deleteUser({ dataDir: dir, userId: ada.id });

    for (const issued of adas) {
      assert.equal(verifyAccessToken(dir, issued.accessToken, MICROPUB, T0), undefined);
      assert.equal(verifyAccessToken(dir, issued.accessToken, MCP, T0), undefined);
      const refreshed = await refreshTokens(
        dir,
        {
          grant_type: 'refresh_token',
          refresh_token: issued.refreshToken,
          client_id: GRANT.clientId,
        },
        T0,
      );
      assert.equal(refreshed.ok, false);
    }
    assert.ok(verifyAccessToken(dir, bobs.accessToken, MICROPUB, T0));
    assert.deepEqual(
      listTokens(dir).map((token) => token.userId),
      [bob.id],
    );
  });
});
