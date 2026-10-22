/**
 * The 404, 410, 500 and 503 pages in Markdown (TASK-478): a request for the
 * `.md` of a URL, or one whose `Accept` prefers Markdown, is told what
 * happened in Markdown, with the status the HTML would have had.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { TestContext } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { RECHECK_MS } from '../maintenance.ts';

const box = sandbox();
after(() => box.cleanup());

const NOW = Date.parse('2026-09-28T12:00:00Z');
let clock = NOW;

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

function post(slug: string): string {
  return `---\ntitle: ${slug}\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/${slug}/\n---\n\nBody of ${slug}.\n`;
}

async function site(theme?: Record<string, string>): Promise<Cms> {
  const contentDir = await box.dir('geekity-status-md-content-');
  const dataDir = await box.dir('geekity-status-md-data-');
  const themesDir = await box.dir('geekity-status-md-themes-');
  await writeTree(contentDir, {
    'posts/2026-09-02-hello.md': post('hello'),
    '_trash/posts/2026-09-02-gone.md': post('gone'),
    '_data/site.json': JSON.stringify({
      title: 'Field Notes',
      menus: { primary: [{ label: 'About', url: '/about/' }] },
      ...(theme === undefined ? {} : { theme: 'mine' }),
    }),
  });
  if (theme !== undefined) {
    await writeTree(path.join(themesDir, 'mine'), {
      'theme.json': JSON.stringify({ name: 'mine', kind: 'site' }),
      ...theme,
    });
  }
  const cms = await box.open({
    contentDir,
    dataDir,
    themesDir,
    baseUrl: 'https://blog.example',
    now: () => new Date(clock),
  });
  cms.app.get('/broken/*', () => {
    throw new Error('the store fell over');
  });
  return cms;
}

async function maintenance(cms: Cms, until?: Date): Promise<void> {
  await cms.settings.set(
    'maintenance',
    new Map<string, unknown>([
      ['on', true],
      ['until', until?.toISOString() ?? ''],
    ]),
    'cli',
  );
  clock += RECHECK_MS + 1;
}

function quiet(t: TestContext): void {
  t.mock.method(console, 'error', () => undefined);
}

async function get(cms: Cms, url: string, accept?: string): Promise<Response> {
  return cms.app.request(url, accept === undefined ? {} : { headers: { accept } });
}

function assertMarkdown(response: Response, status: number, type = 'text/markdown'): void {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('content-type'), `${type}; charset=utf-8`);
  assert.equal(response.headers.get('content-disposition'), 'inline');
}

function assertHtml(response: Response, status: number): void {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
}

const LINKS = /\[home\]\(\/index\.md\).*\[search the site\]\(\/search\/index\.md\)/s;

describe('a 404 asked for in Markdown (AC #1, #2)', () => {
  it('answers a .md URL that names nothing with a Markdown 404', async () => {
    const cms = await site();

    const response = await get(cms, '/2026/09/never/index.md');
    const text = await response.text();

    assertMarkdown(response, 404);
    assert.match(response.headers.get('vary') ?? '', /Accept/);
    assert.match(text, /^---\ntitle: Not found\nhome: \/index\.md\n---\n\n# Not found\n/);
    assert.match(text, /Content not found\./);
    assert.match(text, LINKS);
    assert.match(text, /## Feeds\n\n- \[Field Notes \(RSS\)\]\(\/feed\/\)/);
    assert.match(text, /- \[About\]\(\/about\/\)/, 'the site navigation, as on any page');
    assert.doesNotMatch(text, /<html/i);
  });

  it('answers by Accept: text/markdown, and text/plain under that label', async () => {
    const cms = await site();

    const markdown = await get(cms, '/2026/09/never/', 'text/markdown');
    assertMarkdown(markdown, 404);
    const plain = await get(cms, '/2026/09/never/', 'text/plain');
    assertMarkdown(plain, 404, 'text/plain');
    assert.equal(await plain.text(), await markdown.text());
  });

  it('stays HTML with no Accept, with */*, with a browser Accept and for JSON', async () => {
    const cms = await site();

    assertHtml(await get(cms, '/2026/09/never/'), 404);
    assertHtml(await get(cms, '/2026/09/never/', '*/*'), 404);
    assertHtml(
      await get(cms, '/2026/09/never/', 'text/html,application/xhtml+xml,text/markdown;q=0.9'),
      404,
    );
    assertHtml(await get(cms, '/2026/09/never/', 'image/png'), 404);
    assertHtml(await get(cms, '/2026/09/never/index.json'), 404);
  });

  it('still serves a .md that exists with a 200', async () => {
    const cms = await site();

    const response = await get(cms, '/2026/09/hello/index.md');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Body of hello\./);
  });
});

