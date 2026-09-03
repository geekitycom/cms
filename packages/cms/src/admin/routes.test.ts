import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** A CMS over an empty content directory, closed when the file finishes. */
async function site(config: GeekityConfig = {}): Promise<Cms> {
  const contentDir = await temporaryDir('geekity-admin-content-');
  const dataDir = await temporaryDir('geekity-admin-data-');
  const instance = createCms({ contentDir, dataDir, watch: false, ...config });
  started.push(instance);
  await instance.sync();
  return instance;
}

/** The value of a `Set-Cookie` for `name`, or `undefined`. */
function cookieValue(response: Response, name: string): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const [key, ...rest] = (pair ?? '').split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/** The whole `Set-Cookie` line for `name`, attributes included. */
function setCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));
}

/** The value of the hidden CSRF field in a rendered form. */
function csrfField(html: string): string | undefined {
  const match = /name="csrf_token"\s+value="([^"]+)"/.exec(html);
  return match?.[1];
}

/**
 * A thing that keeps a session cookie between requests, the way a browser
 * does. Every admin flow needs one, and hand-threading the cookie through each
 * assertion would bury what is being tested.
 */
interface Browser {
  get(url: string): Promise<Response>;
  post(url: string, fields: Record<string, string>): Promise<Response>;
  /** The session cookie value currently held, or `undefined`. */
  session(): string | undefined;
  /** Force the held cookie, for the tests about a stale or planted one. */
  setSession(value: string | undefined): void;
}

function browser(cms: Cms): Browser {
  let cookie: string | undefined;

  function remember(response: Response): Response {
    const value = cookieValue(response, 'geekity_session');
    if (value !== undefined) cookie = value === '' ? undefined : value;
    return response;
  }

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return cookie === undefined ? extra : { ...extra, cookie: `geekity_session=${cookie}` };
  }

  return {
    async get(url) {
      return remember(await cms.app.request(url, { headers: headers() }));
    },
    async post(url, fields) {
      const body = new URLSearchParams(fields).toString();
      return remember(
        await cms.app.request(url, {
          method: 'POST',
          headers: headers({ 'content-type': 'application/x-www-form-urlencoded' }),
          body,
        }),
      );
    },
    session() {
      return cookie;
    },
    setSession(value) {
      cookie = value;
    },
  };
}

/** Walk the setup form and create the first admin. Returns the redirect. */
async function setUpFirstAdmin(
  agent: Browser,
  credentials = { username: 'ada', password: 'correct horse battery' },
): Promise<Response> {
  const form = await agent.get('/admin/setup');
  const token = csrfField(await form.text());
  assert.ok(token !== undefined, 'the setup form carried a CSRF token');

  return agent.post('/admin/setup', {
    csrf_token: token,
    username: credentials.username,
    password: credentials.password,
    password_confirmation: credentials.password,
  });
}

describe('first run', () => {
  it('sends every admin route to the setup form while no users exist', async () => {
    const cms = await site();

    for (const url of ['/admin', '/admin/', '/admin/posts', '/admin/login']) {
      const response = await cms.app.request(url);
      assert.equal(response.status, 302, url);
      assert.equal(response.headers.get('location'), '/admin/setup', url);
    }
  });

  it('shows a setup form carrying a CSRF token and a session cookie', async () => {
    const cms = await site();

    const response = await cms.app.request('/admin/setup');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(html, /<form[^>]*method="post"/i);
    assert.match(html, /name="username"/);
    assert.match(html, /name="password"/);
    assert.ok(csrfField(html) !== undefined, 'the form carries a CSRF token');
    assert.ok(cookieValue(response, 'geekity_session') !== undefined, 'and a session to hold it');
  });
});

