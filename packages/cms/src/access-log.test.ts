import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { Hono } from 'hono';

import { createAccessLog } from './access-log.ts';
import type { GeekityEnv } from './env.ts';
import {
  FIRST_ADMIN,
  browser,
  csrfField,
  sandbox,
  setUpFirstAdmin,
} from './admin/__testing__/harness.ts';

const box = sandbox();

after(async () => {
  await box.cleanup();
});

/** A sink that keeps what the log wrote, so no test has to capture stdout. */
function recorder(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    write(line) {
      lines.push(line);
    },
  };
}

describe('the access log', () => {
  it('writes one line naming the method, the path, the status and the duration', async () => {
    const log = recorder();
    const cms = await box.site({ accessLog: true, accessLogWriter: log.write });

    const response = await cms.app.request('/');

    assert.equal(response.status, 200);
    assert.equal(log.lines.length, 1);
    assert.match(log.lines[0] ?? '', /^GET \/ 200 \d+(\.\d+)?ms$/);
  });

  it('says nothing at all unless the site asked for it', async () => {
    const log = recorder();
    const cms = await box.site({ accessLogWriter: log.write });

    await cms.app.request('/');

    assert.deepEqual(log.lines, []);
  });

  it('is turned on by the environment, which wins over the config', async () => {
    const log = recorder();
    const previous = process.env['GEEKITY_ACCESS_LOG'];
    try {
      process.env['GEEKITY_ACCESS_LOG'] = 'yes';
      const on = await box.site({ accessLogWriter: log.write });
      await on.app.request('/');
      assert.equal(log.lines.length, 1, 'GEEKITY_ACCESS_LOG=yes turned it on');

      process.env['GEEKITY_ACCESS_LOG'] = 'off';
      const off = await box.site({ accessLog: true, accessLogWriter: log.write });
      await off.app.request('/');
      assert.equal(log.lines.length, 1, 'GEEKITY_ACCESS_LOG=off beat accessLog: true');
    } finally {
      if (previous === undefined) delete process.env['GEEKITY_ACCESS_LOG'];
      else process.env['GEEKITY_ACCESS_LOG'] = previous;
    }
  });

  it('leaves the client address off until the site asks for it', async () => {
    const log = recorder();
    const cms = await box.site({
      accessLog: true,
      accessLogWriter: log.write,
      trustProxy: true,
    });

    await cms.app.request('/', { headers: { 'x-forwarded-for': '203.0.113.9' } });

    assert.match(log.lines[0] ?? '', /^GET \/ 200 \d+(\.\d+)?ms$/);
    assert.ok(!(log.lines[0] ?? '').includes('203.0.113.9'), 'no address was logged');
  });

  it('logs the address trustProxy makes right, and no other', async () => {
    const believed = recorder();
    const behindProxy = await box.site({
      accessLog: true,
      accessLogAddress: true,
      accessLogWriter: believed.write,
      trustProxy: true,
    });

    await behindProxy.app.request('/', {
      headers: { 'x-forwarded-for': '203.0.113.9, 70.41.3.18' },
    });

    assert.match(believed.lines[0] ?? '', /^GET \/ 200 \d+(\.\d+)?ms 203\.0\.113\.9$/);

    const disbelieved = recorder();
    const reachedDirectly = await box.site({
      accessLog: true,
      accessLogAddress: true,
      accessLogWriter: disbelieved.write,
    });

    await reachedDirectly.app.request('/', { headers: { 'x-forwarded-for': '203.0.113.9' } });

    assert.ok(
      !(disbelieved.lines[0] ?? '').includes('203.0.113.9'),
      'a site not behind a proxy did not believe the header',
    );
  });

  it('logs the socket address of a really served request', async () => {
    const log = recorder();
    const cms = await box.site({
      port: 0,
      accessLog: true,
      accessLogAddress: true,
      accessLogWriter: log.write,
    });
    const { port } = await cms.serve();

    const response = await fetch(`http://127.0.0.1:${String(port)}/healthz`);
    await response.text();

    assert.equal(response.status, 200);
    assert.match(
      log.lines.at(-1) ?? '',
      /^GET \/healthz 200 \d+(\.\d+)?ms (?:127\.0\.0\.1|::ffff:127\.0\.0\.1|::1)$/,
    );
  });

  it('keeps a posted password, its form token and the session cookie out of the lines', async () => {
    const log = recorder();
    const cms = await box.site({ accessLog: true, accessLogWriter: log.write });
    const agent = browser(cms);
    await setUpFirstAdmin(agent);

    const form = await agent.get('/admin/login');
    const token = csrfField(await form.text());
    assert.ok(token !== undefined, 'the login form carried a CSRF token');
    const response = await agent.post('/admin/login', {
      csrf_token: token,
      username: FIRST_ADMIN.username,
      password: FIRST_ADMIN.password,
    });
    assert.equal(response.status, 303, 'the credentials were accepted');

    const session = agent.session();
    assert.ok(session !== undefined, 'the site set a session cookie');
    assert.ok(
      log.lines.some((line) => /^POST \/admin\/login 303 \d+(\.\d+)?ms$/.test(line)),
      `a line for the sign-in, and nothing else on it: ${log.lines.join(' | ')}`,
    );
    for (const line of log.lines) {
      assert.ok(!line.includes(FIRST_ADMIN.password), `no password in ${line}`);
      assert.ok(!line.includes(token), `no form token in ${line}`);
      assert.ok(!line.includes(session), `no session cookie in ${line}`);
      assert.ok(!/csrf|cookie|authorization/i.test(line), `nothing from the headers in ${line}`);
    }
  });

  it('covers every route: the health check, federation, the admin and the site', async () => {
    const log = recorder();
    const cms = await box.site({ accessLog: true, accessLogWriter: log.write });

    await cms.app.request('/healthz');
    await cms.app.request('/.well-known/webfinger?resource=acct:ghost@example.com');
    await cms.app.request('/admin/login');
    await cms.app.request('/nothing-here');

    const [health, webfinger, admin, missing] = log.lines;
    assert.equal(log.lines.length, 4, log.lines.join(' | '));
    assert.match(health ?? '', /^GET \/healthz 200 \d+(\.\d+)?ms$/);
    assert.match(
      webfinger ?? '',
      /^GET \/\.well-known\/webfinger\?resource=acct(:|%3A)ghost(@|%40)example\.com \d{3} \d+(\.\d+)?ms$/,
    );
    // 302: a site with no admin yet sends the login form to the setup screen.
    assert.match(admin ?? '', /^GET \/admin\/login 302 \d+(\.\d+)?ms$/);
    assert.match(missing ?? '', /^GET \/nothing-here 404 \d+(\.\d+)?ms$/);
  });

  it('logs the 500 a handler that threw is answered with', async () => {
    const log = recorder();
    const app = new Hono<GeekityEnv>();
    app.use(
      '*',
      createAccessLog({
        config: { accessLogAddress: false, trustProxy: false },
        write: log.write,
      }),
    );
    app.get('/boom', () => {
      throw new Error('the handler fell over');
    });

    const response = await app.request('/boom');

    assert.equal(response.status, 500);
    assert.match(log.lines[0] ?? '', /^GET \/boom 500 \d+(\.\d+)?ms$/);
  });
});
