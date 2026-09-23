/**
 * A post with no title is a note (Post Type Discovery, TASK-119): the page,
 * the listings and the three feeds each draw it by its content, and none of
 * them prints an empty name for it. Asserted over HTTP against the packaged
 * theme, because the markup is the behaviour.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/2026-09-10-coffee.md': [
    '---',
    "date: '2026-09-10T09:00:00Z'",
    '---',
    '',
    'Coffee first. Then **the** inbox, and after that a long walk by the river to think.',
    '',
  ].join('\n'),
  'posts/2026-09-05-gardens.md': [
    '---',
    'title: On gardens',
    "date: '2026-09-05T09:00:00Z'",
    'permalink: /2026/09/on-gardens/',
    '---',
    '',
    'The tomatoes came in late this year.',
    '',
  ].join('\n'),
  'pages/archive.md': [
    '---',
    'title: Everything',
    'permalink: /archive/',
    'archive: true',
    '---',
    '',
    'All of it.',
    '',
  ].join('\n'),
};

const NOTE = '/2026/09/coffee/';
const NOTE_LABEL = 'Coffee first. Then the inbox, and after that a long …';

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-notes-content-');
  const dataDir = await box.dir('geekity-notes-data-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  cms = await box.open({ contentDir, dataDir });
});

async function get(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

function main(html: string): string {
  return /<main id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
}

/** The first element matching `pattern` whose markup mentions `url`. */
function blockFor(html: string, pattern: RegExp, url: string): string {
  const found = [...html.matchAll(pattern)].map((match) => match[0]).find((m) => m.includes(url));
  assert.ok(found !== undefined, `nothing in the response links ${url}`);
  return found;
}

describe('a note’s own page', () => {
  it('draws no heading and no p-name, only the content', async () => {
    const article = main(await get(NOTE));

    assert.doesNotMatch(article, /p-name/, 'a note prints a p-name');
    assert.doesNotMatch(article, /<h1/, 'a note prints a heading');
    assert.match(
      article,
      /<section class="e-content">\s*<p>Coffee first\. Then <strong>the<\/strong> inbox/,
      'the note’s content is not its e-content',
    );
  });

  it('is named in the document head by its first words', async () => {
    const html = await get(NOTE);

    assert.match(html, new RegExp(`<title>${NOTE_LABEL} &middot; A Site</title>`));
    assert.match(html, new RegExp(`<meta property="og:title" content="${NOTE_LABEL}">`));
    assert.match(html, new RegExp(`title="Comments on: ${NOTE_LABEL}"`));
  });

  it('still heads an article with its title', async () => {
    assert.match(
      main(await get('/2026/09/on-gardens/')),
      /<h1 class="p-name">On gardens<\/h1>/,
      'an article lost its heading',
    );
  });

  it('is linked from its neighbour by its first words', async () => {
    assert.match(
      main(await get('/2026/09/on-gardens/')),
      new RegExp(`<a rel="next" href="${NOTE}">${NOTE_LABEL} &rarr;</a>`),
      'the next link to a note is not its first words',
    );
  });
});

describe('a note in a listing', () => {
  const ITEM = /<article class="feed-item h-entry">[\s\S]*?<\/article>/g;

  it('is drawn by its content, with a dated permalink instead of a title', async () => {
    const item = blockFor(await get('/'), ITEM, NOTE);

    assert.doesNotMatch(item, /p-name/, 'a note in a listing prints a p-name');
    assert.doesNotMatch(item, /Continue reading/, 'a note in a listing is cut short');
    assert.match(
      item,
      /<div class="feed-excerpt e-content">\s*<p>Coffee first\. Then <strong>the<\/strong> inbox/,
      'the note’s content is not in the listing',
    );
    assert.match(
      item,
      new RegExp(`<a href="${NOTE}" class="u-url"><time class="feed-date dt-published"`),
      'the note’s date is not its permalink',
    );
  });

  it('keeps an article’s linked title', async () => {
    const item = blockFor(await get('/'), ITEM, '/2026/09/on-gardens/');
    assert.match(item, /class="u-url">On gardens<\/a>/);
  });

  it('is found by search under its first words', async () => {
    const result = blockFor(
      await get('/search/?q=coffee'),
      /<article class="search-result h-entry">[\s\S]*?<\/article>/g,
      NOTE,
    );

    assert.doesNotMatch(result, /p-name/, 'a note in the results prints a p-name');
    assert.match(result, new RegExp(`<a href="${NOTE}" class="u-url">${NOTE_LABEL}</a>`));
  });

  it('is listed in the archive under its first words', async () => {
    assert.match(
      await get('/archive/'),
      new RegExp(`<a href="${NOTE}"><span>${NOTE_LABEL}</span></a>`),
    );
  });
});

describe('a note in the feeds', () => {
  it('is an RSS item with a description and no title', async () => {
    const item = blockFor(await get('/feed/'), /<item>[\s\S]*?<\/item>/g, NOTE);

    assert.doesNotMatch(item, /<title>/, 'an RSS note carries a title');
    assert.match(
      item,
      /<description>Coffee first\. Then the inbox/,
      'an RSS note has no description',
    );
  });

  it('is an Atom entry with the empty title Atom requires', async () => {
    const entry = blockFor(await get('/feed/atom/'), /<entry>[\s\S]*?<\/entry>/g, NOTE);

    assert.match(entry, /<title><\/title>/, 'an Atom note does not carry an empty title');
    assert.match(entry, /<summary type="text">Coffee first\. Then the inbox/);
  });

  it('is a JSON Feed item with no title', async () => {
    const feed = JSON.parse(await get('/feed/json/')) as {
      items: { url: string; title?: string; content_html: string }[];
    };
    const note = feed.items.find((item) => item.url.endsWith(NOTE));
    const article = feed.items.find((item) => item.url.endsWith('/2026/09/on-gardens/'));

    assert.ok(note !== undefined && article !== undefined);
    assert.equal('title' in note, false, 'a JSON Feed note carries a title');
    assert.match(note.content_html, /Coffee first/);
    assert.equal(article.title, 'On gardens');
  });

  it('names its comments feed by its first words', async () => {
    assert.match(
      await get(`${NOTE}feed/`),
      new RegExp(`<title>Comments on: ${NOTE_LABEL}</title>`),
    );
  });

  it('keeps the title of an article in RSS and Atom', async () => {
    assert.match(
      blockFor(await get('/feed/'), /<item>[\s\S]*?<\/item>/g, '/2026/09/on-gardens/'),
      /<title>On gardens<\/title>/,
    );
    assert.match(
      blockFor(await get('/feed/atom/'), /<entry>[\s\S]*?<\/entry>/g, '/2026/09/on-gardens/'),
      /<title>On gardens<\/title>/,
    );
  });
});
