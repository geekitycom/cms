/**
 * Signing in to another site as this one (TASK-158): the authorization
 * endpoint, the admin login it goes through, and the consent screen that
 * approves or denies the request and sends the person back with a code.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { browser, csrfField, sandbox, signIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { createUser } from '../admin/accounts.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';

const box = sandbox();

const BASE = 'https://blog.example';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const CONSENT = '/admin/indieauth/consent';

const APP = 'https://app.example/';
const NAMELESS = 'https://nameless.example/';
const MCP = 'https://mcp.example/client.json';
const HEADER = 'https://header.example/';
const LOGO = 'https://logo.example/';
const PNG = 'not really a png, but typed as one';

/** An h-app page whose u-logo points at `src`. */
function appWithLogo(src: string): { type: string; body: string } {
  return {
    type: 'text/html',
    body: `<div class="h-app"><span class="p-name">Logo App</span><img class="u-logo" src="${src}"></div>`,
  };
}

const PAGES: Record<string, { type: string; body: string; link?: string }> = {
  [APP]: {
    type: 'text/html',
    body: `<html><head><link rel="redirect_uri" href="https://callback.example/listed"></head>
      <body><div class="h-app"><a class="u-url p-name" href="/">Quill</a></div></body></html>`,
  },
  [NAMELESS]: { type: 'text/html', body: '<html><body>Hello.</body></html>' },
  [HEADER]: {
    type: 'text/html',
    body: '<html><body><div class="h-app"><span class="p-name">Header App</span></div></body></html>',
    link: '<https://callback.example/from-header>; rel="redirect_uri"',
  },
  [LOGO]: appWithLogo('/logo.png'),
  [`${LOGO}logo.png`]: { type: 'image/png', body: PNG },
  'https://text-logo.example/': appWithLogo('/logo.png'),
  'https://text-logo.example/logo.png': { type: 'text/html', body: '<p>not an image</p>' },
  'https://big-logo.example/': appWithLogo('/logo.png'),
  'https://big-logo.example/logo.png': { type: 'image/png', body: 'x'.repeat(65 * 1024) },
  'https://gone-logo.example/': appWithLogo('https://gone.example/logo.png'),
  [MCP]: {
    type: 'application/json',
    body: JSON.stringify({
      client_id: MCP,
      client_name: 'Example MCP Client',
      redirect_uris: ['http://127.0.0.1:33418/callback'],
    }),
  },
};

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  const page = PAGES[new Request(input).url];
  if (page === undefined) return Promise.reject(new TypeError('fetch failed'));
  return Promise.resolve(
    new Response(page.body, {
      headers: {
        'content-type': page.type,
        ...(page.link === undefined ? {} : { link: page.link }),
      },
    }),
  );
}) as typeof fetch;

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
});

const PUBLIC: HostLookup = () => Promise.resolve(['203.0.113.7']);

async function site(config: { maintenance?: boolean } = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-consent-content-');
  const dataDir = await box.dir('geekity-consent-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', author: 'ada' }),
  );
  await createUser({
    dataDir,
    username: 'ada',
    password: 'correct horse battery',
    email: 'ada@blog.example',
  });
  await createUser({ dataDir, username: 'bob', password: 'another horse battery' });
  const cms = await box.open(
    { contentDir, dataDir, baseUrl: BASE, hostLookup: PUBLIC, ...config },
    { actorKeys: ['ada', 'bob'] },
  );
  // What a code was issued for, read back the way the redemption in TASK-159
  // will read it: taken once from the store on the context.
  cms.app.get('/_test/code', (c) => {
    const grant = c.var.indieauth.codes.take(c.req.query('code') ?? '');
    return c.json(grant ?? null);
  });
  return cms;
}

function query(changes: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  const fields: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: APP,
    redirect_uri: `${APP}callback`,
    state: 'state-123',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    scope: 'profile email',
    me: `${BASE}/`,
    ...changes,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) params.set(name, value);
  }
  return params.toString();
}