describe('setup', () => {
  it('creates the first admin and logs them straight in', async () => {
    const cms = await site();
    const agent = browser(cms);

    const created = await setUpFirstAdmin(agent);

    assert.equal(created.status, 303);
    assert.equal(created.headers.get('location'), '/admin');
    assert.equal(cms.admin.countUsers(), 1);
    assert.deepEqual(
      cms.admin.listUsers().map((user) => user.username),
      ['ada'],
    );

    const dashboard = await agent.get('/admin');
    const html = await dashboard.text();
    assert.equal(dashboard.status, 200, 'the new admin is already signed in');
    assert.match(html, /ada/, 'and the dashboard says who they are');
  });

  it('replaces the pre-login session rather than promoting it', async () => {
    const cms = await site();
    const agent = browser(cms);

    await agent.get('/admin/setup');
    const anonymous = agent.session();
    assert.ok(anonymous !== undefined);

    await setUpFirstAdmin(agent);

    assert.notEqual(agent.session(), anonymous, 'the logged-in id is a new one');
    assert.equal(cms.admin.getSession(anonymous), undefined, 'and the planted one is gone');
  });

  it('refuses a post that carries no CSRF token', async () => {
    const cms = await site();
    const agent = browser(cms);
    await agent.get('/admin/setup');

    const response = await agent.post('/admin/setup', {
      username: 'ada',
      password: 'correct horse battery',
      password_confirmation: 'correct horse battery',
    });

    assert.equal(response.status, 403);
    assert.equal(cms.admin.countUsers(), 0, 'and created nobody');
  });

  it('refuses a post whose CSRF token belongs to another session', async () => {
    const cms = await site();
    const victim = browser(cms);
    const attacker = browser(cms);

    await victim.get('/admin/setup');
    const otherToken = csrfField(await (await attacker.get('/admin/setup')).text());
    assert.ok(otherToken !== undefined);

    const response = await victim.post('/admin/setup', {
      csrf_token: otherToken,
      username: 'ada',
      password: 'correct horse battery',
      password_confirmation: 'correct horse battery',
    });

    assert.equal(response.status, 403);
    assert.equal(cms.admin.countUsers(), 0);
  });

  it('returns the form with a message when the passwords disagree', async () => {
    const cms = await site();
    const agent = browser(cms);
    const token = csrfField(await (await agent.get('/admin/setup')).text());
    assert.ok(token !== undefined);

    const response = await agent.post('/admin/setup', {
      csrf_token: token,
      username: 'ada',
      password: 'correct horse battery',
      password_confirmation: 'correct horse batteries',
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /do not match/);
    assert.equal(cms.admin.countUsers(), 0);
  });

  it('closes the setup form once a user exists', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const signedIn = await agent.get('/admin/setup');
    assert.equal(signedIn.status, 302);
    assert.equal(signedIn.headers.get('location'), '/admin');

    const stranger = browser(cms);
    const anonymous = await stranger.get('/admin/setup');
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), '/admin/login');
  });
});

