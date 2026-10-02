/**
 * The log of recent IndieAuth and Micropub requests (TASK-221): what a client
 * sent to the authorization, token, Micropub and media endpoints, what it was
 * answered, and the admin screen that shows it.
 *
 * Everything goes through HTTP, because the question is what a real request
 * leaves behind in the stored file and on the screen.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it, mock } from 'node:test';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { findUser } from '../admin/accounts.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';
import {
  ACTIVITY_LOG_FILE,
  ACTIVITY_LOG_LIMIT,
  ACTIVITY_LOG_MAX_AGE_MS,
  readActivityLog,
} from './activity-log.ts';
import type { ActivityEntry } from './activity-log.ts';
import type { Scope } from './request.ts';
import { issueTokens } from './tokens.ts';

const box = sandbox();

const BASE = 'https://blog.example';
const APP = 'https://app.example/';
const CALLBACK = `${APP}callback`;
const CONSENT = '/admin/indieauth/consent';
const TOKEN = '/_geekity/indieauth/token';
const MICROPUB = '/_geekity/micropub';
const MEDIA = '/_geekity/micropub/media';
const SCREEN = '/admin/users/activity';
// RFC 7636's example pair, so a code can be redeemed for real.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

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
  dataDir: string;
  agent: Browser;
  /** Move the site's clock. */
  setNow: (instant: Date) => void;
  /** A live access token for the signed-in admin, granted `scopes`. */
  token: (scopes: Scope[]) => Promise<string>;
}

async function site(): Promise<Site> {
  const contentDir = await box.dir('geekity-activity-content-');
  const dataDir = await box.dir('geekity-activity-data-');
  let now = new Date('2026-10-02T12:00:00.000Z');
  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE,
    hostLookup: PUBLIC,
    now: () => now,
  });
  const agent = await signedIn(cms);
  return {
    cms,
    dataDir,
    agent,
    setNow(instant) {
      now = instant;
    },
    async token(scopes) {
      const ada = findUser(dataDir, 'ada');
      assert.ok(ada !== undefined);
      const issued = await issueTokens(
        dataDir,
        {
          clientId: APP,
          redirectUri: CALLBACK,
          codeChallenge: 'unused',
          userId: ada.id,
          me: `${BASE}/`,
          scopes,
        },
        now,
      );
      return issued.accessToken;
    },
  };
}

function authorizationQuery(changes: Record<string, string | undefined> = {}): string {
  const fields: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: APP,
    redirect_uri: CALLBACK,
    state: 'state-1',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    scope: 'create update',
    me: `${BASE}/`,
    ...changes,
  };
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) params.set(name, value);
  }
  return params.toString();
}

async function micropubJson(cms: Cms, token: string, body: unknown): Promise<Response> {
  return await cms.app.request(MICROPUB, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The one entry the log holds, newest first, after every queued write has landed. */
async function latest(dataDir: string): Promise<ActivityEntry> {
  const [entry] = await readActivityLog(dataDir);
  assert.ok(entry !== undefined, 'the request was logged');
  return entry;
}

describe('an authorization request', () => {
  it('is logged with the client, the user, the requested scopes and the PKCE refusal', async () => {
    const { agent, dataDir } = await site();
    const response = await agent.get(
      `${CONSENT}?${authorizationQuery({
        code_challenge: undefined,
        code_challenge_method: undefined,
        scope: 'create update delete undelete',
      })}`,
    );
    assert.equal(response.status, 302);

    const entry = await latest(dataDir);
    assert.equal(entry.endpoint, 'authorization');
    assert.equal(entry.action, 'request');
    assert.equal(entry.method, 'GET');
    assert.equal(entry.clientId, APP);
    assert.equal(entry.user, 'ada');
    assert.equal(entry.status, 302);
    assert.equal(entry.error, 'invalid_request');
    assert.equal(entry.errorDescription, 'code_challenge must be an S256 PKCE challenge');
    assert.ok(entry.endpoint === 'authorization' && entry.action === 'request');
    assert.equal(entry.pkce, false);
    assert.deepEqual(entry.scopes, ['create', 'update', 'delete', 'undelete']);
    assert.match(entry.at, /^2026-10-02T12:00:00/);
  });

  it('says an S256 challenge was present when it was, and records no error on success', async () => {
    const { agent, dataDir } = await site();
    assert.equal((await agent.get(`${CONSENT}?${authorizationQuery()}`)).status, 200);

    const entry = await latest(dataDir);
    assert.ok(entry.endpoint === 'authorization' && entry.action === 'request');
    assert.equal(entry.pkce, true);
    assert.deepEqual(entry.scopes, ['create', 'update']);
    assert.equal(entry.status, 200);
    assert.equal(entry.error, undefined);
  });

  it('records why a request with no address to answer at was refused', async () => {
    const { agent, dataDir } = await site();
    const response = await agent.get(`${CONSENT}?${authorizationQuery({ client_id: undefined })}`);
    assert.equal(response.status, 400);

    const entry = await latest(dataDir);
    assert.equal(entry.status, 400);
    assert.equal(entry.error, 'invalid_request');
    assert.equal(entry.errorDescription, 'The app did not say which app it is.');
  });
});

describe('the token endpoint', () => {
  it('logs a refused redemption with its error and the client', async () => {
    const { cms, dataDir } = await site();
    const response = await cms.app.request(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'not-a-code',
        client_id: APP,
        redirect_uri: CALLBACK,
        code_verifier: VERIFIER,
      }).toString(),
    });
    assert.equal(response.status, 400);

    const entry = await latest(dataDir);
    assert.equal(entry.endpoint, 'token');
    assert.equal(entry.action, 'authorization_code');
    assert.equal(entry.clientId, APP);
    assert.equal(entry.status, 400);
    assert.equal(entry.error, 'invalid_grant');
    assert.equal(entry.errorDescription, 'The code is unknown, expired or already used.');
  });
});