/** The consent page for a request, as a signed-in browser sees it. */
async function consent(
  agent: Browser,
  changes: Record<string, string | undefined> = {},
): Promise<{ html: string; request: string; csrf: string }> {
  const response = await agent.get(`${CONSENT}?${query(changes)}`);
  const html = await response.text();
  assert.equal(response.status, 200, html);
  const request = /name="request" value="([^"]+)"/.exec(html)?.[1];
  const csrf = csrfField(html);
  assert.ok(request !== undefined && csrf !== undefined, 'the consent form carried its fields');
  return { html, request, csrf };
}

/** Press Approve or Deny, with the scopes left ticked. */
async function decide(
  agent: Browser,
  form: { request: string; csrf: string },
  decision: 'approve' | 'deny',
  scopes: string[] = [],
): Promise<URL> {
  const fields: [string, string][] = [
    ['csrf_token', form.csrf],
    ['request', form.request],
    ['decision', decision],
    ...scopes.map((scope): [string, string] => ['scope', scope]),
  ];
  const response = await agent.post(CONSENT, fields);
  assert.equal(response.status, 303, await response.clone().text());
  return new URL(response.headers.get('location') ?? '');
}

async function grant(cms: Cms, code: string): Promise<Record<string, unknown> | null> {
  const response = await cms.app.request(`/_test/code?code=${encodeURIComponent(code)}`);
  return (await response.json()) as Record<string, unknown> | null;
}

