/**
 * A theme's Gemini templates (TASK-482, decision-60): each Gemini slot is
 * the chosen theme's `.gmi.njk`, else its `.md.njk` converted, else the
 * default theme's `.gmi.njk`, else the default theme's `.md.njk` converted.
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

async function site(theme?: Record<string, string>): Promise<Cms> {
  const contentDir = await box.dir('geekity-gmi-theme-content-');
  const dataDir = await box.dir('geekity-gmi-theme-data-');
  const themesDir = await box.dir('geekity-gmi-theme-themes-');
  await writeTree(contentDir, {
    'posts/2026-09-02-hello.md':
      "---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/hello/\n---\n\nRead [about](/about/) first.\n",
    'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nWho writes this.\n',
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

async function gemtext(cms: Cms, url: string, status = 200): Promise<string> {
  const response = await cms.app.request(url);
  assert.equal(response.status, status, url);
  assert.equal(response.headers.get('content-type'), 'text/gemini; charset=utf-8', url);
  return response.text();
}

async function maintenance(cms: Cms): Promise<void> {
  await cms.settings.set(
    'maintenance',
    new Map<string, unknown>([
      ['on', true],
      ['until', new Date(NOW + 3_600_000).toISOString()],
    ]),
    'cli',
  );
  clock += RECHECK_MS + 1;
}

function quiet(t: TestContext): void {
  t.mock.method(console, 'error', () => undefined);
}

describe('a theme’s .gmi.njk templates (AC #1, #2, #3)', () => {
  const THEME = {
    'partials/gemini-header.gmi.njk':
      '# {{ title }}\n*{{ type }}* at {{ url }}\n=> {{ "/about/" | geminiUrl }} About us\n',
    'partials/gemini-footer.gmi.njk':
      '=> {{ "https://elsewhere.example/x/" | geminiUrl }} Elsewhere\n=> {{ home.url | geminiUrl }} {{ home.label }}\n',
    'layouts/404.gmi.njk': '*Nothing* at {{ url }}.\n',
    'layouts/410.gmi.njk': 'Gone from {{ url }}.\n',
    'layouts/500.gmi.njk': 'Broke at {{ url }}.\n',
    'layouts/503.gmi.njk': 'Away until {{ untilText }}.\n',
  };

  it('writes the header and footer as the theme wrote them, with the Markdown context', async () => {
    const cms = await site(THEME);

    const text = await gemtext(cms, '/2026/09/hello/index.gmi');
    assert.equal(
      text,
      [
        '# Hello',
        '*post* at /2026/09/hello/',
        '=> /about/index.gmi About us',
        '',
        'Published 2026-09-02',
        '',
        'Read about[1] first.',
        '',
        '=> /about/index.gmi 1: /about/index.gmi',
        '',
        '=> https://elsewhere.example/x/ Elsewhere',
        '=> /index.gmi Home',
        '',
      ].join('\n'),
    );
  });

  it('writes each status body as the theme wrote it', async (t) => {
    quiet(t);
    const cms = await site(THEME);

    assert.match(
      await gemtext(cms, '/2026/09/never/index.gmi', 404),
      /^# Not found\n\*status\* at \/2026\/09\/never\/index\.gmi\n[^]*\n\*Nothing\* at \/2026\/09\/never\/index\.gmi\.\n/,
    );
    assert.match(await gemtext(cms, '/2026/09/gone/index.gmi', 404), /\*Nothing\*/);
    assert.match(
      await gemtext(cms, '/broken/index.gmi', 500),
      /\nBroke at \/broken\/index\.gmi\.\n/,
    );

    await maintenance(cms);
    assert.match(
      await gemtext(cms, '/2026/09/hello/index.gmi', 503),
      /\nAway until Mon, 28 Sep 2026 13:00:00 GMT\.\n/,
    );
  });

  it('leaves the Markdown representation to the Markdown templates', async () => {
    const cms = await site(THEME);

    const markdown = await (await cms.app.request('/2026/09/hello/index.md')).text();
    assert.doesNotMatch(markdown, /About us|Elsewhere/);
    assert.match(markdown, /^---\ntitle: Hello\n/);
  });

  it('prefers the chosen theme’s .gmi.njk to its .md.njk', async () => {
    const cms = await site({
      'layouts/404.gmi.njk': 'From the gemtext.\n',
      'layouts/404.md.njk': 'From the Markdown.\n',
    });

    const text = await gemtext(cms, '/2026/09/never/index.gmi', 404);
    assert.match(text, /From the gemtext\./);
    assert.doesNotMatch(text, /From the Markdown/);
  });

  it('numbers the converted links through the page around a gemtext body', async () => {
    const cms = await site({
      'partials/markdown-header.md.njk':
        '# {{ title }}\n\nAbove, see [about]({{ "/about/" | markdownUrl }}).\n',
      'partials/markdown-footer.md.njk':
        'Below, see [hello]({{ "/2026/09/hello/" | markdownUrl }}).\n',
      'layouts/404.gmi.njk': '=> {{ "/" | geminiUrl }} Home\n',
    });

    assert.equal(
      await gemtext(cms, '/2026/09/never/index.gmi', 404),
      [
        '# Not found',
        '',
        'Above, see about[1].',
        '',
        '=> /about/index.gmi 1: /about/index.gmi',
        '',
        '=> /index.gmi Home',
        '',
        'Below, see hello[2].',
        '',
        '=> /2026/09/hello/index.gmi 2: /2026/09/hello/index.gmi',
        '',
      ].join('\n'),
    );
  });
});

