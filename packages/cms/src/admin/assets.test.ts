import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

/**
 * Every inline `<style>` in an admin page but the two the admin bar carries
 * (decision-30), each with the nonce the response's policy names: its offset
 * stylesheet right before the host, and the first one in its shadow root.
 */
function strayStyles(html: string, csp: string): string[] {
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  const bar =
    /<style id="geekity-admin-bar-offset"[^>]*>[^<]*<\/style><geekity-admin-bar\b[\s\S]*?<\/geekity-admin-bar>/.exec(
      html,
    )?.[0] ?? '';
  const tags = (text: string): string[] =>
    [...text.matchAll(/<style\b[^>]*>/g)].map(([tag]) => tag);
  const allowed = [
    `<style id="geekity-admin-bar-offset" nonce="${nonce ?? ''}">`,
    `<style nonce="${nonce ?? ''}">`,
  ];
  return [
    ...tags(html.replace(bar, '')),
    ...tags(bar).filter((tag, index) => nonce === undefined || tag !== allowed[index]),
  ];
}

describe('the admin stylesheet', () => {
  it('is served as a file, with a cache header', async () => {
    const cms = await box.site();

    const response = await cms.app.request('/admin/_static/admin.css');
    const css = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/css/);
    assert.match(response.headers.get('cache-control') ?? '', /max-age=\d+/);
    assert.ok(response.headers.get('etag') !== null, 'and a validator');
    assert.match(css, /\[data-theme="dark"\]/, 'and it is the compiled admin stylesheet');
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

  it("is linked from every admin page, whose only inline stylesheets are the admin bar's two nonced ones", async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    for (const response of [await agent.get('/admin'), await cms.app.request('/admin/login')]) {
      const html = await response.text();
      assert.match(html, /<link[^>]+href="\/admin\/_static\/admin\.css"/);
      assert.deepEqual(
        strayStyles(html, response.headers.get('content-security-policy') ?? ''),
        [],
        'the admin stylesheet is a file, not inline CSS',
      );
    }
  });

  it("would refuse an inline stylesheet outside the bar, or one in it without the response's nonce", () => {
    const bar = (offset: string, inner: string): string =>
      `${offset}</style><geekity-admin-bar><template shadowrootmode="open">${inner}</template></geekity-admin-bar>`;
    const offset = '<style id="geekity-admin-bar-offset" nonce="abc">';
    const csp = "style-src 'self' 'nonce-abc'";
    assert.deepEqual(strayStyles(bar(offset, '<style nonce="abc">'), csp), []);
    assert.deepEqual(strayStyles(bar(offset, '<style>'), csp), ['<style>']);
    assert.deepEqual(strayStyles(bar(offset, '<style nonce="xyz">'), csp), ['<style nonce="xyz">']);
    assert.deepEqual(
      strayStyles(bar('<style id="geekity-admin-bar-offset">', '<style nonce="abc">'), csp),
      ['<style id="geekity-admin-bar-offset">'],
    );
    assert.deepEqual(
      strayStyles(bar(offset, '<style nonce="abc"></style><style nonce="abc">'), csp),
      ['<style nonce="abc">'],
    );
    assert.deepEqual(strayStyles(`<style nonce="abc">${bar(offset, '<style nonce="abc">')}`, csp), [
      '<style nonce="abc">',
    ]);
  });
});
