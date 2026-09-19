/**
 * The listings of the default theme: the feed, its headers, its pager and the
 * page that says there is nothing here (decision-16, TASK-82).
 *
 * The source design lists entries as a microformats2 `h-feed` of `h-entry`
 * items separated by rules — a linked `p-name`, a `p-summary` excerpt of about
 * 280 characters, Continue reading, `dt-published` and `p-category` links — and
 * pages through them with two arrows. None of that is a function's return
 * value, so all of it is asserted over HTTP against the packaged theme.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { createTemplateEnvironment } from './templates.ts';

const box = sandbox();
after(() => box.cleanup());

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/** A post file, with whatever front matter the test cares about. */
function post(
  title: string,
  options: {
    date: string;
    permalink: string;
    description?: string;
    tags?: string[];
    categories?: string[];
    body?: string;
  },
): string {
  const list = (key: string, values: string[] | undefined): string =>
    values === undefined ? '' : `${key}:\n${values.map((value) => `  - ${value}`).join('\n')}\n`;
  return [
    '---\n',
    `title: ${title}\n`,
    `date: '${options.date}'\n`,
    `permalink: ${options.permalink}\n`,
    options.description === undefined ? '' : `description: ${options.description}\n`,
    list('tags', options.tags),
    list('categories', options.categories),
    '---\n\n',
    `${options.body ?? 'Body.'}\n`,
  ].join('');
}

/** A body long enough that an excerpt of it has to be cut. */
const LONG_BODY = `${'Sentences about rendering go here and they keep going. '.repeat(12)}End.`;

/** Two posts, one with a description and categories, one with neither. */
const POSTS: Record<string, string> = {
  'posts/hello.md': post('Hello', {
    date: '2026-09-02T09:00:00Z',
    permalink: '/2026/09/hello/',
    description: 'A short line the author wrote.',
    categories: ['notes', 'meta'],
    tags: ['introductions'],
  }),
  'posts/long.md': post('At length', {
    date: '2026-08-15T09:00:00Z',
    permalink: '/2026/08/at-length/',
    body: LONG_BODY,
  }),
};

/**
 * A CMS wearing the packaged theme, over these files and these settings.
 *
 * `seed` runs against the data directory before the CMS boots, which is when
 * an account has to exist: a user created under a running site has no actor
 * keys yet and the federation layer says so.
 */
async function site(
  files: Record<string, string> = POSTS,
  settings: Record<string, unknown> = {},
  config: GeekityConfig = {},
  seed?: (dataDir: string) => Promise<void>,
): Promise<Cms> {
  const contentDir = await box.dir('geekity-listing-content-');
  const dataDir = await box.dir('geekity-listing-data-');

  await writeTree(contentDir, {
    ...files,
    '_data/site.json': JSON.stringify({ title: 'A Site', ...settings }, null, 2),
  });
  await seed?.(dataDir);

  return box.open({ contentDir, dataDir, ...config });
}