describe('the Micropub endpoint', () => {
  it('logs a refused create with the properties it carried, long values cut short', async () => {
    const { cms, dataDir, token } = await site();
    const response = await micropubJson(cms, await token(['create']), {
      type: ['h-entry'],
      properties: { content: ['x'.repeat(1000)], visibility: ['private'] },
    });
    assert.equal(response.status, 400);

    const entry = await latest(dataDir);
    assert.equal(entry.endpoint, 'micropub');
    assert.equal(entry.action, 'create');
    assert.equal(entry.method, 'POST');
    assert.equal(entry.clientId, APP);
    assert.equal(entry.user, 'ada');
    assert.equal(entry.error, 'invalid_request');
    assert.match(entry.errorDescription ?? '', /visibility/);
    const carried = Object.fromEntries(
      entry.carried.map((field) => [field.name, 'value' in field ? field.value : field]),
    );
    assert.equal(carried['visibility'], 'private');
    const content = carried['content'];
    assert.ok(typeof content === 'string');
    assert.ok(content.length < 200, `content was cut to ${String(content.length)} characters`);
    assert.ok(content.startsWith('xxxx') && content.endsWith('…'));
  });

  it('logs a file part as its name, type and size, never its bytes', async () => {
    const { cms, dataDir, token } = await site();
    const form = new FormData();
    form.set('h', 'entry');
    form.set('content', 'With a photo');
    form.set('photo', new File([new Uint8Array(37)], 'cat.gif', { type: 'image/gif' }));
    await cms.app.request(MICROPUB, {
      method: 'POST',
      headers: { authorization: `Bearer ${await token(['create'])}` },
      body: form,
    });

    const entry = await latest(dataDir);
    assert.deepEqual(
      entry.carried.find((field) => field.name === 'photo'),
      { name: 'photo', file: { filename: 'cat.gif', type: 'image/gif', size: 37 } },
    );
    assert.ok(entry.carried.some((field) => 'value' in field && field.value === 'With a photo'));
  });

  it('logs a query, and the bearer guard’s refusals', async () => {
    const { cms, dataDir, token } = await site();
    const live = await token(['update']);

    await cms.app.request(`${MICROPUB}?q=config`, { headers: { authorization: `Bearer ${live}` } });
    const query = await latest(dataDir);
    assert.equal(query.action, 'q=config');
    assert.equal(query.status, 200);

    await cms.app.request(`${MICROPUB}?q=config`);
    const anonymous = await latest(dataDir);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.error, 'unauthorized');
    assert.equal(anonymous.user, undefined);

    await micropubJson(cms, live, { type: ['h-entry'], properties: { content: ['Hi'] } });
    const unscoped = await latest(dataDir);
    assert.equal(unscoped.status, 403);
    assert.equal(unscoped.error, 'insufficient_scope');
    assert.equal(unscoped.user, 'ada');
  });
});