describe('a 410 asked for in Markdown (AC #1, #2)', () => {
  it('answers the .md of a deleted post with a Markdown 410', async () => {
    const cms = await site();

    const response = await get(cms, '/2026/09/gone/index.md');
    const text = await response.text();

    assertMarkdown(response, 410);
    assert.match(text, /^---\ntitle: Deleted\n/);
    assert.match(text, /This content has been deleted\./);
    assert.match(text, LINKS);
    assert.doesNotMatch(text, /Body of gone/);
  });

  it('answers Accept: text/markdown with a 410 and keeps HTML for a browser', async () => {
    const cms = await site();

    assertMarkdown(await get(cms, '/2026/09/gone/', 'text/markdown'), 410);
    assertHtml(await get(cms, '/2026/09/gone/'), 410);
  });
});

describe('a 500 asked for in Markdown (AC #1, #2)', () => {
  it('answers with the theme layout, home and search linked, nothing of the error in it', async (t) => {
    quiet(t);
    const cms = await site();

    const response = await get(cms, '/broken/index.md');
    const text = await response.text();

    assertMarkdown(response, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(text, /^---\ntitle: Something went wrong\n/);
    assert.match(text, /a problem on the server/);
    assert.match(text, LINKS);
    assert.doesNotMatch(text, /store fell over/);
  });

  it('answers Accept: text/plain with the same body', async (t) => {
    quiet(t);
    const cms = await site();

    const plain = await get(cms, '/broken/', 'text/plain');
    assertMarkdown(plain, 500, 'text/plain');
    assert.equal(await plain.text(), await (await get(cms, '/broken/index.md')).text());
  });
});

describe('the 503 asked for in Markdown (AC #1, #2)', () => {
  it('gives the back-by time when there is one, with Retry-After', async () => {
    const cms = await site();
    const until = new Date(NOW + 3_600_000);
    await maintenance(cms, until);

    const response = await get(cms, '/2026/09/hello/index.md');
    const text = await response.text();

    assertMarkdown(response, 503);
    assert.equal(response.headers.get('retry-after'), until.toUTCString());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(
      text,
      /^---\ntitle: Down for maintenance\nuntil: '2026-09-28T13:00:00\.000Z'\nhome: \/index\.md\n---/,
    );
    assert.match(text, /down for maintenance/);
    assert.match(text, /It should be back by Mon, 28 Sep 2026 13:00:00 GMT\./);
    assert.match(text, LINKS);
  });

  it('says nothing of a time when none was named', async () => {
    const cms = await site();
    await maintenance(cms);

    const response = await get(cms, '/2026/09/hello/', 'text/markdown');
    const text = await response.text();

    assertMarkdown(response, 503);
    assert.equal(response.headers.get('retry-after'), '600');
    assert.doesNotMatch(text, /back by|until:/);
    assertHtml(await get(cms, '/2026/09/hello/'), 503);
  });
});

describe('a theme’s Markdown status pages (AC #3)', () => {
  const THEME = {
    'layouts/404.md.njk': 'Nothing at {{ url }}. [Start over]({{ "/" | markdownUrl }})\n',
    'layouts/410.md.njk': 'Gone from {{ url }}.\n',
    'layouts/500.md.njk': 'Broke at {{ url }}.\n',
    'layouts/503.md.njk': 'Away until {{ untilText }}.\n',
  };

  it('takes each body from the site theme, between the header and footer', async (t) => {
    quiet(t);
    const cms = await site(THEME);

    const missing = await (await get(cms, '/2026/09/never/index.md')).text();
    assert.match(
      missing,
      /# Not found\n\nNothing at \/2026\/09\/never\/index\.md\. \[Start over\]\(\/index\.md\)\n\n## Feeds/,
    );
    assert.match(
      await (await get(cms, '/2026/09/gone/index.md')).text(),
      /Gone from \/2026\/09\/gone\/index\.md\./,
    );
    assert.match(
      await (await get(cms, '/broken/index.md')).text(),
      /Broke at \/broken\/index\.md\./,
    );

    await maintenance(cms, new Date(NOW + 3_600_000));
    assert.match(
      await (await get(cms, '/2026/09/hello/index.md')).text(),
      /Away until Mon, 28 Sep 2026 13:00:00 GMT\./,
    );
  });

  it('takes the header and footer from the theme too', async () => {
    const cms = await site({
      'partials/markdown-header.md.njk': 'TOP {{ type }} {{ title }}\n',
      'partials/markdown-footer.md.njk': 'BOTTOM\n',
    });

    const text = await (await get(cms, '/2026/09/never/index.md')).text();
    assert.match(text, /TOP status Not found\n\nContent not found\.[^]*\n\nBOTTOM\n$/);
  });

  it('falls back to a fixed body when a 500 or 503 template fails', async (t) => {
    quiet(t);
    const cms = await site({
      'layouts/500.md.njk': '{{ explode() }}',
      'layouts/503.md.njk': '{{ explode() }}',
    });

    const failed = await get(cms, '/broken/index.md');
    assertMarkdown(failed, 500);
    assert.match(await failed.text(), /^# Something went wrong/);

    await maintenance(cms);
    const away = await get(cms, '/2026/09/hello/index.md');
    assertMarkdown(away, 503);
    assert.match(await away.text(), /^# Down for maintenance/);
  });
});
