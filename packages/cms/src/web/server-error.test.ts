/**
 * What a reader gets when a request fails on the server (TASK-129): the theme's
 * 500 page, or the admin's, or the representation they asked for, and never
 * the stack trace. Everything goes through HTTP, because a 500 is only what a
 * client is told.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { TestContext } from 'node:test';

import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { PACKAGED_THEME_DIR } from './themes.ts';

const box = sandbox();
after(() => box.cleanup());

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

const POST = `---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/hello/\n---\n\nBody of hello.\n`;

/** A post layout that fails the way a broken theme does: calling nothing. */
const BROKEN_POST = '{{ explode() }}';

interface Site {
  cms: Cms;
  themesDir: string;
}

/** A CMS wearing a theme made of `layouts`, over one post. */
async function site(layouts: Record<string, string>): Promise<Site> {
  const contentDir = await box.dir('geekity-500-content-');
  const dataDir = await box.dir('geekity-500-data-');
  const themesDir = await box.dir('geekity-500-themes-');

  await writeTree(path.join(themesDir, 'broken'), {
    'theme.json': JSON.stringify({ name: 'Broken', kind: 'site' }),
    ...Object.fromEntries(Object.entries(layouts).map(([name, body]) => [`layouts/${name}`, body])),
  });
  await writeTree(contentDir, {
    'posts/2026-09-02-hello.md': POST,
    '_data/site.json': JSON.stringify({ title: 'A Site', theme: 'broken' }),
  });

  const cms = await box.open({ contentDir, dataDir, themesDir });
  return { cms, themesDir };
}

/** Swallow the operator's log for one test and hand back what was written. */
function captureLog(t: TestContext): () => string {
  const error = t.mock.method(console, 'error', () => undefined);
  return () =>
    error.mock.calls
      .map((call) => call.arguments.map((argument) => String(argument)).join(' '))
      .join('\n');
}

/** What must never reach a reader: a stack frame, or where anything lives on disk. */
function assertNothingInternal(body: string, themesDir?: string): void {
  assert.doesNotMatch(body, /\n\s+at /, 'no stack frame');
  assert.doesNotMatch(body, /explode|Template render error|Error:/, 'no error message');
  assert.ok(!body.includes(PACKAGED_THEME_DIR), 'no packaged path');
  if (themesDir !== undefined) assert.ok(!body.includes(themesDir), 'no theme path');
}