describe('the media endpoint', () => {
  it('logs an upload as the file part, and a refusal before the token is read', async () => {
    const { cms, dataDir, token } = await site();
    const body = new FormData();
    body.set(
      'file',
      new File([new Uint8Array(12)], 'tool.exe', { type: 'application/octet-stream' }),
    );
    const refused = await cms.app.request(MEDIA, {
      method: 'POST',
      headers: { authorization: `Bearer ${await token(['media'])}` },
      body,
    });
    assert.equal(refused.status, 400);

    const entry = await latest(dataDir);
    assert.equal(entry.endpoint, 'media');
    assert.equal(entry.action, 'upload');
    assert.equal(entry.user, 'ada');
    assert.equal(entry.error, 'invalid_request');
    assert.deepEqual(entry.carried, [
      { name: 'file', file: { filename: 'tool.exe', type: 'application/octet-stream', size: 12 } },
    ]);

    const huge = await cms.app.request(MEDIA, {
      method: 'POST',
      headers: { 'content-length': String(10 * 1024 * 1024 * 1024), 'content-type': 'image/png' },
      body: 'tiny',
    });
    assert.equal(huge.status, 400);
    const early = await latest(dataDir);
    assert.equal(early.endpoint, 'media');
    assert.equal(early.status, 400);
    assert.match(early.errorDescription ?? '', /too big/);
  });
});

describe('what the log never keeps', () => {
  it('holds no token, code, verifier, secret, password or cookie a client sent or was sent', async () => {
    const { cms, agent, dataDir } = await site();

    // A real sign-in, so the code, the verifier and both tokens are real.
    const screen = await agent.get(`${CONSENT}?${authorizationQuery()}`);
    const html = await screen.text();
    const approved = await agent.post(CONSENT, [
      ['csrf_token', csrfField(html) ?? ''],
      ['request', /name="request" value="([^"]+)"/.exec(html)?.[1] ?? ''],
      ['decision', 'approve'],
      ['scope', 'create'],
      ['scope', 'update'],
    ]);
    const code = new URL(approved.headers.get('location') ?? '').searchParams.get('code') ?? '';
    assert.ok(code !== '', 'the sign-in was approved');

    const CLIENT_SECRET = 'client-secret-6b1f0e';
    const issued = await cms.app.request(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: APP,
        redirect_uri: CALLBACK,
        code_verifier: VERIFIER,
        client_secret: CLIENT_SECRET,
      }).toString(),
    });
    assert.equal(issued.status, 200);
    const tokens = (await issued.json()) as { access_token: string; refresh_token: string };
    const signedIn = await latest(dataDir);
    assert.equal(signedIn.endpoint, 'token');
    assert.equal(signedIn.user, 'ada');
    assert.ok(signedIn.endpoint === 'token');
    assert.deepEqual(signedIn.scopes, ['create', 'update']);

    const PASSWORD = 'hunter2-password-c0ffee';
    const COOKIE = 'session-cookie-9d8e7f';
    // The token in the body, as Micropub allows, a password field, and a cookie.
    await cms.app.request(MICROPUB, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `s=${COOKIE}` },
      body: new URLSearchParams({
        h: 'entry',
        content: 'Hello',
        access_token: tokens.access_token,
        password: PASSWORD,
      }).toString(),
    });
    // The token in the header, and secrets nested in a JSON body.
    await micropubJson(cms, tokens.access_token, {
      type: ['h-entry'],
      properties: { content: ['Hello'], password: [PASSWORD] },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    const refreshed = await cms.app.request(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: APP,
      }).toString(),
    });
    assert.equal(refreshed.status, 200);
    const renewed = (await refreshed.json()) as { access_token: string; refresh_token: string };

    const entries = await readActivityLog(dataDir);
    assert.deepEqual(
      entries.map((entry) => `${entry.endpoint} ${entry.action}`),
      [
        'token refresh_token',
        'micropub create',
        'micropub create',
        'token authorization_code',
        'authorization request',
      ],
      'every request was logged',
    );
    const raw = await readFile(path.join(dataDir, ACTIVITY_LOG_FILE), 'utf8');
    const secrets = {
      'authorization code': code,
      code_verifier: VERIFIER,
      'access token': tokens.access_token,
      'refresh token': tokens.refresh_token,
      'renewed access token': renewed.access_token,
      'renewed refresh token': renewed.refresh_token,
      client_secret: CLIENT_SECRET,
      password: PASSWORD,
      cookie: COOKIE,
    };
    for (const [name, secret] of Object.entries(secrets)) {
      assert.ok(secret.length > 8, `${name} is a real value`);
      assert.ok(!raw.includes(secret), `the log holds the ${name}`);
    }
  });
});