describe('login', () => {
  it('returns the form with an error and no session when the password is wrong', async () => {
    const cms = await site();
    await setUpFirstAdmin(browser(cms));

    const agent = browser(cms);
    const token = csrfField(await (await agent.get('/admin/login')).text());
    assert.ok(token !== undefined);

    const response = await agent.post('/admin/login', {
      csrf_token: token,
      username: 'ada',
      password: 'not the password',
    });

    assert.equal(response.status, 401);
    assert.match(await response.text(), /do not match/);

    const dashboard = await agent.get('/admin');
    assert.equal(dashboard.status, 302, 'the failed attempt logged nobody in');
    assert.equal(dashboard.headers.get('location'), '/admin/login');
  });

  it('says the same thing about an unknown user as about a wrong password', async () => {
    const cms = await site();
    await setUpFirstAdmin(browser(cms));

    const agent = browser(cms);
    const token = csrfField(await (await agent.get('/admin/login')).text());
    assert.ok(token !== undefined);

    const response = await agent.post('/admin/login', {
      csrf_token: token,
      username: 'nobody',
      password: 'not the password',
    });

    assert.equal(response.status, 401);
    assert.match(await response.text(), /do not match/);
  });

  it('logs a known user in and swaps the session id', async () => {
    const cms = await site();
    await setUpFirstAdmin(browser(cms));

    const agent = browser(cms);
    const token = csrfField(await (await agent.get('/admin/login')).text());
    assert.ok(token !== undefined);
    const beforeLogin = agent.session();

    const response = await agent.post('/admin/login', {
      csrf_token: token,
      username: 'ada',
      password: 'correct horse battery',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin');
    assert.notEqual(agent.session(), beforeLogin, 'no session fixation');

    const dashboard = await agent.get('/admin');
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /ada/);
  });
});

describe('the guard', () => {
  it('sends an anonymous visitor to the login form from anywhere under /admin', async () => {
    const cms = await site();
    await setUpFirstAdmin(browser(cms));

    for (const url of ['/admin', '/admin/', '/admin/posts', '/admin/settings/anything']) {
      const response = await cms.app.request(url);
      assert.equal(response.status, 302, url);
      assert.equal(response.headers.get('location'), '/admin/login', url);
    }
  });

  it('lets the login form itself through', async () => {
    const cms = await site();
    await setUpFirstAdmin(browser(cms));

    const response = await cms.app.request('/admin/login');
    assert.equal(response.status, 200);
  });

  it('refuses a mutating request that carries no session at all', async () => {
    const cms = await site();
    await setUpFirstAdmin(browser(cms));

    const response = await cms.app.request('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'ada', password: 'correct horse battery' }).toString(),
    });

    assert.equal(response.status, 403);
  });

  it('leaves the public site alone', async () => {
    const cms = await site();
    const response = await cms.app.request('/');

    assert.equal(response.status, 200);
    assert.equal(response.headers.getSetCookie().length, 0, 'a public page carries no session');
  });
});

describe('logout', () => {
  it('invalidates the session server-side, not just in the browser', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const sessionId = agent.session();
    assert.ok(sessionId !== undefined);
    const token = csrfField(await (await agent.get('/admin')).text());
    assert.ok(token !== undefined, 'the dashboard carries a logout form with a token');

    const response = await agent.post('/admin/logout', { csrf_token: token });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/login');
    assert.equal(cms.admin.getSession(sessionId), undefined, 'the row is gone');
    assert.ok(
      setCookie(response, 'geekity_session')?.includes('Max-Age=0'),
      'and the cookie is cleared',
    );

    // A browser that kept the old cookie anyway gets nothing with it.
    agent.setSession(sessionId);
    const afterwards = await agent.get('/admin');
    assert.equal(afterwards.status, 302);
    assert.equal(afterwards.headers.get('location'), '/admin/login');
  });
});

describe('the session cookie', () => {
  it('is HttpOnly, SameSite=Lax and scoped to /admin', async () => {
    const cms = await site();
    const response = await cms.app.request('/admin/setup');
    const header = setCookie(response, 'geekity_session');

    assert.ok(header !== undefined);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, /Path=\/admin/);
    assert.ok(!/Secure/.test(header), 'plain http keeps Secure off, or the cookie is dropped');
  });

  it('is Secure when the site says it is served over https', async () => {
    const cms = await site({ baseUrl: 'https://geekity.example' });
    const response = await cms.app.request('/admin/setup');
    const header = setCookie(response, 'geekity_session');

    assert.ok(header !== undefined);
    assert.match(header, /Secure/);
  });

  it('expires after the configured lifetime', async () => {
    const cms = await site({ sessionLifetime: 0.25 });
    const agent = browser(cms);
    await setUpFirstAdmin(agent);
    const sessionId = agent.session();
    assert.ok(sessionId !== undefined);

    assert.equal((await agent.get('/admin')).status, 200, 'good while it lasts');

    await setTimeout(300);
    agent.setSession(sessionId);

    const expired = await agent.get('/admin');
    assert.equal(expired.status, 302);
    assert.equal(expired.headers.get('location'), '/admin/login');
    assert.equal(cms.admin.getSession(sessionId), undefined, 'and the row was pruned');
  });
});
