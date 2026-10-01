/**
 * Signing in to another site as this one, end to end (TASK-159): a client
 * speaking HTTP to the running app, from the URL the person types through
 * discovery, login, consent and redemption.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cookieValue, csrfField, sandbox } from '../admin/__testing__/harness.ts';
import { createUser } from '../admin/accounts.ts';
import { sessionCookieName } from '../admin/session.ts';
import type { HostLookup } from '../webmention/public-address.ts';

const box = sandbox();

const APP = 'https://app.example/';
const CALLBACK = `${APP}callback`;

const original = globalThis.fetch;
// The client's own page is the one thing off this machine; everything else is
// a real request to the running app.
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  if (new Request(input).url === APP) {
    return Promise.resolve(
      new Response('<div class="h-app"><a class="u-url p-name" href="/">Quill</a></div>', {
        headers: { 'content-type': 'text/html' },
      }),
    );
  }
  return original(input, init);
}) as typeof fetch;

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
});

const PUBLIC: HostLookup = () => Promise.resolve(['203.0.113.7']);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.ok(address !== null && typeof address === 'object');
  return address.port;
}

/** The `rel="indieauth-metadata"` URL a page's `Link` header names. */
function metadataLink(response: Response): string | undefined {
  return /<([^>]+)>;\s*rel="indieauth-metadata"/.exec(response.headers.get('link') ?? '')?.[1];
}

async function discover(url: string): Promise<{ issuer: string; authorization_endpoint: string }> {
  const page = await fetch(url);
  assert.equal(page.status, 200, `${url} answers`);
  const link = metadataLink(page);
  assert.ok(link !== undefined, `${url} advertises its metadata`);
  return (await (await fetch(link)).json()) as { issuer: string; authorization_endpoint: string };
}

describe('a client signing a person in with their own site', () => {
  it('goes from the typed URL through consent to a redeemed me on the same host', async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${String(port)}`;
    const contentDir = await box.dir('geekity-sign-in-content-');
    const dataDir = await box.dir('geekity-sign-in-data-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'A Site', author: 'ada', soloAuthor: true }),
    );
    await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
    const cms = await box.open({ contentDir, dataDir, baseUrl: base, port, hostLookup: PUBLIC });
    await cms.serve();

    const cookieName = sessionCookieName(cms.config);
    let session = '';
    const browse = async (url: string, init: RequestInit = {}): Promise<Response> => {
      const response = await fetch(new URL(url, base), {
        ...init,
        redirect: 'manual',
        headers: {
          ...(init.headers as Record<string, string>),
          cookie: `${cookieName}=${session}`,
        },
      });
      session = cookieValue(response, cookieName) ?? session;
      return response;
    };
    const postForm = (url: string, fields: Record<string, string> | [string, string][]) =>
      browse(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });

    // The person types their site; the client discovers its server.
    const typed = `${base}/`;
    const metadata = await discover(typed);
    assert.equal(metadata.issuer, base);

    // The client sends the person to the authorization endpoint.
    const verifier = randomBytes(32).toString('base64url');
    const request = new URL(metadata.authorization_endpoint);
    for (const [name, value] of Object.entries({
      response_type: 'code',
      client_id: APP,
      redirect_uri: CALLBACK,
      state: 'state-e2e',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      scope: 'profile',
      me: typed,
    })) {
      request.searchParams.set(name, value);
    }
    const screen = (await browse(request.href)).headers.get('location') ?? '';
    const login = (await browse(screen)).headers.get('location') ?? '';
    assert.match(login, /^\/admin\/login/, 'a signed-out person is asked to log in');

    const loginForm = await (await browse(login)).text();
    const signedIn = await postForm('/admin/login', {
      csrf_token: csrfField(loginForm) ?? '',
      username: 'ada',
      password: 'correct horse battery',
      return_to: screen,
    });
    assert.equal(signedIn.headers.get('location'), screen);

    const consent = await (await browse(screen)).text();
    assert.match(consent, /Quill/);
    const approve = await postForm(screen.split('?')[0] ?? '', [
      ['csrf_token', csrfField(consent) ?? ''],
      ['request', /name="request" value="([^"]+)"/.exec(consent)?.[1] ?? ''],
      ['decision', 'approve'],
      ['scope', 'profile'],
    ]);
    const back = new URL(approve.headers.get('location') ?? '');
    assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
    assert.equal(back.searchParams.get('state'), 'state-e2e');
    assert.equal(back.searchParams.get('iss'), metadata.issuer);

    // The client redeems the code, with no session of the person's.
    const redeemed = await fetch(metadata.authorization_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: back.searchParams.get('code') ?? '',
        client_id: APP,
        redirect_uri: CALLBACK,
        code_verifier: verifier,
      }).toString(),
    });
    assert.equal(redeemed.status, 200);
    const answer = (await redeemed.json()) as { me: string; profile?: { name?: string } };
    assert.equal(answer.me, typed);
    assert.equal(answer.profile?.name, 'ada');

    // The client checks the me it was handed points at the same server.
    assert.equal(new URL(answer.me).host, new URL(typed).host);
    const confirmed = await discover(answer.me);
    assert.equal(confirmed.authorization_endpoint, metadata.authorization_endpoint);
  });
});
