/**
 * The token endpoint (TASK-160): a client that approved Micropub scopes
 * redeems its code for a bearer token, refreshes it, and keeps it across a
 * deleted database.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signIn } from '../admin/__testing__/harness.ts';
import { createUser } from '../admin/accounts.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';
import { ACCESS_TOKEN_LIFETIME_MS, verifyAccessToken } from './tokens.ts';

const box = sandbox();

const BASE = 'https://blog.example';
const APP = 'https://app.example/';
const CALLBACK = `${APP}callback`;
const CONSENT = '/admin/indieauth/consent';
const TOKEN = '/_geekity/indieauth/token';
const MICROPUB = { resource: `${BASE}/micropub`, acceptsUnbound: true };

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  if (new Request(input).url !== APP) return Promise.reject(new TypeError('fetch failed'));
  return Promise.resolve(
    new Response('<div class="h-app"><a class="u-url p-name" href="/">Quill</a></div>', {
      headers: { 'content-type': 'text/html' },
    }),
  );
}) as typeof fetch;

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
});

const PUBLIC: HostLookup = () => Promise.resolve(['203.0.113.7']);

interface Site {
  cms: Cms;
  contentDir: string;
  dataDir: string;
}

async function site(config: { maintenance?: boolean } = {}): Promise<Site> {
  const contentDir = await box.dir('geekity-token-content-');
  const dataDir = await box.dir('geekity-token-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', author: 'ada' }),
  );
  await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  const cms = await box.open({ contentDir, dataDir, baseUrl: BASE, hostLookup: PUBLIC, ...config });
  return { cms, contentDir, dataDir };
}

/** Approve a request for `scopes` as ada, and answer the code and its verifier. */
async function approved(
  cms: Cms,
  scopes: string[],
  extra: Record<string, string> = {},
): Promise<{ code: string; verifier: string }> {
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: APP,
    redirect_uri: CALLBACK,
    state: 'state-1',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    scope: scopes.join(' '),
    me: `${BASE}/`,
    ...extra,
  });
  const agent = await signIn(cms);
  const html = await (await agent.get(`${CONSENT}?${query.toString()}`)).text();
  const response = await agent.post(CONSENT, [
    ['csrf_token', csrfField(html) ?? ''],
    ['request', /name="request" value="([^"]+)"/.exec(html)?.[1] ?? ''],
    ['decision', 'approve'],
    ...scopes.map((scope): [string, string] => ['scope', scope]),
  ]);
  const code = new URL(response.headers.get('location') ?? '').searchParams.get('code');
  assert.ok(code !== null, 'the approval carried a code');
  return { code, verifier };
}

async function post(
  cms: Cms,
  pathname: string,
  fields: Record<string, string | undefined>,
): Promise<{ status: number; headers: Headers; body: Record<string, unknown> }> {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) body.set(name, value);
  }
  const response = await cms.app.request(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function redemption(
  granted: { code: string; verifier: string },
  changes: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    grant_type: 'authorization_code',
    code: granted.code,
    client_id: APP,
    redirect_uri: CALLBACK,
    code_verifier: granted.verifier,
    ...changes,
  };
}

