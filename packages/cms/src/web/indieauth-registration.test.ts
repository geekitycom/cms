/**
 * Dynamic client registration: a client such as claude.ai registers itself
 * with no metadata document of its own to host, signs the person in through
 * the consent screen, and reaches the MCP endpoint with the token it gets.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { createUser } from '../site/users.ts';
import type { HostLookup } from '../util/public-address.ts';

const box = sandbox();

const BASE = 'https://blog.example';
const REGISTER = '/_geekity/indieauth/register';
const CONSENT = '/admin/indieauth/consent';
const TOKEN = '/_geekity/indieauth/token';
const MCP = '/_geekity/mcp';
const CALLBACK = 'https://claude.example/api/mcp/auth_callback';

const fetched: string[] = [];
const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  fetched.push(new Request(input).url);
  return Promise.reject(new TypeError('fetch failed'));
}) as typeof fetch;

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
});

const PUBLIC: HostLookup = () => Promise.resolve(['203.0.113.7']);

async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-registration-content-');
  const dataDir = await box.dir('geekity-registration-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', author: 'ada' }),
  );
  await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  return await box.open({ contentDir, dataDir, baseUrl: BASE, hostLookup: PUBLIC });
}

async function register(
  cms: Cms,
  metadata: unknown,
): Promise<{ status: number; headers: Headers; body: Record<string, unknown> }> {
  const response = await cms.app.request(REGISTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** What claude.ai sends when it adds a custom connector. */
const CLAUDE = {
  client_name: 'Claude',
  redirect_uris: [CALLBACK],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  scope: 'inspect',
};

async function registeredId(cms: Cms, metadata: unknown = CLAUDE): Promise<string> {
  const { status, body } = await register(cms, metadata);
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(typeof body['client_id'], 'string');
  return body['client_id'] as string;
}

function authorizationQuery(clientId: string, changes: Record<string, string> = {}): string {
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    state: 'state-1',
    code_challenge: createHash('sha256').update('unused').digest('base64url'),
    code_challenge_method: 'S256',
    scope: 'inspect',
    ...changes,
  }).toString();
}

