/**
 * The public site's security headers (TASK-131): the ones that restrict
 * nothing a theme loads, on every kind of response the public site sends, and
 * the config that changes or removes each of them.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { GeekityConfig } from '../config.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const POST = `---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/hello/\n---\n\nBody of hello.\n`;

const PUBLIC_DEFAULTS = {
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "frame-ancestors 'self'",
  'x-frame-options': 'SAMEORIGIN',
  'cross-origin-opener-policy': 'same-origin',
} as const;

const POWERFUL_FEATURES = ['camera', 'microphone', 'geolocation', 'payment', 'usb'];

async function site(config: GeekityConfig = {}): Promise<{ cms: Cms; dataDir: string }> {
  const contentDir = await box.dir('geekity-headers-content-');
  const dataDir = await box.dir('geekity-headers-data-');
  const files = {
    'posts/2026-09-02-hello.md': POST,
    'uploads/2026/09/notes.txt': 'Attached.\n',
  };
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(contentDir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, 'utf8');
  }
  const cms = await box.open({ contentDir, dataDir, ...config });
  return { cms, dataDir };
}

function assertPublicDefaults(response: Response, what: string): void {
  for (const [name, value] of Object.entries(PUBLIC_DEFAULTS)) {
    assert.equal(response.headers.get(name), value, `${what}: ${name}`);
  }
  const permissions = response.headers.get('permissions-policy') ?? '';
  for (const feature of POWERFUL_FEATURES) {
    assert.match(permissions, new RegExp(`(^|, )${feature}=\\(\\)`), `${what}: ${feature} is off`);
  }
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `${what}: nosniff`);
}

describe('public security headers', () => {
  it('puts the defaults on a page, a feed and an upload', async () => {
    const { cms } = await site();

    const page = await cms.app.request('/2026/09/hello/');
    const feed = await cms.app.request('/feed/');
    const upload = await cms.app.request('/uploads/2026/09/notes.txt');

    assert.equal(page.status, 200);
    assert.equal(feed.status, 200);
    assert.match(feed.headers.get('content-type') ?? '', /xml/);
    assert.equal(upload.status, 200);
    assertPublicDefaults(page, 'page');
    assertPublicDefaults(feed, 'feed');
    assertPublicDefaults(upload, 'upload');
  });

  it('puts them on a 404, a redirect and the maintenance 503 too', async () => {
    const { cms } = await site();
    const { cms: down } = await site({ maintenance: true });

    const missing = await cms.app.request('/nowhere-at-all/');
    const redirect = await cms.app.request('/2026/09/hello');
    const unavailable = await down.app.request('/2026/09/hello/');

    assert.equal(missing.status, 404);
    assert.equal(redirect.status, 301);
    assert.equal(unavailable.status, 503);
    assertPublicDefaults(missing, '404');
    assertPublicDefaults(redirect, 'redirect');
    assertPublicDefaults(unavailable, '503');
  });

  it('sends no content directive: frame-ancestors is the whole policy', async () => {
    const { cms } = await site();

    const policy = (await cms.app.request('/')).headers.get('content-security-policy');

    assert.equal(policy, "frame-ancestors 'self'");
    assert.doesNotMatch(policy ?? '', /-src|default-src|sandbox/);
  });

  it('lets a site replace a header, remove one and add its own', async () => {
    const { cms } = await site({
      securityHeaders: {
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Opener-Policy': false,
        'content-security-policy': false,
        'X-Frame-Options': false,
        'Cross-Origin-Resource-Policy': 'same-site',
      },
    });

    const response = await cms.app.request('/2026/09/hello/');

    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cross-origin-opener-policy'), null);
    assert.equal(response.headers.get('content-security-policy'), null);
    assert.equal(response.headers.get('x-frame-options'), null);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-site');
    assert.match(response.headers.get('permissions-policy') ?? '', /camera=\(\)/, 'untouched');
  });
});
