import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { countUsers, listUsers } from './accounts.ts';
import { ADMIN_SECTIONS } from './menu.ts';
import {
  browser,
  cookieValue,
  csrfField,
  sandbox,
  setCookie,
  setUpFirstAdmin,
} from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

/** A CMS over an empty content directory, closed when the file finishes. */
const site = box.site.bind(box);

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
    assert.equal(countUsers(cms.config.dataDir), 1);
    assert.deepEqual(
      listUsers(cms.config.dataDir).map((user) => user.username),
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
    assert.equal(countUsers(cms.config.dataDir), 0, 'and created nobody');
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
    assert.equal(countUsers(cms.config.dataDir), 0);
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
    assert.equal(countUsers(cms.config.dataDir), 0);
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

describe('security headers', () => {
  it('puts the defensive set on every admin response, whatever it is', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const responses = [
      await agent.get('/admin'),
      await agent.get('/admin/posts/new'),
      await agent.get('/admin/_static/admin.css'),
      await cms.app.request('/admin/settings'),
      await cms.app.request('/admin/nowhere-at-all'),
    ];

    for (const response of responses) {
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('referrer-policy'), 'same-origin');
      assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    }
  });

  it('names the editor bundle, the preview frame and the uploads in the policy', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const policy = (await agent.get('/admin/posts/new')).headers.get('content-security-policy');
    assert.ok(policy !== null);

    // The bundle is same-origin and there is no inline script left in the admin.
    assert.match(policy, /script-src 'self'/);
    assert.ok(!policy.includes("script-src 'self' 'unsafe-inline'"), 'no inline script is allowed');
    // The preview renders the theme's own stylesheet and the site's uploads.
    assert.match(policy, /style-src [^;]*'self'/);
    assert.match(policy, /img-src [^;]*'self'/);
    // The editor posts to /admin/preview and /admin/uploads with fetch.
    assert.match(policy, /connect-src 'self'/);
    // The editor frames its own preview, so it may be framed by itself.
    assert.match(policy, /frame-ancestors 'self'/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /base-uri 'self'/);
    assert.match(policy, /form-action 'self'/);
  });

  it('gives each response its own style nonce and hands it to the editor bundle', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const response = await agent.get('/admin/posts/new');
    const policy = response.headers.get('content-security-policy') ?? '';
    const html = await response.text();

    const inPolicy = /style-src [^;]*'nonce-([A-Za-z0-9+/=_-]+)'/.exec(policy)?.[1];
    assert.ok(inPolicy !== undefined, 'the policy carries a nonce');
    assert.match(html, new RegExp(`<script[^>]*nonce="${inPolicy}"`), 'and so does the bundle tag');

    const second = await agent.get('/admin/posts/new');
    const other = /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(
      second.headers.get('content-security-policy') ?? '',
    )?.[1];
    assert.notEqual(other, inPolicy, 'a nonce is used once');
  });

  it('leaves no inline script in the admin for the policy to have to allow', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const html = await (await agent.get('/admin/posts/new')).text();

    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S/, 'every script has a src');
  });

  it('keeps the public site to nosniff and constrains no theme', async () => {
    const cms = await site();
    const response = await cms.app.request('/');

    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-security-policy'), null);
    assert.equal(response.headers.get('x-frame-options'), null);
  });

  it('adds HSTS only when the site says it is served over https', async () => {
    const plain = await site();
    assert.equal(
      (await plain.app.request('/admin/login')).headers.get('strict-transport-security'),
      null,
    );

    const secure = await site({ baseUrl: 'https://geekity.example' });
    assert.match(
      (await secure.app.request('/admin/login')).headers.get('strict-transport-security') ?? '',
      /max-age=\d{7,}/,
    );
    assert.match(
      (await secure.app.request('/')).headers.get('strict-transport-security') ?? '',
      /max-age=\d{7,}/,
      'the public site gets it too: it is the same host',
    );
  });
});

