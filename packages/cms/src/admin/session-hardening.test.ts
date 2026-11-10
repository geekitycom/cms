import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { CONTACT_POST_PATH } from '../contact/form.ts';
import { MODERATE_PATH, UNSUBSCRIBE_PATH } from '../notifications/links.ts';
import { createUser, usersFile } from '../site/users.ts';
import { WEBMENTION_PATH } from '../webmention/endpoint.ts';
import {
  browser,
  csrfField,
  FIRST_ADMIN,
  sandbox,
  setCookie,
  setUpFirstAdmin,
  signIn,
  signedIn,
} from './__testing__/harness.ts';
import { addUser } from './__testing__/users.ts';
import { UPLOADS_PATH } from './uploads.ts';
import type { Cms } from '../index.ts';

/**
 * The session hardening of TASK-132: a `__Host-` cookie under https, Fetch
 * Metadata in front of every state change a session can make, and a logout
 * that tells the browser to forget the site.
 */

const box = sandbox();
after(() => box.cleanup());

const HTTPS = { baseUrl: 'https://geekity.example' };
const HOST_COOKIE = '__Host-geekity_session';
const PLAIN_COOKIE = 'geekity_session';

function sessionRows(cms: Cms): Record<string, unknown>[] {
  const db = new DatabaseSync(path.join(cms.config.dataDir, 'geekity.db'));
  try {
    return db.prepare('SELECT * FROM sessions').all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

describe('the session cookie under https', () => {
  it('is a __Host- cookie: Secure, Path=/ and no Domain', async () => {
    const cms = await box.site(HTTPS);
    const response = await cms.app.request('/admin/setup');

    const header = setCookie(response, HOST_COOKIE);
    assert.ok(header !== undefined, 'the session is set under the __Host- name');
    assert.match(header, /; Secure/);
    assert.match(header, /; Path=\/(;|$)/);
    assert.doesNotMatch(header, /Domain=/i);
    assert.equal(setCookie(response, PLAIN_COOKIE), undefined, 'and not under the old one');
  });

  it('holds a login from setup through to the dashboard', async () => {
    const cms = await box.site(HTTPS);
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    assert.equal((await agent.get('/admin')).status, 200);
  });

  it('keeps the unprefixed name over plain http, where __Host- cannot be set', async () => {
    const cms = await box.site({ baseUrl: 'http://localhost:3000' });
    const agent = browser(cms);
    const created = await setUpFirstAdmin(agent);

    assert.ok(setCookie(created, PLAIN_COOKIE) !== undefined);
    assert.equal(setCookie(created, HOST_COOKIE), undefined);
    assert.equal((await agent.get('/admin')).status, 200, 'and local development still signs in');
  });
});

describe('a session from before the rename', () => {
  it('is signed out once, with a message saying why', async () => {
    const cms = await box.site(HTTPS);
    const agent = await signedIn(cms);
    const oldId = agent.session();
    assert.ok(oldId !== undefined);

    const response = await cms.app.request('/admin', {
      headers: { cookie: `${PLAIN_COOKIE}=${oldId}` },
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/admin/login');
    assert.match(setCookie(response, PLAIN_COOKIE) ?? '', /Max-Age=0/, 'the old cookie is expired');
    assert.equal(cms.admin.getSession(oldId), undefined, 'and its row is gone');

    const fresh = /^[^=]+=([^;]+)/.exec(setCookie(response, HOST_COOKIE) ?? '')?.[1];
    assert.ok(fresh !== undefined, 'a fresh __Host- session carries the message');
    const login = await cms.app.request('/admin/login', {
      headers: { cookie: `${HOST_COOKIE}=${fresh}` },
    });
    assert.match(await login.text(), /sign in again/i);
  });
});

describe('Fetch Metadata on a state change', () => {
  for (const site of ['cross-site', 'same-site']) {
    it(`refuses an admin POST sent ${site}, even with a good token`, async () => {
      const cms = await box.site();
      const agent = await signedIn(cms);
      const sessionId = agent.session();
      assert.ok(sessionId !== undefined);
      const token = csrfField(await (await agent.get('/admin')).text());
      assert.ok(token !== undefined);

      const refused = await agent.post(
        '/admin/logout',
        { csrf_token: token },
        { 'sec-fetch-site': site },
      );

      assert.equal(refused.status, 403);
      assert.ok(cms.admin.getSession(sessionId) !== undefined, 'the handler never ran');
    });
  }

  it('refuses a cross-site login attempt before the password is looked at', async () => {
    const cms = await box.site();
    addUser({ dataDir: cms.config.dataDir, ...FIRST_ADMIN });
    const agent = browser(cms);
    const token = csrfField(await (await agent.get('/admin/login')).text());
    assert.ok(token !== undefined);

    const refused = await agent.post(
      '/admin/login',
      { csrf_token: token, ...FIRST_ADMIN },
      { 'sec-fetch-site': 'cross-site' },
    );

    assert.equal(refused.status, 403);
  });

  for (const site of ['same-origin', 'none']) {
    it(`lets a ${site} POST through to the token check`, async () => {
      const cms = await box.site();
      const agent = await signedIn(cms);
      const token = csrfField(await (await agent.get('/admin')).text());
      assert.ok(token !== undefined);

      const stale = await agent.post(
        '/admin/logout',
        { csrf_token: 'x' },
        { 'sec-fetch-site': site },
      );
      assert.equal(stale.status, 403, 'the token is still checked');

      const done = await agent.post(
        '/admin/logout',
        { csrf_token: token },
        { 'sec-fetch-site': site },
      );
      assert.equal(done.status, 303);
    });
  }

  it('leaves a GET alone, whoever linked to it', async () => {
    const cms = await box.site();
    addUser({ dataDir: cms.config.dataDir, ...FIRST_ADMIN });

    const response = await cms.app.request('/admin/login', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.notEqual(response.status, 403);
  });
});

describe('public endpoints that take cross-site POSTs by design', () => {
  const endpoints = [WEBMENTION_PATH, UNSUBSCRIBE_PATH, MODERATE_PATH, CONTACT_POST_PATH];

  for (const url of endpoints) {
    it(`answers a cross-site POST to ${url} exactly as it answers one with no metadata`, async () => {
      const cms = await box.site(HTTPS);
      addUser({ dataDir: cms.config.dataDir, ...FIRST_ADMIN });

      async function post(extra: Record<string, string>): Promise<Response> {
        return await cms.app.request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', ...extra },
          body: 'source=https%3A%2F%2Felsewhere.example%2F&target=https%3A%2F%2Fgeekity.example%2F',
        });
      }

      const plain = await post({});
      const crossSite = await post({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' });

      assert.equal(crossSite.status, plain.status);
      assert.equal(await crossSite.text(), await plain.text());
    });
  }
});

describe('logout', () => {
  it('tells the browser to clear cookies, cache and storage for the site', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const token = csrfField(await (await agent.get('/admin')).text());
    assert.ok(token !== undefined);

    const response = await agent.post('/admin/logout', { csrf_token: token });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('clear-site-data'), '"cache", "cookies", "storage"');
  });

  it('sends it only on logout', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    assert.equal((await agent.get('/admin')).headers.get('clear-site-data'), null);
  });
});

describe('a users file that is started again', () => {
  const GRACE = { username: 'grace', password: 'a password of her own' };

  async function signedOut(agent: ReturnType<typeof browser>): Promise<void> {
    const response = await agent.get('/admin');
    assert.equal(response.status, 302, 'the old cookie is anonymous');
    assert.equal(response.headers.get('location'), '/admin/login');
  }

  it('does not hand the new first admin a session the old one had', async () => {
    const cms = await box.site();
    const old = await signedIn(cms);
    assert.equal((await old.get('/admin')).status, 200, 'the old cookie is signed in');

    rmSync(usersFile(cms.config.dataDir));
    const created = await setUpFirstAdmin(browser(cms), GRACE);
    assert.equal(created.status, 303, 'setup made the new admin');

    await signedOut(old);
  });

  it('does the same for a first admin who was made by setup', async () => {
    const cms = await box.site();
    const old = browser(cms);
    assert.equal((await setUpFirstAdmin(old)).status, 303);
    assert.equal((await old.get('/admin')).status, 200, 'setup signed her in');

    rmSync(usersFile(cms.config.dataDir));
    assert.equal((await setUpFirstAdmin(browser(cms), GRACE)).status, 303);

    await signedOut(old);
  });

  it('does not hand a user added after an older copy is restored the session of the user it replaced', async () => {
    const cms = await box.site();
    const dataDir = cms.config.dataDir;
    assert.equal((await setUpFirstAdmin(browser(cms))).status, 303);
    const backup = readFileSync(usersFile(dataDir), 'utf8');

    const bob = { username: 'bob', password: 'bob has a password' };
    await createUser({ dataDir, ...bob });
    const old = await signIn(cms, bob);
    assert.equal((await old.get('/admin')).status, 200, 'bob is signed in');

    writeFileSync(usersFile(dataDir), backup);
    const carol = await createUser({ dataDir, username: 'carol', password: 'carol has one too' });
    assert.equal(carol.id, 2, 'the restored file hands out the id bob had');

    await signedOut(old);
  });

  it('keeps a session working while the file still holds the person it was made for', async () => {
    const cms = await box.site();
    const agent = browser(cms);
    assert.equal((await setUpFirstAdmin(agent)).status, 303);
    await createUser({ dataDir: cms.config.dataDir, ...GRACE });

    assert.equal((await agent.get('/admin')).status, 200);
  });
});

describe('an upload that declares no length', () => {
  it('is refused with 413 once it passes the upload limit, before the rest is read', async () => {
    const limit = 64 * 1024;
    const cms = await box.site({ uploadMaxBytes: limit, uploadMediaMaxBytes: limit });
    const agent = await signedIn(cms);
    const sessionId = agent.session();
    assert.ok(sessionId !== undefined);

    const boundary = 'streamedboundary';
    const chunk = new Uint8Array(64 * 1024).fill(0x61);
    const totalChunks = 160;
    let sent = 0;
    let pulled = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) {
          controller.enqueue(
            encoder.encode(
              `--${boundary}\r\nContent-Disposition: form-data; name="csrf_token"\r\n\r\nwrong\r\n` +
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
                'Content-Type: image/png\r\n\r\n',
            ),
          );
        } else if (sent <= totalChunks) {
          pulled += chunk.length;
          controller.enqueue(chunk);
        } else {
          controller.enqueue(encoder.encode(`\r\n--${boundary}--\r\n`));
          controller.close();
        }
        sent += 1;
      },
    });

    const response = await cms.app.request(UPLOADS_PATH, {
      method: 'POST',
      headers: {
        cookie: `${PLAIN_COOKIE}=${sessionId}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      duplex: 'half',
    } as RequestInit);

    assert.equal(response.status, 413);
    assert.match(((await response.json()) as { error: string }).error, /65536 bytes/);
    assert.ok(
      pulled < totalChunks * chunk.length,
      `read ${String(pulled)} of ${String(totalChunks * chunk.length)} bytes`,
    );
  });
});

describe('the anonymous session behind the sign-in forms', () => {
  const HOUR = 60 * 60 * 1000;

  async function siteAt(start: string): Promise<{ cms: Cms; advance: (ms: number) => void }> {
    let now = new Date(start);
    const cms = await box.site({ now: () => now });
    addUser({ dataDir: cms.config.dataDir, ...FIRST_ADMIN });
    return { cms, advance: (ms) => (now = new Date(now.getTime() + ms)) };
  }

  it('lasts an hour, not the length of a login', async () => {
    const { cms } = await siteAt('2026-11-10T12:00:00Z');
    await cms.app.request('/admin/login');

    const anonymous = sessionRows(cms).filter((row) => row['user_id'] === null);
    assert.equal(anonymous.length, 1);
    for (const row of anonymous) {
      const lifetime =
        Date.parse(String(row['expires_at'])) - Date.parse(String(row['created_at']));
      assert.ok(lifetime <= HOUR, `the anonymous session lasts ${lifetime / 1000} s`);
    }
  });

  it('leaves only the last hour of cookieless visits in the table', async () => {
    const { cms, advance } = await siteAt('2026-11-10T12:00:00Z');

    for (let hour = 0; hour < 5; hour += 1) {
      for (let i = 0; i < 20; i += 1) {
        assert.equal((await cms.app.request('/admin/login')).status, 200);
        advance(HOUR / 20);
      }
    }

    const rows = sessionRows(cms).length;
    assert.ok(rows <= 21, `100 visits over five hours left ${rows} session rows`);
  });

  it('is cleared away once expired without anybody signing in', async () => {
    const { cms } = await siteAt('2026-11-10T12:00:00Z');
    const db = new DatabaseSync(path.join(cms.config.dataDir, 'geekity.db'));
    try {
      db.prepare(
        'INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at) VALUES (?, NULL, ?, ?, ?)',
      ).run('expired-anonymous', 'x', '2020-01-01T00:00:00.000Z', '2020-01-15T00:00:00.000Z');
    } finally {
      db.close();
    }

    await cms.app.request('/admin/login');

    const ids = sessionRows(cms).map((row) => row['id']);
    assert.ok(!ids.includes('expired-anonymous'), 'the expired row is still there');
  });

  it('turns a sign-in form left open past it into a message to try again', async () => {
    const { cms, advance } = await siteAt('2026-11-10T12:00:00Z');
    const agent = browser(cms);
    const token = csrfField(await (await agent.get('/admin/login')).text());
    assert.ok(token !== undefined);

    advance(2 * HOUR);
    const response = await agent.post('/admin/login', {
      csrf_token: token,
      username: FIRST_ADMIN.username,
      password: FIRST_ADMIN.password,
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/login');
    const form = await (await agent.get('/admin/login')).text();
    assert.match(form, /form expired/i);

    const retried = await agent.post('/admin/login', {
      csrf_token: csrfField(form) ?? '',
      username: FIRST_ADMIN.username,
      password: FIRST_ADMIN.password,
    });
    assert.equal(retried.status, 303);
    assert.equal(retried.headers.get('location'), '/admin');
  });

  it('sends an expired reset form back to its link, which still works', async () => {
    const { cms, advance } = await siteAt('2026-11-10T12:00:00Z');
    const { token } = cms.admin.createPasswordReset({ userId: 1, lifetimeSeconds: 4 * HOUR });
    const agent = browser(cms);
    const page = await agent.get(`/admin/reset?token=${token}`);
    const csrf = csrfField(await page.text());
    assert.ok(csrf !== undefined);

    advance(2 * HOUR);
    const response = await agent.post('/admin/reset', {
      csrf_token: csrf,
      token,
      password: 'a brand new password',
      password_confirmation: 'a brand new password',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/admin/reset?token=${token}`);
    const form = await agent.get(`/admin/reset?token=${token}`);
    assert.equal(form.status, 200);
    assert.match(await form.text(), /form expired/i);
  });
});

describe('a session id at rest', () => {
  it('is not the value of the cookie, and the cookie still signs in', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const cookie = agent.session();
    assert.ok(cookie !== undefined);

    const ids = sessionRows(cms).map((row) => row['id']);
    assert.ok(ids.length > 0, 'there is a session row');
    assert.ok(!ids.includes(cookie), 'the sessions table holds the cookie value');
    assert.equal((await agent.get('/admin')).status, 200, 'the cookie finds its session');
  });
});
