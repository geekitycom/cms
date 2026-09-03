import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

describe('the admin stylesheet', () => {
  it('is served as a file, with a cache header', async () => {
    const cms = await box.site();

    const response = await cms.app.request('/admin/_static/admin.css');
    const css = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/css/);
    assert.match(response.headers.get('cache-control') ?? '', /max-age=\d+/);
    assert.ok(response.headers.get('etag') !== null, 'and a validator');
    assert.match(css, /admin-nav/, 'and it is the admin stylesheet');
  });

  it('is readable while logged out, because the login page links to it', async () => {
    const cms = await box.site();
    await signedIn(cms);

    // A fresh, session-less request: the guard sends these to the login form
    // everywhere else under /admin.
    const response = await cms.app.request('/admin/_static/admin.css');
    assert.equal(response.status, 200);
  });

  it('answers a conditional request with 304', async () => {
    const cms = await box.site();
    const first = await cms.app.request('/admin/_static/admin.css');
    const etag = first.headers.get('etag');
    assert.ok(etag !== null);

    const second = await cms.app.request('/admin/_static/admin.css', {
      headers: { 'if-none-match': etag },
    });

    assert.equal(second.status, 304);
    assert.equal(await second.text(), '');
  });

  it('does not serve anything outside its own directory', async () => {
    const cms = await box.site();

    for (const url of [
      '/admin/_static/../../package.json',
      '/admin/_static/%2e%2e/%2e%2e/package.json',
      '/admin/_static/nothing.css',
    ]) {
      const response = await cms.app.request(url);
      assert.notEqual(response.status, 200, url);
    }
  });

  it('is linked from every admin page', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const dashboard = await (await agent.get('/admin')).text();
    const login = await (await cms.app.request('/admin/login')).text();

    for (const html of [dashboard, login]) {
      assert.match(html, /<link[^>]+href="\/admin\/_static\/admin\.css"/);
      assert.ok(!/<style/.test(html), 'the admin stylesheet is a file, not inline CSS');
    }
  });
});