describe('the login throttle', () => {
  /** A clock the test moves, in the shape `config.now` has. */
  function movableClock(): { now: () => Date; advance: (seconds: number) => void } {
    let millis = Date.UTC(2026, 8, 4, 12, 0, 0);
    return {
      now: () => new Date(millis),
      advance(seconds) {
        millis += seconds * 1000;
      },
    };
  }

  /** Post the login form with a fresh token off the form itself. */
  async function attempt(agent: Browser, username: string, password: string): Promise<Response> {
    const token = csrfField(await (await agent.get('/admin/login')).text());
    assert.ok(token !== undefined, 'the login form carried a CSRF token');
    return agent.post('/admin/login', { csrf_token: token, username, password });
  }

  it('refuses even the right password once a username has failed too often', async () => {
    const clock = movableClock();
    const cms = await site({ now: clock.now, loginAttempts: 3, loginLockout: 120 });
    await setUpFirstAdmin(browser(cms));

    const agent = browser(cms);
    for (let i = 0; i < 3; i += 1) {
      const refused = await attempt(agent, 'ada', 'not the password');
      assert.equal(refused.status, 401, `attempt ${i + 1} is a plain refusal`);
    }

    const locked = await attempt(agent, 'ada', 'correct horse battery');
    assert.equal(locked.status, 429);
    assert.match(await locked.text(), /Too many sign-in attempts.*2 minutes/s);
    assert.equal(locked.headers.get('retry-after'), '120');

    const dashboard = await agent.get('/admin');
    assert.equal(dashboard.status, 302, 'and nobody was logged in');
  });

  it('lets the right password through once the lockout has run out', async () => {
    const clock = movableClock();
    const cms = await site({ now: clock.now, loginAttempts: 3, loginLockout: 120 });
    await setUpFirstAdmin(browser(cms));

    const agent = browser(cms);
    for (let i = 0; i < 3; i += 1) await attempt(agent, 'ada', 'not the password');
    assert.equal((await attempt(agent, 'ada', 'correct horse battery')).status, 429);

    clock.advance(121);

    const allowed = await attempt(agent, 'ada', 'correct horse battery');
    assert.equal(allowed.status, 303);
    assert.equal(allowed.headers.get('location'), '/admin');
  });

  it('says the same thing about a username that does not exist', async () => {
    const clock = movableClock();
    const cms = await site({ now: clock.now, loginAttempts: 3, loginLockout: 120 });
    await setUpFirstAdmin(browser(cms));

    const agent = browser(cms);
    for (let i = 0; i < 3; i += 1) await attempt(agent, 'nobody', 'guess');

    const locked = await attempt(agent, 'nobody', 'guess');
    assert.equal(locked.status, 429, 'an unknown username locks out exactly as a real one does');
    assert.match(await locked.text(), /Too many sign-in attempts/);
  });

  it('lets one username go on trying while another is locked out', async () => {
    const clock = movableClock();
    const cms = await site({ now: clock.now, loginAttempts: 3, loginLockout: 120 });
    await setUpFirstAdmin(browser(cms));

    const agent = browser(cms);
    for (let i = 0; i < 3; i += 1) await attempt(agent, 'nobody', 'guess');
    assert.equal((await attempt(agent, 'nobody', 'guess')).status, 429);

    const allowed = await attempt(agent, 'ada', 'correct horse battery');
    assert.equal(allowed.status, 303, 'the site owner can still get in');
  });

  it('starts the count over after a sign-in that worked', async () => {
    const clock = movableClock();
    const cms = await site({ now: clock.now, loginAttempts: 3, loginLockout: 120 });
    await setUpFirstAdmin(browser(cms));

    const agent = browser(cms);
    await attempt(agent, 'ada', 'not the password');
    await attempt(agent, 'ada', 'not the password');
    assert.equal((await attempt(agent, 'ada', 'correct horse battery')).status, 303);

    const second = browser(cms);
    await attempt(second, 'ada', 'not the password');
    await attempt(second, 'ada', 'not the password');
    assert.equal(
      (await attempt(second, 'ada', 'correct horse battery')).status,
      303,
      'the two earlier failures were forgotten',
    );
  });

  it('holds the lockout longer each time it is tripped again', async () => {
    const clock = movableClock();
    const cms = await site({ now: clock.now, loginAttempts: 3, loginLockout: 60 });
    await setUpFirstAdmin(browser(cms));

    const agent = browser(cms);
    for (let i = 0; i < 3; i += 1) await attempt(agent, 'ada', 'not the password');
    assert.equal((await attempt(agent, 'ada', 'x')).headers.get('retry-after'), '60');

    clock.advance(61);
    await attempt(agent, 'ada', 'not the password');
    assert.equal((await attempt(agent, 'ada', 'x')).headers.get('retry-after'), '120');
  });
});