describe('an exception while rendering a public page', () => {
  it("answers 500 with the default theme's 500 page when the theme has none", async (t) => {
    const log = captureLog(t);
    const { cms, themesDir } = await site({ 'post.njk': BROKEN_POST });

    const response = await cms.app.request('/2026/09/hello/');
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    assert.match(body, /<article class="server-error">/);
    assert.match(body, /Something went wrong/);
    assert.match(body, /<a href="\/">home<\/a>/);
    assertNothingInternal(body, themesDir);
    assert.match(log(), /GET \/2026\/09\/hello\//, 'the operator is told which path failed');
    assert.match(log(), /explode/, 'and why');
  });

  it("answers with the theme's own 500 template when it ships one", async (t) => {
    captureLog(t);
    const { cms } = await site({
      'post.njk': BROKEN_POST,
      '500.njk': '<!doctype html><title>{{ title }}</title><p class="own">ours at {{ url }}</p>',
    });

    const response = await cms.app.request('/2026/09/hello/');

    assert.equal(response.status, 500);
    assert.match(await response.text(), /<p class="own">ours at \/2026\/09\/hello\/<\/p>/);
  });

  it('falls back to a static page when the 500 template fails too', async (t) => {
    const log = captureLog(t);
    const { cms, themesDir } = await site({
      'post.njk': BROKEN_POST,
      '500.njk': '{{ explodeAgain() }}',
    });

    const response = await cms.app.request('/2026/09/hello/');
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    assert.match(body, /^<!doctype html>/);
    assert.match(body, /<a href="\/">/);
    assertNothingInternal(body, themesDir);
    assert.doesNotMatch(body, /explodeAgain/);
    assert.match(log(), /explodeAgain/, 'the second failure is logged as well');
  });

  it('is not cached, keeps the baseline headers and is no redirect', async (t) => {
    captureLog(t);
    const { cms } = await site({ 'post.njk': BROKEN_POST });

    const response = await cms.app.request('/2026/09/hello/');

    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(response.headers.get('x-redirect-by'), null);
  });
});

describe('an exception behind a JSON or Markdown representation', () => {
  /** A site with a public route that throws at every spelling of one URL. */
  async function throwing(t: TestContext): Promise<{ cms: Cms; log: () => string }> {
    const log = captureLog(t);
    const cms = await box.site();
    cms.app.get('/broken/*', () => {
      throw new Error('the store fell over at /var/lib/geekity/site.db');
    });
    return { cms, log };
  }

  it('answers a .json URL with a JSON 500', async (t) => {
    const { cms, log } = await throwing(t);

    const response = await cms.app.request('/broken/index.json');
    const text = await response.text();

    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(JSON.parse(text), {
      error: 'internal_server_error',
      message: 'Something went wrong on the server. Try again later.',
    });
    assert.ok(!text.includes('/var/lib'), 'no internal path');
    assert.match(log(), /GET \/broken\/index\.json/);
  });

  it('answers a .md URL with a Markdown 500', async (t) => {
    const { cms } = await throwing(t);

    const response = await cms.app.request('/broken/index.md');
    const text = await response.text();

    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type') ?? '', /^text\/markdown/);
    assert.match(text, /^# Something went wrong/);
    assert.match(text, /\[home page\]\(\/\)/);
    assert.ok(!text.includes('/var/lib'), 'no internal path');
    assert.doesNotMatch(text, /<html/i);
  });

  it('answers by Accept when the URL names no representation', async (t) => {
    const { cms } = await throwing(t);

    const json = await cms.app.request('/broken/', { headers: { accept: 'application/json' } });
    assert.equal(json.status, 500);
    assert.match(json.headers.get('content-type') ?? '', /^application\/json/);

    const markdown = await cms.app.request('/broken/', { headers: { accept: 'text/markdown' } });
    assert.equal(markdown.status, 500);
    assert.match(markdown.headers.get('content-type') ?? '', /^text\/markdown/);

    const plain = await cms.app.request('/broken/', { headers: { accept: 'text/plain' } });
    assert.equal(plain.status, 500);
    assert.equal(plain.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await plain.text(), await markdown.text());

    const html = await cms.app.request('/broken/', { headers: { accept: 'image/png' } });
    assert.equal(html.status, 500);
    assert.match(html.headers.get('content-type') ?? '', /^text\/html/);
    assert.match(await html.text(), /class="server-error"/);
  });
});

describe('an exception in the admin', () => {
  it("answers 500 in the admin's own layout, not the theme's", async (t) => {
    const log = captureLog(t);
    const cms = await box.site();
    cms.app.get('/admin/broken', () => {
      throw new Error('the dashboard fell over at /var/lib/geekity/site.db');
    });
    const agent = await signedIn(cms);

    const response = await agent.get('/admin/broken');
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(body, /<link rel="stylesheet" href="\/admin\/_static\/admin\.css"/);
    assert.match(body, /<meta name="robots" content="noindex, nofollow"/);
    assert.match(body, /Something went wrong/);
    assert.match(body, /<a\b[^>]*href="\/admin">/);
    assert.doesNotMatch(body, /class="server-error"/, "not the theme's page");
    assert.ok(!body.includes('/var/lib'), 'no internal path');
    assert.ok(
      response.headers.get('content-security-policy') !== null,
      "the admin's own headers still apply",
    );
    assert.match(log(), /GET \/admin\/broken/);
  });
});
