import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { createUser } from '../admin/accounts.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';
import { readActivityLog } from './activity-log.ts';

const box = sandbox();

const BASE = 'https://blog.example';
const CONSENT = '/admin/indieauth/consent';
const AUTH = '/_geekity/indieauth/auth';
const TOKEN = '/_geekity/indieauth/token';
const REFUSED = 'code_challenge must be an S256 PKCE challenge';

const IA_WRITER = 'https://ia.net/writer';
const IA_REDIRECT = 'https://ia.net/writer/indieauth/redirect';
const ELSEWHERE = 'https://elsewhere.example/cb';
const PLAIN_HTTP = 'http://ia.net/writer/cb';

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  if (new URL(new Request(input).url).host !== 'ia.net') return original(input);
  return Promise.resolve(
    new Response(
      `<link rel="redirect_uri" href="${ELSEWHERE}"><link rel="redirect_uri" href="${PLAIN_HTTP}">
      <div class="h-app"><span class="p-name">iA Writer</span></div>`,
      { headers: { 'content-type': 'text/html' } },
    ),
  );
}) as typeof fetch;

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
});

const PUBLIC: HostLookup = () => Promise.resolve(['203.0.113.7']);

async function site(clientsWithoutPkce: string[] = [IA_WRITER]): Promise<Cms & { agent: Browser }> {
  const contentDir = await box.dir('geekity-nopkce-content-');
  const dataDir = await box.dir('geekity-nopkce-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', author: 'ada', clientsWithoutPkce }),
  );
  await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  const cms = await box.open({ contentDir, dataDir, baseUrl: BASE, hostLookup: PUBLIC });
  return Object.assign(cms, { agent: await signIn(cms) });
}

function iaWriterQuery(changes: Record<string, string | undefined> = {}): string {
  const fields: Record<string, string | undefined> = {
    response_type: 'code',
    me: `${BASE}/`,
    client_id: IA_WRITER,
    redirect_uri: IA_REDIRECT,
    state: '6f1c0a52-8d0e-4c4e-9f43-1d6f2b7a9e10',
    scope: 'create media',
    ...changes,
  };
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) params.set(name, value);
  }
  return params.toString();
}

async function approve(cms: Cms & { agent: Browser }, query: string): Promise<string> {
  const html = await (await cms.agent.get(`${CONSENT}?${query}`)).text();
  const response = await cms.agent.post(CONSENT, [
    ['csrf_token', csrfField(html) ?? ''],
    ['request', /name="request" value="([^"]+)"/.exec(html)?.[1] ?? ''],
    ['decision', 'approve'],
    ['scope', 'create'],
    ['scope', 'media'],
  ]);
  const code = new URL(response.headers.get('location') ?? '').searchParams.get('code');
  assert.ok(code !== null, 'the approval carried a code');
  return code;
}

async function post(
  cms: Cms,
  pathname: string,
  fields: Record<string, string | undefined>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) body.set(name, value);
  }
  const response = await cms.app.request(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function redemption(code: string, changes: Record<string, string | undefined> = {}) {
  return {
    grant_type: 'authorization_code',
    code,
    client_id: IA_WRITER,
    redirect_uri: IA_REDIRECT,
    ...changes,
  };
}

describe('a listed app signing in without PKCE', () => {
  it('reaches the consent screen, which says the app does not use PKCE', async () => {
    const cms = await site();
    const response = await cms.agent.get(`${CONSENT}?${iaWriterQuery()}`);
    const html = await response.text();
    assert.equal(response.status, 200, html);
    assert.match(html, /Sign in to iA Writer\?/);
    assert.match(html, /does not use PKCE/);
    assert.match(html, /only because it is on your list of apps allowed without PKCE/);
  });

  it('earns a code the token endpoint redeems without a code_verifier', async () => {
    const cms = await site();
    const code = await approve(cms, iaWriterQuery());
    const answer = await post(cms, TOKEN, redemption(code));
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body['scope'], 'create media');
    assert.equal(answer.body['me'], `${BASE}/`);
    assert.equal(typeof answer.body['access_token'], 'string');
  });

  it('earns a code profile redemption accepts without a code_verifier', async () => {
    const cms = await site();
    const code = await approve(cms, iaWriterQuery());
    const answer = await post(cms, AUTH, redemption(code));
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body['me'], `${BASE}/`);
  });

  it('is shown in App activity as allowed without PKCE because it is listed', async () => {
    const cms = await site();
    await cms.agent.get(`${CONSENT}?${iaWriterQuery()}`);
    const [entry] = await readActivityLog(cms.config.dataDir);
    assert.ok(entry?.endpoint === 'authorization' && entry.action === 'request');
    assert.equal(entry.pkce, false);
    assert.equal(entry.allowedWithoutPkce, true);

    const page = await (await cms.agent.get(`/admin/users/activity/${entry.id}`)).text();
    assert.match(page, /Allowed without PKCE: the app is on your list/);
  });
});