/** Every file under `dir` with its contents, to tell whether anything was written. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, file)] = (await readFile(file)).toString('base64');
  }
  return files;
}

describe('registering a client', () => {
  it('answers 201 with a client_id on the site and the metadata it registered', async () => {
    const cms = await site();
    const { status, headers, body } = await register(cms, {
      ...CLAUDE,
      client_uri: 'https://claude.example/',
      logo_uri: 'https://claude.example/logo.png',
      token_endpoint_auth_method: 'client_secret_post',
    });

    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(headers.get('cache-control'), 'no-store');
    const { client_id: clientId, client_id_issued_at: issuedAt, ...rest } = body;
    assert.ok(
      typeof clientId === 'string' && clientId.startsWith(`${BASE}/_geekity/indieauth/clients/`),
      String(clientId),
    );
    assert.equal(typeof issuedAt, 'number');
    assert.deepEqual(rest, {
      client_name: 'Claude',
      client_uri: 'https://claude.example/',
      logo_uri: 'https://claude.example/logo.png',
      redirect_uris: [CALLBACK],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('takes an http redirect_uri on a loopback address', async () => {
    const cms = await site();
    const { status } = await register(cms, {
      redirect_uris: ['http://localhost:3000/callback', 'http://127.0.0.1/cb', 'http://[::1]/cb'],
    });
    assert.equal(status, 201);
  });

  for (const [what, metadata, error] of [
    ['no redirect_uris', { client_name: 'Claude' }, 'invalid_redirect_uri'],
    ['an empty redirect_uris', { redirect_uris: [] }, 'invalid_redirect_uri'],
    [
      'a plain http redirect_uri',
      { redirect_uris: ['http://claude.example/cb'] },
      'invalid_redirect_uri',
    ],
    [
      'a redirect_uri with a fragment',
      { redirect_uris: [`${CALLBACK}#x`] },
      'invalid_redirect_uri',
    ],
    [
      'a scripting redirect_uri',
      { redirect_uris: ['javascript:alert(1)'] },
      'invalid_redirect_uri',
    ],
    ['a relative redirect_uri', { redirect_uris: ['/callback'] }, 'invalid_redirect_uri'],
    [
      'more redirect_uris than a client_id holds',
      { redirect_uris: Array.from({ length: 6 }, (_, i) => `${CALLBACK}/${String(i)}`) },
      'invalid_redirect_uri',
    ],
    [
      'an overlong redirect_uri',
      { redirect_uris: [`${CALLBACK}?${'x'.repeat(600)}`] },
      'invalid_redirect_uri',
    ],
    [
      'grant_types without authorization_code',
      { redirect_uris: [CALLBACK], grant_types: ['client_credentials'] },
      'invalid_client_metadata',
    ],
    [
      'a response_type other than code',
      { redirect_uris: [CALLBACK], response_types: ['token'] },
      'invalid_client_metadata',
    ],
    [
      'an overlong client_name',
      { redirect_uris: [CALLBACK], client_name: 'x'.repeat(101) },
      'invalid_client_metadata',
    ],
    [
      'a logo_uri that is not a web URL',
      { redirect_uris: [CALLBACK], logo_uri: 'data:image/png;base64,AAAA' },
      'invalid_client_metadata',
    ],
    ['a body that is not an object', ['https://claude.example/'], 'invalid_client_metadata'],
    ['a body that is not JSON', 'redirect_uris=https://claude.example/', 'invalid_client_metadata'],
  ] as const) {
    it(`refuses ${what} with ${error}`, async () => {
      const cms = await site();
      const { status, headers, body } = await register(cms, metadata);
      assert.equal(status, 400);
      assert.equal(headers.get('cache-control'), 'no-store');
      assert.equal(body['error'], error);
      assert.equal(typeof body['error_description'], 'string');
    });
  }

  it('writes nothing, however many clients register', async () => {
    const cms = await site();
    const before = await snapshot(cms.config.dataDir);
    for (let i = 0; i < 20; i += 1) {
      await registeredId(cms, { ...CLAUDE, client_name: `Claude ${String(i)}` });
    }
    assert.deepEqual(await snapshot(cms.config.dataDir), before);
  });
});

describe('a registered client_id', () => {
  it('serves its client metadata document, naming itself as the client_id', async () => {
    const cms = await site();
    const clientId = await registeredId(cms);
    const response = await cms.app.request(clientId);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    const document = (await response.json()) as Record<string, unknown>;
    assert.equal(document['client_id'], clientId);
    assert.equal(document['client_name'], 'Claude');
    assert.deepEqual(document['redirect_uris'], [CALLBACK]);
  });

  it('is not found when its path holds no registration', async () => {
    const cms = await site();
    const response = await cms.app.request('/_geekity/indieauth/clients/bm90IGpzb24');
    assert.equal(response.status, 404);
  });

  it('is advertised in the authorization server metadata', async () => {
    const cms = await site();
    const response = await cms.app.request('/.well-known/oauth-authorization-server');
    const metadata = (await response.json()) as Record<string, unknown>;
    assert.equal(metadata['registration_endpoint'], `${BASE}${REGISTER}`);
    assert.equal(metadata['client_id_metadata_document_supported'], true);
  });
});

describe('the consent screen for a registered client', () => {
  async function screen(agent: Browser, clientId: string, changes: Record<string, string> = {}) {
    const response = await agent.get(`${CONSENT}?${authorizationQuery(clientId, changes)}`);
    return { status: response.status, html: await response.text() };
  }

  it('shows the registered name and where it returns to, without fetching the site', async () => {
    const cms = await site();
    const clientId = await registeredId(cms);
    fetched.length = 0;
    const { status, html } = await screen(await signIn(cms), clientId);
    assert.equal(status, 200, html);
    assert.match(html, /Sign in to Claude\?/);
    assert.match(html, /claude\.example/);
    assert.match(html, /registered here by the app itself/);
    assert.ok(!html.includes(clientId), 'the screen does not name the app by its id on the site');
    assert.deepEqual(fetched, []);
  });

  it('names a client that registered no name by where it returns to', async () => {
    const cms = await site();
    const clientId = await registeredId(cms, { redirect_uris: [CALLBACK] });
    const { status, html } = await screen(await signIn(cms), clientId);
    assert.equal(status, 200, html);
    assert.match(html, /Sign in to claude\.example\?/);
  });

  for (const [what, redirectUri] of [
    ['an address it did not register', 'https://claude.example/elsewhere'],
    ['an address on the site itself', `${BASE}/admin`],
  ] as const) {
    it(`refuses to send it back to ${what}`, async () => {
      const cms = await site();
      const clientId = await registeredId(cms);
      const { status, html } = await screen(await signIn(cms), clientId, {
        redirect_uri: redirectUri,
      });
      assert.equal(status, 400);
      assert.match(html, /has not published as its own/);
    });
  }

  it('refuses a client_id in the registered space that does not decode', async () => {
    const cms = await site();
    const { status } = await screen(
      await signIn(cms),
      `${BASE}/_geekity/indieauth/clients/bm90IGpzb24`,
      { redirect_uri: `${BASE}/` },
    );
    assert.equal(status, 400);
  });
});

describe('a registered client signing in to the MCP endpoint', () => {
  it('goes from registration through consent and the token endpoint to a tool call', async () => {
    const cms = await site();
    const clientId = await registeredId(cms);
    const resource = `${BASE}${MCP}`;
    const verifier = randomBytes(32).toString('base64url');

    const agent = await signIn(cms);
    const html = await (
      await agent.get(
        `${CONSENT}?${authorizationQuery(clientId, {
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          resource,
          scope: 'profile inspect',
        })}`,
      )
    ).text();
    const approved = await agent.post(CONSENT, [
      ['csrf_token', csrfField(html) ?? ''],
      ['request', /name="request" value="([^"]+)"/.exec(html)?.[1] ?? ''],
      ['decision', 'approve'],
      ['scope', 'profile'],
      ['scope', 'inspect'],
    ]);
    const back = new URL(approved.headers.get('location') ?? '');
    assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
    const code = back.searchParams.get('code');
    assert.ok(code !== null, 'the approval carried a code');

    const tokenRequest = (fields: Record<string, string>) =>
      cms.app.request(TOKEN, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams(fields).toString(),
      });
    const issued = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_verifier: verifier,
      resource,
    });
    const tokens = (await issued.json()) as Record<string, unknown>;
    assert.equal(issued.status, 200, JSON.stringify(tokens));
    assert.equal(tokens['scope'], 'profile inspect');

    const refreshed = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: String(tokens['refresh_token']),
      client_id: clientId,
    });
    const renewed = (await refreshed.json()) as Record<string, unknown>;
    assert.equal(refreshed.status, 200, JSON.stringify(renewed));

    const call = await cms.app.request(MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${String(renewed['access_token'])}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'whoami', arguments: {} },
      }),
    });
    const answer = (await call.json()) as Record<string, unknown>;
    assert.equal(call.status, 200, JSON.stringify(answer));
    assert.equal(answer['error'], undefined, JSON.stringify(answer));
    assert.match(JSON.stringify(answer['result']), /ada/);
  });
});