describe('redeeming a code at the token endpoint', () => {
  it('answers a bearer token with its scope, me, lifetime and the profile', async () => {
    const { cms, dataDir } = await site();
    const answer = await post(cms, TOKEN, redemption(await approved(cms, ['create', 'profile'])));

    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.headers.get('cache-control'), 'no-store');
    const { access_token: accessToken, refresh_token: refreshToken, ...rest } = answer.body;
    assert.equal(typeof accessToken, 'string');
    assert.equal(typeof refreshToken, 'string');
    assert.deepEqual(rest, {
      token_type: 'Bearer',
      scope: 'create profile',
      expires_in: ACCESS_TOKEN_LIFETIME_MS / 1000,
      me: `${BASE}/`,
      profile: { name: 'ada', url: `${BASE}/` },
    });
    assert.equal(
      verifyAccessToken(dataDir, String(accessToken), MICROPUB, new Date())?.userId,
      1,
      'the token it answered is one the site will accept',
    );
  });

  it('leaves the profile out when that scope was not granted', async () => {
    const { cms } = await site();
    const answer = await post(cms, TOKEN, redemption(await approved(cms, ['create', 'media'])));
    assert.equal(answer.body['scope'], 'create media');
    assert.equal(answer.body['me'], `${BASE}/`);
    assert.equal(answer.body['profile'], undefined);
  });

  it('issues no token for a code approved with no scope', async () => {
    const { cms } = await site();
    const answer = await post(cms, TOKEN, redemption(await approved(cms, [])));
    assert.equal(answer.status, 400);
    assert.equal(answer.body['error'], 'invalid_grant');
    assert.equal(answer.body['access_token'], undefined);
  });

  it('refuses a replayed code with invalid_grant', async () => {
    const { cms } = await site();
    const granted = await approved(cms, ['create']);
    assert.equal((await post(cms, TOKEN, redemption(granted))).status, 200);
    const replayed = await post(cms, TOKEN, redemption(granted));
    assert.equal(replayed.status, 400);
    assert.equal(replayed.body['error'], 'invalid_grant');
  });

  it('spends a code redeemed for the profile, so the token endpoint refuses it', async () => {
    const { cms } = await site();
    const granted = await approved(cms, ['create']);
    assert.equal((await post(cms, '/_geekity/indieauth/auth', redemption(granted))).status, 200);
    const answer = await post(cms, TOKEN, redemption(granted));
    assert.equal(answer.body['error'], 'invalid_grant');
  });

  for (const [what, changes, error] of [
    ['a wrong code_verifier', { code_verifier: 'x'.repeat(43) }, 'invalid_grant'],
    ['another client_id', { client_id: 'https://other.example/' }, 'invalid_grant'],
    ['another redirect_uri', { redirect_uri: `${APP}elsewhere` }, 'invalid_grant'],
    ['no code_verifier', { code_verifier: undefined }, 'invalid_request'],
    ['an unknown grant_type', { grant_type: 'password' }, 'unsupported_grant_type'],
  ] as const) {
    it(`refuses ${what} with ${error}`, async () => {
      const { cms } = await site();
      const answer = await post(cms, TOKEN, redemption(await approved(cms, ['create']), changes));
      assert.equal(answer.status, 400);
      assert.equal(answer.body['error'], error);
    });
  }

  it('binds the token to the resource the person approved, and refuses another', async () => {
    const { cms, dataDir } = await site();
    const mcp = `${BASE}/mcp`;
    const refused = await post(
      cms,
      TOKEN,
      redemption(await approved(cms, ['create'], { resource: mcp }), {
        resource: `${BASE}/micropub`,
      }),
    );
    assert.equal(refused.status, 400);
    assert.equal(refused.body['error'], 'invalid_target');

    const answer = await post(
      cms,
      TOKEN,
      redemption(await approved(cms, ['create'], { resource: mcp }), { resource: mcp }),
    );
    const token = String(answer.body['access_token']);
    const now = new Date();
    assert.ok(verifyAccessToken(dataDir, token, { resource: mcp, acceptsUnbound: false }, now));
    assert.equal(verifyAccessToken(dataDir, token, MICROPUB, now), undefined);
  });

  it('is down in maintenance mode', async () => {
    const { cms } = await site({ maintenance: true });
    const response = await cms.app.request(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=x',
    });
    assert.equal(response.status, 503);
  });
});

describe('refreshing at the token endpoint', () => {
  it('rotates the token, and the old access and refresh tokens stop working', async () => {
    const { cms, dataDir } = await site();
    const first = await post(cms, TOKEN, redemption(await approved(cms, ['create', 'profile'])));
    const refresh = (refreshToken: unknown) =>
      post(cms, TOKEN, {
        grant_type: 'refresh_token',
        refresh_token: String(refreshToken),
        client_id: APP,
      });

    const second = await refresh(first.body['refresh_token']);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body['token_type'], 'Bearer');
    assert.equal(second.body['scope'], 'create profile');
    assert.equal(second.body['me'], `${BASE}/`);
    assert.deepEqual(second.body['profile'], { name: 'ada', url: `${BASE}/` });
    assert.notEqual(second.body['access_token'], first.body['access_token']);

    const now = new Date();
    assert.equal(
      verifyAccessToken(dataDir, String(first.body['access_token']), MICROPUB, now),
      undefined,
    );
    assert.ok(verifyAccessToken(dataDir, String(second.body['access_token']), MICROPUB, now));
    const again = await refresh(first.body['refresh_token']);
    assert.equal(again.status, 400);
    assert.equal(again.body['error'], 'invalid_grant');
  });
});

describe('a token across a deleted database', () => {
  it('still works after geekity.db is deleted and the site boots again', async () => {
    const { cms, contentDir, dataDir } = await site();
    const issued = await post(cms, TOKEN, redemption(await approved(cms, ['create'])));
    await cms.close();
    await rm(path.join(dataDir, 'geekity.db'));

    const reopened = await box.open({ contentDir, dataDir, baseUrl: BASE, hostLookup: PUBLIC });
    const token = String(issued.body['access_token']);
    assert.equal(verifyAccessToken(dataDir, token, MICROPUB, new Date())?.userId, 1);
    const refreshed = await post(reopened, TOKEN, {
      grant_type: 'refresh_token',
      refresh_token: String(issued.body['refresh_token']),
      client_id: APP,
    });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  });
});

describe('the consent screen', () => {
  it('offers each Micropub scope by what it lets the app do', async () => {
    const { cms } = await site();
    const agent = await signIn(cms);
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: APP,
      redirect_uri: CALLBACK,
      state: 's',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      scope: 'create update delete media',
    });
    const html = await (await agent.get(`${CONSENT}?${query.toString()}`)).text();
    for (const scope of ['create', 'update', 'delete', 'media']) {
      assert.match(html, new RegExp(`<input[^>]*name="scope"[^>]*value="${scope}"[^>]*checked`));
    }
    assert.match(html, /Create posts/);
    assert.match(html, /Upload media/);
  });
});