describe('the admin menu', () => {
  /** Just the navigation out of a rendered screen. */
  function nav(html: string): string {
    const start = html.indexOf('<nav class="admin-nav"');
    const end = html.indexOf('</nav>', start);
    assert.ok(start !== -1 && end !== -1, 'the screen rendered the admin navigation');
    return html.slice(start, end);
  }

  /** Whether a menu marks the link to `url` as the page being looked at. */
  function marks(menu: string, url: string): boolean {
    return new RegExp(`<a[^>]*href="${url}"[^>]*aria-current="page"`).test(menu);
  }

  it('lands every section on its first child, with that child marked', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    for (const section of ADMIN_SECTIONS) {
      const first = section.children[0];
      assert.ok(first !== undefined, `${section.label} has a child to land on`);

      const response = await agent.get(section.url);
      assert.equal(response.status, 200, `${section.url} is a screen`);

      const menu = nav(await response.text());
      assert.ok(marks(menu, first.url), `${section.label} marks ${first.label} as current`);
      for (const child of section.children) {
        assert.match(
          menu,
          new RegExp(`<a[^>]*href="${child.url}"[^>]*>${child.label}</a>`),
          `the open ${section.label} section lists ${child.label}`,
        );
      }
    }
  });

  it('puts a screen behind every child, each marking itself', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    for (const section of ADMIN_SECTIONS) {
      for (const child of section.children) {
        const response = await agent.get(child.url);
        assert.equal(response.status, 200, `${child.url} is a screen`);
        assert.ok(
          marks(nav(await response.text()), child.url),
          `${section.label} > ${child.label} marks itself`,
        );
      }
    }
  });

  it('shows the children of the open section and of no other', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const menu = nav(await (await agent.get('/admin/posts')).text());

    assert.match(
      menu,
      /<a[^>]*href="\/admin\/pages"[^>]*>Pages<\/a>/,
      'every section is still listed',
    );
    assert.doesNotMatch(menu, />All pages</, 'a closed section keeps its children to itself');
    assert.doesNotMatch(menu, />Add new<\/a>[\s\S]*>Add new</, 'only one Add new is rendered');
  });

  it('marks the child a screen is on rather than the first one', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const menu = nav(await (await agent.get('/admin/tags')).text());

    assert.ok(marks(menu, '/admin/tags'), 'Posts > Tags is where you are');
    assert.ok(!marks(menu, '/admin/posts'), 'and All posts is not');
    assert.match(menu, /Categories/, 'the Posts section is the one that opened');
  });

  it('needs no JavaScript to expand anything', async () => {
    const cms = await site();
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const menu = nav(await (await agent.get('/admin/posts/new')).text());

    assert.ok(marks(menu, '/admin/posts/new'), 'Posts > Add new is marked');
    assert.doesNotMatch(menu, /<script|onclick=|<button/, 'the menu is links and lists');
    assert.match(menu, /<ul[\s\S]*<ul/, 'the open section is a real nested list');
  });
});