describe('a request without PKCE that the list does not cover', () => {
  for (const [what, list, changes] of [
    ['an app that is not listed', [], {}],
    ['a listed app sending you back to another host', [IA_WRITER], { redirect_uri: ELSEWHERE }],
    ['a listed app sending you back over http', [IA_WRITER], { redirect_uri: PLAIN_HTTP }],
  ] as const) {
    it(`is refused as before for ${what}`, async () => {
      const cms = await site([...list]);
      const response = await cms.agent.get(`${CONSENT}?${iaWriterQuery(changes)}`);
      assert.equal(response.status, 302, await response.clone().text());
      const location = new URL(response.headers.get('location') ?? '');
      assert.equal(location.searchParams.get('error'), 'invalid_request');
      assert.equal(location.searchParams.get('error_description'), REFUSED);
      const [entry] = await readActivityLog(cms.config.dataDir);
      assert.ok(entry?.endpoint === 'authorization' && entry.action === 'request');
      assert.equal(entry.allowedWithoutPkce, undefined);
    });
  }
});

describe('a listed app that does use PKCE', () => {
  async function pkceCode(
    cms: Cms & { agent: Browser },
  ): Promise<{ code: string; verifier: string }> {
    const verifier = randomBytes(32).toString('base64url');
    const code = await approve(
      cms,
      iaWriterQuery({
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }),
    );
    return { code, verifier };
  }

  it('is not told on the consent screen that it skips PKCE', async () => {
    const cms = await site();
    const html = await (
      await cms.agent.get(
        `${CONSENT}?${iaWriterQuery({
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
        })}`,
      )
    ).text();
    assert.doesNotMatch(html, /does not use PKCE/);
  });

  for (const [endpoint, pathname] of [
    ['token', TOKEN],
    ['authorization', AUTH],
  ] as const) {
    it(`cannot drop the verifier at the ${endpoint} endpoint, and the attempt spends the code`, async () => {
      const cms = await site();
      const { code, verifier } = await pkceCode(cms);
      const downgraded = await post(cms, pathname, redemption(code));
      assert.equal(downgraded.status, 400);
      assert.equal(downgraded.body['error'], 'invalid_request');

      const retried = await post(cms, pathname, redemption(code, { code_verifier: verifier }));
      assert.equal(retried.body['error'], 'invalid_grant', 'the code was spent');
    });

    it(`is refused a wrong verifier at the ${endpoint} endpoint`, async () => {
      const cms = await site();
      const { code } = await pkceCode(cms);
      const answer = await post(cms, pathname, redemption(code, { code_verifier: 'x'.repeat(43) }));
      assert.equal(answer.body['error'], 'invalid_grant');
    });

    it(`still redeems with the right verifier at the ${endpoint} endpoint`, async () => {
      const cms = await site();
      const { code, verifier } = await pkceCode(cms);
      const answer = await post(cms, pathname, redemption(code, { code_verifier: verifier }));
      assert.equal(answer.status, 200, JSON.stringify(answer.body));
    });
  }
});