describe('the authorization endpoint', () => {
  it('hands the request to the consent screen unchanged', async () => {
    const cms = await site();
    const response = await cms.app.request(`/_geekity/indieauth/auth?${query()}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `${CONSENT}?${query()}`);
  });

  it('is down in maintenance mode, like the identity URLs that advertise it', async () => {
    const cms = await site({ maintenance: true });
    const response = await cms.app.request(`/_geekity/indieauth/auth?${query()}`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('location'), null);
  });
});

describe('signing in from a signed-out browser', () => {
  it('goes through the admin login and lands back on the consent screen for the same request', async () => {
    const cms = await site();
    const agent = browser(cms);

    const start = await agent.get(`/_geekity/indieauth/auth?${query()}`);
    const screen = start.headers.get('location') ?? '';
    const away = await agent.get(screen);
    assert.equal(away.status, 302);
    const login = away.headers.get('location') ?? '';
    assert.equal(login, `/admin/login?return_to=${encodeURIComponent(screen)}`);

    const form = await (await agent.get(login)).text();
    const returnTo = /name="return_to" value="([^"]+)"/.exec(form)?.[1];
    assert.equal(returnTo?.replaceAll('&amp;', '&'), screen);

    const signedIn = await agent.post('/admin/login', {
      csrf_token: csrfField(form) ?? '',
      username: 'ada',
      password: 'correct horse battery',
      return_to: screen,
    });
    assert.equal(signedIn.status, 303);
    assert.equal(signedIn.headers.get('location'), screen);

    const html = await (await agent.get(screen)).text();
    assert.match(html, /Quill/);
  });

  it('keeps the return address when the password is wrong', async () => {
    const cms = await site();
    const agent = browser(cms);
    const screen = `${CONSENT}?${query()}`;
    const form = await (
      await agent.get(`/admin/login?return_to=${encodeURIComponent(screen)}`)
    ).text();
    const refused = await agent.post('/admin/login', {
      csrf_token: csrfField(form) ?? '',
      username: 'ada',
      password: 'wrong',
      return_to: screen,
    });
    assert.equal(refused.status, 401);
    assert.match(await refused.text(), /name="return_to" value="\/admin\/indieauth\/consent\?/);
  });

  it('never returns to an address off the admin', async () => {
    const cms = await site();
    for (const returnTo of [
      'https://evil.example/',
      '//evil.example/',
      '/2026/09/hello/',
      '/admin\\@evil',
    ]) {
      const agent = browser(cms);
      const form = await (await agent.get('/admin/login')).text();
      const signedIn = await agent.post('/admin/login', {
        csrf_token: csrfField(form) ?? '',
        username: 'ada',
        password: 'correct horse battery',
        return_to: returnTo,
      });
      assert.equal(signedIn.headers.get('location'), '/admin', returnTo);
    }
  });
});

describe('the consent screen', () => {
  it('names the client, its redirect host, the me URL and each scope, ticked', async () => {
    const cms = await site();
    const { html } = await consent(await signIn(cms));
    assert.match(html, /Quill/);
    assert.match(html, /app\.example/);
    assert.match(html, /https:\/\/blog\.example\//);
    assert.match(html, /<input[^>]*name="scope"[^>]*value="profile"[^>]*checked/);
    assert.match(html, /<input[^>]*name="scope"[^>]*value="email"[^>]*checked/);
  });

  it('names a client that publishes no name by its URL', async () => {
    const cms = await site();
    const { html } = await consent(await signIn(cms), {
      client_id: NAMELESS,
      redirect_uri: `${NAMELESS}cb`,
    });
    assert.match(html, /https:\/\/nameless\.example\//);
  });

  it('lets the form post its redirect to the client, and nowhere else', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const response = await agent.get(`${CONSENT}?${query()}`);
    const policy = response.headers.get('content-security-policy') ?? '';
    assert.match(policy, /form-action 'self' https:\/\/app\.example(;|$)/);
  });

  it("shows the client's logo inline, so the admin never loads the client's URL", async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const response = await agent.get(
      `${CONSENT}?${query({ client_id: LOGO, redirect_uri: `${LOGO}cb` })}`,
    );
    const html = await response.text();
    const src = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;
    assert.match(html, new RegExp(`<img[^>]*src="${src.replace(/[+/]/g, '\\$&')}"`));
    assert.doesNotMatch(html, /logo\.example\/logo\.png/);
    const policy = response.headers.get('content-security-policy') ?? '';
    assert.match(policy, /img-src 'self' data:(;|$)/);
  });

  for (const [what, clientId] of [
    ['publishes no logo', APP],
    ['names a logo that is not an image', 'https://text-logo.example/'],
    ['names a logo over the size limit', 'https://big-logo.example/'],
    ['names a logo that cannot be reached', 'https://gone-logo.example/'],
  ] as const) {
    it(`shows the screen with no logo for a client that ${what}`, async () => {
      const cms = await site();
      const { html } = await consent(await signIn(cms), {
        client_id: clientId,
        redirect_uri: `${clientId}cb`,
      });
      assert.doesNotMatch(html, /<img/);
      assert.match(html, /name="decision" value="approve"/);
    });
  }

  it('shows the resource a token is wanted for', async () => {
    const cms = await site();
    const { html } = await consent(await signIn(cms), { resource: `${BASE}/mcp` });
    assert.match(html, /https:\/\/blog\.example\/mcp/);
  });
});

describe('approving and denying', () => {
  it('sends the person back with a code, the state and the issuer on Approve', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const form = await consent(agent, { resource: `${BASE}/mcp` });
    const back = await decide(agent, form, 'approve', ['profile']);

    assert.equal(`${back.origin}${back.pathname}`, `${APP}callback`);
    assert.equal(back.searchParams.get('state'), 'state-123');
    assert.equal(back.searchParams.get('iss'), BASE);
    const code = back.searchParams.get('code') ?? '';
    assert.ok(code.length >= 32, 'the code is long enough to be unguessable');

    assert.deepEqual(await grant(cms, code), {
      clientId: APP,
      clientName: 'Quill',
      redirectUri: `${APP}callback`,
      codeChallenge: CHALLENGE,
      userId: 1,
      me: `${BASE}/`,
      scopes: ['profile'],
      resource: `${BASE}/mcp`,
    });
    assert.equal(await grant(cms, code), null, 'a code is taken once');
  });

  it('shows the legacy post scope as create and update, and grants those', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const form = await consent(agent, { scope: 'post' });
    assert.match(form.html, /<input[^>]*name="scope"[^>]*value="create"[^>]*checked/);
    assert.match(form.html, /<input[^>]*name="scope"[^>]*value="update"[^>]*checked/);
    assert.doesNotMatch(form.html, /value="post"/);
    const back = await decide(agent, form, 'approve', ['create', 'update']);
    const issued = await grant(cms, back.searchParams.get('code') ?? '');
    assert.deepEqual(issued?.['scopes'], ['create', 'update']);
  });

  it('grants no scope that was not asked for, even when the form says so', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const form = await consent(agent, { scope: 'profile' });
    const back = await decide(agent, form, 'approve', ['email']);
    const issued = await grant(cms, back.searchParams.get('code') ?? '');
    assert.deepEqual(issued?.['scopes'], []);
  });

  it('sends the person back with access_denied and the state on Deny', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const back = await decide(agent, await consent(agent), 'deny');
    assert.equal(back.searchParams.get('error'), 'access_denied');
    assert.equal(back.searchParams.get('state'), 'state-123');
    assert.equal(back.searchParams.get('iss'), BASE);
    assert.equal(back.searchParams.get('code'), null);
  });

  it('answers a request only once', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const form = await consent(agent);
    await decide(agent, form, 'approve');
    const again = await agent.post(CONSENT, {
      csrf_token: form.csrf,
      request: form.request,
      decision: 'approve',
    });
    assert.equal(again.status, 400);
    assert.equal(again.headers.get('location'), null);
  });

  it('refuses a form with no CSRF token, or posted from another site', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const form = await consent(agent);
    const stale = await agent.post(CONSENT, { request: form.request, decision: 'approve' });
    assert.equal(stale.status, 403);
    const crossSite = await agent.post(
      CONSENT,
      { csrf_token: form.csrf, request: form.request, decision: 'approve' },
      { 'sec-fetch-site': 'cross-site' },
    );
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.headers.get('location'), null);
  });
});

describe('who a sign-in is for', () => {
  it('signs a user in as themselves when the me names somebody else', async () => {
    const cms = await site();
    const agent = await signIn(cms, { username: 'bob', password: 'another horse battery' });
    const form = await consent(agent, { me: `${BASE}/author/ada/` });
    assert.match(form.html, /https:\/\/blog\.example\/author\/bob\//);
    assert.doesNotMatch(form.html, /https:\/\/blog\.example\/author\/ada\//);

    const back = await decide(agent, form, 'approve');
    const issued = await grant(cms, back.searchParams.get('code') ?? '');
    assert.equal(issued?.['me'], `${BASE}/author/bob/`);
    assert.equal(issued?.['userId'], 2);
  });
});

describe('where a client may be sent back to', () => {
  it('accepts a redirect_uri on another origin that the client lists', async () => {
    const cms = await site();
    const { html } = await consent(await signIn(cms), {
      redirect_uri: 'https://callback.example/listed',
    });
    assert.match(html, /callback\.example/);
  });

  it('accepts one the client lists only in its Link header, through to a code', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const redirectUri = 'https://callback.example/from-header';
    const form = await consent(agent, { client_id: HEADER, redirect_uri: redirectUri });
    assert.match(form.html, /Header App/);

    const back = await decide(agent, form, 'approve');
    assert.equal(`${back.origin}${back.pathname}`, redirectUri);
    const issued = await grant(cms, back.searchParams.get('code') ?? '');
    assert.equal(issued?.['clientId'], HEADER);
    assert.equal(issued?.['redirectUri'], redirectUri);
  });

  it('shows an error page and never redirects for one it does not list', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const response = await agent.get(
      `${CONSENT}?${query({ redirect_uri: 'https://evil.example/steal' })}`,
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
    assert.doesNotMatch(await response.text(), /name="request"/);
  });

  it('reports a request missing PKCE to a redirect_uri it trusts', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const response = await agent.get(`${CONSENT}?${query({ code_challenge: undefined })}`);
    assert.equal(response.status, 302);
    const back = new URL(response.headers.get('location') ?? '');
    assert.equal(`${back.origin}${back.pathname}`, `${APP}callback`);
    assert.equal(back.searchParams.get('error'), 'invalid_request');
    assert.equal(back.searchParams.get('state'), 'state-123');
    assert.equal(back.searchParams.get('iss'), BASE);
  });

  it('shows a malformed client_id as an error page', async () => {
    const cms = await site();
    const agent = await signIn(cms);
    const response = await agent.get(`${CONSENT}?${query({ client_id: 'https://10.0.0.1/' })}`);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
  });

  it('takes a JSON client metadata document, as an MCP client publishes', async () => {
    const cms = await site();
    const { html } = await consent(await signIn(cms), {
      client_id: MCP,
      redirect_uri: 'http://127.0.0.1:33418/callback',
    });
    assert.match(html, /Example MCP Client/);
    assert.match(html, /127\.0\.0\.1/);
  });
});

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

/** Post a code back to the authorization endpoint, the way a client redeems it. */
async function redeem(
  cms: Cms,
  code: string,
  changes: Record<string, string | undefined> = {},
): Promise<{ status: number; headers: Headers; body: Record<string, unknown> }> {
  const fields: Record<string, string | undefined> = {
    grant_type: 'authorization_code',
    code,
    client_id: APP,
    redirect_uri: `${APP}callback`,
    code_verifier: VERIFIER,
    ...changes,
  };
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) body.set(name, value);
  }
  const response = await cms.app.request('/_geekity/indieauth/auth', {
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

/** Sign in as ada, approve a request with `scopes` ticked, and answer the code. */
async function approved(
  cms: Cms,
  scopes: string[],
  changes: Record<string, string | undefined> = {},
  credentials?: { username: string; password: string },
): Promise<string> {
  const agent = await signIn(cms, credentials);
  const back = await decide(agent, await consent(agent, changes), 'approve', scopes);
  return back.searchParams.get('code') ?? '';
}

describe('redeeming a code for the profile', () => {
  it('answers me, the profile and the email when both were approved, never a token', async () => {
    const cms = await site();
    const answer = await redeem(cms, await approved(cms, ['profile', 'email']));
    assert.equal(answer.status, 200);
    assert.equal(answer.headers.get('cache-control'), 'no-store');
    assert.deepEqual(answer.body, {
      me: `${BASE}/`,
      profile: { name: 'ada', url: `${BASE}/`, email: 'ada@blog.example' },
    });
  });

  it('leaves the email out when only profile was approved', async () => {
    const cms = await site();
    const answer = await redeem(cms, await approved(cms, ['profile']));
    assert.deepEqual(answer.body, { me: `${BASE}/`, profile: { name: 'ada', url: `${BASE}/` } });
  });

  it('answers me alone when no scope was approved', async () => {
    const cms = await site();
    const answer = await redeem(cms, await approved(cms, []));
    assert.deepEqual(answer.body, { me: `${BASE}/` });
  });

  it('refuses a replayed code with invalid_grant', async () => {
    const cms = await site();
    const code = await approved(cms, ['profile']);
    assert.equal((await redeem(cms, code)).status, 200);
    const replayed = await redeem(cms, code);
    assert.equal(replayed.status, 400);
    assert.equal(replayed.body['error'], 'invalid_grant');
    assert.equal(replayed.body['me'], undefined);
  });

  for (const [what, changes] of [
    ['a wrong code_verifier', { code_verifier: 'x'.repeat(43) }],
    ['another client_id', { client_id: NAMELESS }],
    ['another redirect_uri', { redirect_uri: `${APP}elsewhere` }],
  ] as const) {
    it(`refuses ${what} with invalid_grant`, async () => {
      const cms = await site();
      const answer = await redeem(cms, await approved(cms, ['profile']), changes);
      assert.equal(answer.status, 400);
      assert.equal(answer.body['error'], 'invalid_grant');
    });
  }

  it('refuses a request missing its verifier with invalid_request', async () => {
    const cms = await site();
    const answer = await redeem(cms, await approved(cms, []), { code_verifier: undefined });
    assert.equal(answer.status, 400);
    assert.equal(answer.body['error'], 'invalid_request');
  });

  it('is down in maintenance mode, like the rest of the endpoint', async () => {
    const cms = await site({ maintenance: true });
    const response = await cms.app.request('/_geekity/indieauth/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=x',
    });
    assert.equal(response.status, 503);
  });
});

describe('the me a redemption hands back', () => {
  for (const [typed, expected, credentials] of [
    [`${BASE}/`, `${BASE}/`, undefined],
    ['https://blog.example', `${BASE}/`, undefined],
    ['https://blog.example/author/ada', `${BASE}/author/ada/`, undefined],
    [`${BASE}/`, `${BASE}/author/bob/`, { username: 'bob', password: 'another horse battery' }],
  ] as const) {
    it(`shares a host with ${typed} when ${credentials?.username ?? 'ada'} signs in`, async () => {
      const cms = await site();
      const code = await approved(cms, [], { me: typed }, credentials);
      const { body } = await redeem(cms, code);
      assert.equal(body['me'], expected);
      assert.equal(new URL(expected).host, new URL(typed).host);
    });
  }
});