describe('the stored log', () => {
  it('is private to the site’s user', async () => {
    const { cms, dataDir, token } = await site();
    await cms.app.request(`${MICROPUB}?q=config`, {
      headers: { authorization: `Bearer ${await token([])}` },
    });
    await readActivityLog(dataDir);
    const { mode } = await stat(path.join(dataDir, ACTIVITY_LOG_FILE));
    assert.equal(mode & 0o777, 0o600);
  });

  it('keeps a bounded number of entries, newest first', async () => {
    const { cms, dataDir, token } = await site();
    const live = await token([]);
    for (let index = 0; index < ACTIVITY_LOG_LIMIT + 3; index += 1) {
      await cms.app.request(`${MICROPUB}?q=source&url=${String(index)}`, {
        headers: { authorization: `Bearer ${live}` },
      });
    }
    const entries = await readActivityLog(dataDir);
    assert.equal(entries.length, ACTIVITY_LOG_LIMIT);
    const url = (entry: ActivityEntry | undefined) =>
      entry?.carried.find((field) => field.name === 'url');
    assert.deepEqual(url(entries[0]), { name: 'url', value: String(ACTIVITY_LOG_LIMIT + 2) });
    assert.deepEqual(url(entries.at(-1)), { name: 'url', value: '3' });
  });

  it('drops entries older than the age limit', async () => {
    const { cms, dataDir, token, setNow } = await site();
    const live = await token([]);
    await cms.app.request(`${MICROPUB}?q=config`, { headers: { authorization: `Bearer ${live}` } });
    setNow(new Date(Date.parse('2026-10-02T12:00:00.000Z') + ACTIVITY_LOG_MAX_AGE_MS + 1000));
    await cms.app.request(`${MICROPUB}?q=bogus`, { headers: { authorization: `Bearer ${live}` } });

    const entries = await readActivityLog(dataDir);
    assert.deepEqual(
      entries.map((entry) => entry.action),
      ['q=bogus'],
    );
  });

  it('answers the request as usual when the log cannot be written', async () => {
    const { cms, dataDir, token } = await site();
    const live = await token([]);
    const expected = await cms.app.request(`${MICROPUB}?q=config`, {
      headers: { authorization: `Bearer ${live}` },
    });
    const body = await expected.text();
    await readActivityLog(dataDir);

    // A directory where the file should be: every write fails.
    const file = path.join(dataDir, ACTIVITY_LOG_FILE);
    await rm(file);
    await mkdir(file);
    const warn = mock.method(console, 'warn', () => undefined);
    try {
      const response = await cms.app.request(`${MICROPUB}?q=config`, {
        headers: { authorization: `Bearer ${live}` },
      });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), body);
      await readActivityLog(dataDir).catch(() => []);
      assert.ok(
        warn.mock.calls.some((call) => String(call.arguments[0]).includes('activity log')),
        'the failure was reported',
      );
    } finally {
      warn.mock.restore();
    }
  });
});

describe('Users > App activity', () => {
  it('lists recent entries newest first, marks failures, filters to them, and shows one in full', async () => {
    const { cms, agent, dataDir, token } = await site();
    const live = await token(['create']);
    await cms.app.request(`${MICROPUB}?q=config`, { headers: { authorization: `Bearer ${live}` } });
    await micropubJson(cms, live, {
      type: ['h-entry'],
      properties: { content: ['Hello'], visibility: ['private'] },
    });
    await readActivityLog(dataDir);

    const list = await agent.get(SCREEN);
    assert.equal(list.status, 200);
    const html = await list.text();
    assert.match(html, /<h1>App activity<\/h1>/);
    const create = html.indexOf('>create<');
    const config = html.indexOf('>q=config<');
    assert.ok(create > 0 && config > 0, 'both requests are listed');
    assert.ok(create < config, 'the newest is first');
    assert.match(html, /admin-status-failed[^>]*>Refused/);

    const failures = await (await agent.get(`${SCREEN}?show=failures`)).text();
    assert.ok(failures.includes('>create<'));
    assert.ok(!failures.includes('>q=config<'), 'a success is filtered out');

    const [newest] = await readActivityLog(dataDir);
    assert.ok(newest !== undefined);
    const detail = await agent.get(`${SCREEN}/${newest.id}`);
    assert.equal(detail.status, 200);
    const full = await detail.text();
    assert.match(full, /This endpoint does not understand visibility\./);
    assert.match(full, /visibility/);
    assert.match(full, /private/);
    assert.match(full, new RegExp(APP.replaceAll('.', '\\.')));

    assert.equal((await agent.get(`${SCREEN}/no-such-entry`)).status, 404);
  });

  it('is only for a signed-in admin', async () => {
    const { cms } = await site();
    const response = await cms.app.request(SCREEN);
    assert.equal(response.status, 302);
  });
});