/** GET a path and read the body. */
async function body(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** The `<main>…</main>` of a page: what the layout drew, without the shell. */
function main(html: string): string {
  return /<main id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
}

/** Every `<article class="feed-item h-entry">…</article>` of a page. */
function items(html: string): string[] {
  return [...html.matchAll(/<article class="feed-item h-entry">([\s\S]*?)<\/article>/g)].map(
    (match) => match[1] ?? '',
  );
}

/** The text of part of a feed item, tags stripped and whitespace collapsed. */
function text(markup: string, part: RegExp): string {
  return (part.exec(markup)?.[1] ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What one entry prints as its excerpt. */
const EXCERPT = /<div class="feed-excerpt p-summary">([\s\S]*?)<\/div>/;

describe('a listing’s feed (AC #1)', () => {
  it('is an h-feed of h-entry items separated by rules', async () => {
    const html = await body(await site(), '/');

    assert.match(html, /<div class="feed h-feed">/, 'the listing is not an h-feed');

    assert.equal(items(html).length, 2, 'both posts are not in the feed');
    assert.equal(
      (html.match(/<hr class="feed-separator">/g) ?? []).length,
      1,
      'two entries take exactly one separator between them',
    );
    assert.ok(
      html.indexOf('<hr class="feed-separator">') > html.indexOf('/2026/09/hello/'),
      'the separator comes before the first entry rather than between the two',
    );
  });

  it('gives each entry a linked p-name, an excerpt, Continue reading and its meta', async () => {
    const [hello] = items(await body(await site(), '/'));
    assert.ok(hello !== undefined, 'the newest post is not in the feed');

    assert.match(
      hello,
      /<h2 class="feed-title p-name">\s*<a href="\/2026\/09\/hello\/" class="u-url">Hello<\/a>\s*<\/h2>/,
      'the title is not a linked p-name',
    );
    assert.match(
      hello,
      /<div class="feed-excerpt p-summary">\s*<p>A short line the author wrote\.<\/p>/,
      'the summary is not printed as the p-summary',
    );
    assert.match(
      hello,
      /<p class="feed-more">\s*<a href="\/2026\/09\/hello\/" aria-label="Continue reading: Hello">Continue reading<span aria-hidden="true"> &rarr;<\/span><\/a>/,
      'there is no Continue reading link naming the entry',
    );
    assert.match(
      hello,
      /<div class="feed-meta">[\s\S]*<time class="feed-date dt-published" datetime="2026-09-02T09:00:00\.000Z">\s*2 September 2026\s*<\/time>/,
      'the date is not a dt-published inside the meta',
    );
  });

  it('links the categories as p-category and prints no tags', async () => {
    const [hello] = items(await body(await site(), '/'));
    assert.ok(hello !== undefined);

    assert.match(
      hello,
      /<p class="post-categories">\s*<a href="\/category\/notes\/" class="p-category" rel="category">notes<\/a>/,
      'the first category is not a p-category link',
    );
    assert.match(hello, /rel="category">meta<\/a>/, 'the second category is missing');
    assert.doesNotMatch(hello, /\/tag\/introductions\//, 'a feed item prints its tags');
  });

  it('takes the heading level from the layout that includes the list', async () => {
    const themesDir = await box.dir('geekity-listing-themes-');
    await writeTree(path.join(themesDir, 'fixture'), {
      'theme.json': JSON.stringify({ name: 'Fixture', kind: 'site' }),
      'layouts/home.njk': [
        '{% extends "layouts/base.njk" %}',
        '{% block content %}',
        '{% set feedHeading = 3 %}',
        '{% include "partials/post-list.njk" %}',
        '{% endblock %}',
      ].join('\n'),
    });
    const cms = await site(POSTS, { theme: 'fixture' }, { themesDir });

    const [hello] = items(await body(cms, '/'));
    assert.ok(hello !== undefined);
    assert.match(hello, /<h3 class="feed-title p-name">/, 'the layout’s heading level is ignored');
    assert.doesNotMatch(hello, /<h2 class="feed-title/, 'and the default is printed too');
  });
});

describe('the excerpt an entry carries (AC #2)', () => {
  it('cuts a long summary at a word boundary near 280 characters', async () => {
    const [, long] = items(await body(await site(), '/'));
    assert.ok(long !== undefined, 'the long post is not in the feed');

    const excerpt = text(long, EXCERPT);
    assert.ok(excerpt.endsWith('...'), `the excerpt does not end in an ellipsis: ${excerpt}`);
    assert.ok(excerpt.length > 240, `the excerpt is far shorter than the cut: ${excerpt}`);
    assert.ok(excerpt.length <= 284, `the excerpt is longer than the cut: ${excerpt}`);

    const kept = excerpt.slice(0, -3);
    assert.ok(LONG_BODY.startsWith(kept), 'the excerpt is not the opening of the post');
    assert.equal(LONG_BODY.charAt(kept.length), ' ', 'the excerpt is cut inside a word');
    assert.doesNotMatch(long, /&lt;|&gt;/, 'the excerpt carries escaped markup');
  });

  it('prints a description shorter than the cut whole', async () => {
    const [hello] = items(await body(await site(), '/'));
    assert.ok(hello !== undefined);

    assert.equal(
      text(hello, EXCERPT),
      'A short line the author wrote.',
      'a short description is not printed whole',
    );
  });
});

describe('what heads a listing (AC #3)', () => {
  it('heads the home page and every archive, and counts nothing', async () => {
    const cms = await site();

    for (const [pathname, heading] of [
      ['/', 'A Site'],
      ['/tag/introductions/', 'Tagged'],
      ['/category/notes/', 'Filed under'],
    ] as const) {
      const inside = main(await body(cms, pathname));
      assert.match(inside, new RegExp(`<h1[^>]*>[^<]*${heading}`), `${pathname} has no heading`);
      assert.doesNotMatch(inside, /\d+ entr(y|ies)/, `${pathname} still counts its entries`);
    }
  });

  it('heads a category archive with a header, and no description when it has none', async () => {
    const inside = main(await body(await site(), '/category/notes/'));

    assert.match(
      inside,
      /<header class="category-header">\s*<h1[^>]*>[\s\S]*?notes/,
      'the category name does not head the archive',
    );
    assert.doesNotMatch(
      inside,
      /class="category-description"/,
      'a category with no description prints an empty one',
    );
  });

  it('prints a category description under the name when the context carries one', () => {
    // Nothing in the CMS writes one yet — there is no store of term
    // descriptions — so the branch is reached by rendering the packaged layout
    // over a context that has one, which is what a site supplying descriptions
    // of its own would hand it.
    const environment = createTemplateEnvironment({ baseUrl: 'http://localhost:3000/' });
    const html = environment.render('layouts/category.njk', {
      site: { title: 'A Site' },
      category: 'notes',
      categoryDescription: 'Short things, written down.',
      pagination: { pageNumber: 0, totalPages: 1, total: 0 },
      posts: [],
      page: { url: '/category/notes/' },
    });

    assert.match(
      html,
      /<h1[^>]*>[\s\S]*?notes[\s\S]*?<div class="category-description">Short things, written down\.<\/div>/,
      'the description is not printed under the name',
    );
  });

  it('keeps the h-card on an author archive', async () => {
    const cms = await site(POSTS, {}, {}, async (dataDir) => {
      const user = await createUser({ dataDir, username: 'ada', password: 'a password of hers' });
      await setUserProfile({
        dataDir,
        userId: user.id,
        profile: {
          displayName: 'Ada Lovelace',
          bio: 'Wrote the first program.',
          avatar: '/uploads/ada.jpg',
          links: [{ label: 'Site', href: 'https://ada.example' }],
        },
      });
    });

    const inside = main(await body(cms, '/author/ada/'));

    assert.match(inside, /class="[^"]*h-card"/, 'the header is not an h-card');
    assert.match(inside, /class="[^"]*u-photo"[^>]*src="\/uploads\/ada\.jpg"/, 'no u-photo');
    assert.match(
      inside,
      /<a class="u-url p-name" rel="author me" href="\/author\/ada\/">Ada Lovelace<\/a>/,
      'no p-name',
    );
    assert.match(inside, /class="[^"]*p-note">Wrote the first program\.</, 'no p-note');
    assert.match(
      inside,
      /<a class="u-url" rel="me" href="https:\/\/ada\.example">Site<\/a>/,
      'the profile links are not rel="me" u-url',
    );
    assert.doesNotMatch(inside, /\d+ entr(y|ies)/, 'the archive still counts its entries');
  });
});

describe('paging and the page that is not there (AC #4)', () => {
  it('pages with two arrows, and prints no pager on a listing of one page', async () => {
    const cms = await site(POSTS, { postsPerPage: 1 });

    const first = await body(cms, '/');
    assert.match(first, /<nav class="pagination" aria-label="Pagination">/, 'no pager on page one');
    assert.match(
      first,
      /<a class="pagination-next" rel="next" href="\/page\/2\/">Next <span aria-hidden="true">&rarr;<\/span><\/a>/,
      'there is no next arrow',
    );
    assert.doesNotMatch(first, /pagination-previous/, 'page one links to a page before it');

    const second = await body(cms, '/page/2/');
    assert.match(
      second,
      /<a class="pagination-previous" rel="prev" href="\/"><span aria-hidden="true">&larr;<\/span> Previous<\/a>/,
      'there is no previous arrow',
    );
    assert.doesNotMatch(second, /pagination-next/, 'the last page links to a page after it');

    assert.doesNotMatch(await body(await site(), '/'), /pagination/, 'one page carries a pager');
  });

  it('says no posts were found rather than showing an empty feed', async () => {
    const inside = main(await body(await site({}), '/'));

    assert.match(inside, /No posts found/, 'an empty listing says nothing');
    assert.doesNotMatch(inside, /feed-item/, 'an empty listing prints an entry');
  });

  it('says content is not found, with a link home and to the search', async () => {
    const cms = await site();
    const response = await cms.app.request('/nothing-here/');
    const inside = main(await response.text());

    assert.equal(response.status, 404);
    assert.match(inside, /<h1[^>]*>Content not found\.<\/h1>/, 'the 404 does not say so');
    assert.match(inside, /<a href="\/">home<\/a>/, 'the 404 does not link home');
    assert.match(
      inside,
      /<a href="\/search\/">search the site<\/a>/,
      'the 404 does not link the search',
    );
  });
});