describe('a theme with only Markdown templates (AC #2)', () => {
  it('converts the chosen theme’s .md.njk ahead of the default theme’s .gmi.njk', async () => {
    const cms = await site({
      'partials/markdown-header.md.njk': '# {{ title }}\n\nA **custom** header.\n',
      'layouts/404.md.njk': 'Nothing here. [Start over]({{ "/" | markdownUrl }})\n',
    });

    const text = await gemtext(cms, '/2026/09/never/index.gmi', 404);
    assert.match(
      text,
      /^# Not found\n\nA custom header\.\n\nNothing here\. Start over\[1\]\n\n=> \/index\.gmi 1: \/index\.gmi\n/,
    );
    assert.doesNotMatch(text, /Content not found/);
  });
});

describe('a theme with neither (AC #2, #4)', () => {
  for (const [label, theme] of [
    ['no theme chosen', undefined],
    ['a theme that writes neither', { 'layouts/post.njk': '{{ content | safe }}' }],
  ] as const) {
    it(`takes the default theme’s Gemini status bodies and converted chrome: ${label}`, async () => {
      const cms = await site(theme);

      const text = await gemtext(cms, '/2026/09/never/index.gmi', 404);
      assert.match(
        text,
        /^# Not found\n\nContent not found\.\n\n=> \/index\.gmi Home\n=> \/search\/index\.gmi Search the site\n\n## Feeds\n/,
      );
      assert.doesNotMatch(text, /\[\d\]/, 'no footnoted links');
      assert.equal(text.split('\n').filter((line) => line === '=> /index.gmi Home').length, 1);
    });
  }
});

describe('a broken 500 or 503 Gemini template (AC #5)', () => {
  it('falls back to the fixed body, converted', async (t) => {
    quiet(t);
    const cms = await site({
      'layouts/500.gmi.njk': '{{ explode() }}',
      'layouts/503.gmi.njk': '{{ explode() }}',
    });

    const failed = await gemtext(cms, '/broken/index.gmi', 500);
    assert.match(
      failed,
      /^# Something went wrong\n\nThe server could not answer this request\. Try again later, or go to the home page\[1\]\.\n\n=> \/ 1: \/\n/,
    );

    await maintenance(cms);
    assert.equal(
      await gemtext(cms, '/2026/09/hello/index.gmi', 503),
      '# Down for maintenance\n\nThis site is down for maintenance and will be back shortly. Please try again later.\n',
    );
  });
});
