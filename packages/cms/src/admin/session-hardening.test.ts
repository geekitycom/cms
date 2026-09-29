import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { CONTACT_POST_PATH } from '../contact/form.ts';
import { MODERATE_PATH, UNSUBSCRIBE_PATH } from '../notifications/links.ts';
import { WEBMENTION_PATH } from '../webmention/routes.ts';
import {
  browser,
  csrfField,
  FIRST_ADMIN,
  sandbox,
  setCookie,
  setUpFirstAdmin,
} from './__testing__/harness.ts';

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
    const agent = browser(cms);
    await setUpFirstAdmin(agent);
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
      const agent = browser(cms);
      await setUpFirstAdmin(agent);
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
    await setUpFirstAdmin(browser(cms));
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
      const agent = browser(cms);
      await setUpFirstAdmin(agent);
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
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const response = await cms.app.request('/admin/login', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.notEqual(response.status, 403);
  });
});

// The ActivityPub inboxes are covered in federation/inbox.test.ts and
// federation/wordpress.test.ts, with signed deliveries a junk body cannot fake.
describe('public endpoints that take cross-site POSTs by design', () => {
  const endpoints = [WEBMENTION_PATH, UNSUBSCRIBE_PATH, MODERATE_PATH, CONTACT_POST_PATH];

  for (const url of endpoints) {
    it(`answers a cross-site POST to ${url} exactly as it answers one with no metadata`, async () => {
      const cms = await box.site(HTTPS);
      await setUpFirstAdmin(browser(cms));

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
    const agent = browser(cms);
    await setUpFirstAdmin(agent);
    const token = csrfField(await (await agent.get('/admin')).text());
    assert.ok(token !== undefined);

    const response = await agent.post('/admin/logout', { csrf_token: token });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('clear-site-data'), '"cache", "cookies", "storage"');
  });

  it('sends it only on logout', async () => {
    const cms = await box.site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    assert.equal((await agent.get('/admin')).headers.get('clear-site-data'), null);
  });
});
