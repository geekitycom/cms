/**
 * An entry: a post or a page in the andrewshell.org design (decision-16,
 * TASK-83).
 *
 * The source theme's `content-essay.php` is `article.blog-post.h-entry` with
 * `h1.p-name`, the body in `section.e-content` ending in a paragraph that
 * links the permalink around a `dt-published` time and adds a `dt-updated` one
 * when the two dates are different days, then a rule and a footer holding the
 * bio: a `p-author h-card` with a small round photo, "Written by" linked
 * `rel="author me"`, what they do and where they are, and the site's links as
 * a horizontal list. The neighbouring posts follow in a `blog-post-nav`.
 *
 * All of it is asserted over HTTP against the packaged theme, because the
 * markup is what a reader and a microformats parser get; none of it is a
 * function's return value.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import { PACKAGED_THEME_DIR } from './themes.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

/** What the site's clock says while these tests run. */
const NOW = '2026-09-13T12:00:00Z';

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/**
 * Three posts, a page and a page on the menu.
 *
 * `hello` is the middle one, so it has a post either side of it; it is tagged
 * `indienews` and filed under a category, and it was updated three days after
 * it was published. `same-day` was updated within the day it went out, which
 * is the one case the Updated line is not printed.
 */
const CONTENT: Record<string, string> = {
  'posts/older.md':
    "---\ntitle: The older one\ndate: '2026-09-01T09:00:00Z'\npermalink: /2026/09/older/\n---\n\nBefore.\n",
  'posts/hello.md': [
    '---',
    'title: Hello',
    "date: '2026-09-02T09:00:00Z'",
    "updated: '2026-09-05T09:00:00Z'",
    'permalink: /2026/09/hello/',
    'author: Ada Lovelace',
    'categories:',
    '  - notes',
    'tags:',
    '  - indienews',
    '  - microformats',
    '---',
    '',
    'Body **text**.',
    '',
  ].join('\n'),
  'posts/newer.md':
    "---\ntitle: The newer one\ndate: '2026-09-03T09:00:00Z'\npermalink: /2026/09/newer/\nauthor: Ada Lovelace\ntags:\n  - microformats\n---\n\nAfter.\n",
  'posts/same-day.md':
    "---\ntitle: Same day\ndate: '2026-09-04T09:00:00Z'\nupdated: '2026-09-04T18:00:00Z'\npermalink: /2026/09/same-day/\nauthor: Ada Lovelace\n---\n\nFixed a typo.\n",
  'posts/nobody.md':
    "---\ntitle: By nobody\ndate: '2026-09-06T09:00:00Z'\npermalink: /2026/09/nobody/\n---\n\nAnonymous.\n",
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout us.\n',
};

/** The site menu these tests read, in `site.json` order. */
const NAVIGATION = [
  { label: 'Home', url: '/' },
  { label: 'About', url: '/about/' },
];

/**
 * A CMS wearing the packaged theme.
 *
 * `author` in `site.json` is Ada by default, so `siteAuthor` resolves and a
 * page has a bio; a test about a site whose author is nobody passes a name no
 * user answers to and adds no user.
 */
async function site(
  settings: Record<string, unknown> = {},
  profile: Record<string, unknown> | null = {
    displayName: 'Ada Lovelace',
    bio: 'Wrote the first program.',
    avatar: '/uploads/ada.jpg',
    jobTitle: 'Analyst',
    location: 'London',
    links: [{ label: 'Site', href: 'https://ada.example' }],
  },
): Promise<Cms> {
  const contentDir = await box.dir('geekity-entry-content-');
  const dataDir = await box.dir('geekity-entry-data-');

  await writeTree(contentDir, {
    ...CONTENT,
    '_data/site.json': JSON.stringify(
      { title: 'A Site', author: 'Ada Lovelace', navigation: NAVIGATION, ...settings },
      null,
      2,
    ),
  });

  const cms = await box.open({ contentDir, dataDir, now: () => new Date(NOW) });

  if (profile !== null) {
    const user = await createUser({ dataDir, username: 'ada', password: 'a password of hers' });
    await setUserProfile({ dataDir, userId: user.id, profile });
  }

  return cms;
}

/** GET a path and read the body. */
async function body(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** The `<article>…</article>` of a page: the entry itself. */
function entry(html: string): string {
  return /<article class="blog-post h-entry">([\s\S]*?)<\/article>/.exec(html)?.[1] ?? '';
}

/** The `section.e-content` of an entry. */
function eContent(html: string): string {
  return /<section class="e-content">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
}

/** The bio, wherever on the page it is. */
function bio(html: string): string {
  return /<div class="bio p-author h-card">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1] ?? '';
}

/** The page footer: the last one, since an entry prints a `<footer>` too. */
function pageFooter(html: string): string {
  const afterMain = html.slice(html.lastIndexOf('</main>'));
  return /<footer>([\s\S]*?)<\/footer>/.exec(afterMain)?.[1] ?? '';
}

describe('the entry (AC #1)', () => {
  it('is a blog-post h-entry with the title as its p-name', async () => {
    const html = await body(await site(), '/2026/09/hello/');

    assert.match(html, /<article class="blog-post h-entry">/, 'not the source design’s article');
    assert.match(entry(html), /<header>\s*<h1 class="p-name">Hello<\/h1>\s*<\/header>/);
  });

  it('puts the body and the Published line in one section.e-content', async () => {
    const inside = eContent(await body(await site(), '/2026/09/hello/'));

    assert.match(inside, /<p>Body <strong>text<\/strong>\.<\/p>/, 'the body is not in the section');
    assert.match(
      inside,
      /<a href="\/2026\/09\/hello\/" class="u-url"><time class="small dt-published" datetime="2026-09-02T09:00:00\.000Z">Published 2 September 2026<\/time><\/a>/,
      'the permalink does not wrap a dt-published Published time',
    );
  });

  it('prints an Updated line only when the day is a different one', async () => {
    const cms = await site();

    const updated = eContent(await body(cms, '/2026/09/hello/'));
    assert.match(
      updated,
      /<time class="small dt-updated" datetime="2026-09-05T09:00:00\.000Z">Updated 5 September 2026<\/time>/,
      'a post updated three days later says so',
    );

    const sameDay = eContent(await body(cms, '/2026/09/same-day/'));
    assert.doesNotMatch(sameDay, /dt-updated/, 'a typo fixed the same day is not an update');

    const never = eContent(await body(cms, '/2026/09/older/'));
    assert.doesNotMatch(never, /dt-updated/, 'a post never updated at all says nothing');
  });

  it('ends with a rule and a footer holding the bio', async () => {
    const inside = entry(await body(await site(), '/2026/09/hello/'));

    assert.match(
      inside,
      /<hr>\s*<footer>[\s\S]*<div class="bio p-author h-card">/,
      'the bio is not in a footer under a rule',
    );
  });

  it('leaves a page that carries no date with an empty meta line', async () => {
    // A colophon was not published on a Tuesday, so most pages have no date
    // and nothing to print. The paragraph is still there — one hook, wherever
    // it is — and the stylesheet hides it with `:empty`, which only works when
    // the layout leaves no whitespace in it.
    const html = await body(await site(), '/about/');

    assert.match(html, /<p class="page-meta"><\/p>/, 'the empty meta line is not empty');
    assert.match(
      await readFile(path.join(PACKAGED_THEME_DIR, 'static', 'style.css'), 'utf8'),
      /\.page-meta:empty/,
      'and the stylesheet does not hide it',
    );
  });

  it('renders a page the same way, with no taxonomy and no neighbours', async () => {
    const html = await body(await site(), '/about/');
    const inside = entry(html);

    assert.match(inside, /<h1 class="p-name">About<\/h1>/);
    assert.match(eContent(html), /<p>About us\.<\/p>/);
    assert.match(inside, /<div class="bio p-author h-card">/, 'a page has no bio');
    assert.doesNotMatch(html, /blog-post-nav/, 'a page has neighbouring posts');
    assert.doesNotMatch(html, /post-categories/, 'a page has taxonomy');
  });
});

describe('the bio (AC #2)', () => {
  it('is the author’s h-card, with their photo, what they do and where they are', async () => {
    const inside = bio(await body(await site(), '/2026/09/hello/'));

    assert.match(
      inside,
      /<div class="bio-avatar">\s*<img class="u-photo" src="\/uploads\/ada\.jpg" alt="Ada Lovelace" width="50" height="50">/,
      'no 50px u-photo in a bio-avatar',
    );
    assert.match(
      inside,
      /Written by\s*<a class="u-url p-name" rel="author me" href="\/author\/ada\/">Ada Lovelace<\/a>/,
      'the name is not a p-name u-url linked rel="author me"',
    );
    assert.match(inside, /<span class="p-job-title">Analyst<\/span>/, 'no p-job-title');
    assert.match(inside, /<span class="p-locality">London<\/span>/, 'no p-locality');
  });

  it('leaves out what the profile does not say', async () => {
    const cms = await site({}, { displayName: 'Ada Lovelace' });
    const inside = bio(await body(cms, '/2026/09/hello/'));

    assert.match(inside, /Written by/, 'a profile with only a name has no bio at all');
    assert.doesNotMatch(inside, /bio-avatar/, 'a picture nobody uploaded');
    assert.doesNotMatch(inside, /p-job-title/, 'a job title nobody wrote');
    assert.doesNotMatch(inside, /p-locality/, 'a location nobody wrote');
  });

  it('credits the site’s author on a post whose front matter names nobody', async () => {
    const inside = bio(await body(await site(), '/2026/09/nobody/'));

    assert.match(inside, /Ada Lovelace/, 'a post naming nobody on a site by somebody has no bio');
  });

  it('omits the bio, the rule and the footer when nobody is left to credit', async () => {
    const anonymous = await site({ author: 'Joe Blog' }, null);

    for (const pathname of ['/2026/09/nobody/', '/about/']) {
      const inside = entry(await body(anonymous, pathname));
      assert.doesNotMatch(inside, /class="bio /, `${pathname} has a bio for nobody`);
      assert.doesNotMatch(inside, /<hr>/, `${pathname} ends on a rule under nothing`);
      assert.doesNotMatch(inside, /<footer>/, `${pathname} ends on an empty footer`);
    }
  });

  it('names a person this site does not have without linking them', async () => {
    const cms = await site({ author: 'Joe Blog' }, null);
    const inside = bio(await body(cms, '/2026/09/hello/'));

    assert.match(inside, /Written by\s*<strong class="p-name">Ada Lovelace<\/strong>/, 'no name');
    assert.doesNotMatch(inside, /rel="author me"/, 'a name with no account here was linked');
    assert.doesNotMatch(inside, /u-url/, 'and it has an archive to link to');
  });
});

describe('the site menu (AC #2)', () => {
  it('lists the menu in the bio, and not in the footer, on an entry', async () => {
    const cms = await site();

    for (const pathname of ['/2026/09/hello/', '/about/']) {
      const html = await body(cms, pathname);
      assert.match(
        bio(html),
        /<nav class="site-nav" aria-label="Site">\s*<ul class="hlist">[\s\S]*?<a href="\/about\/"/,
        `${pathname} has no menu in its bio`,
      );
      assert.doesNotMatch(pageFooter(html), /site-nav/, `${pathname} prints the menu twice`);
    }
  });

  it('keeps the menu in the footer on a page that has no bio', async () => {
    const cms = await site();

    for (const pathname of ['/', '/tag/microformats/', '/category/notes/']) {
      const html = await body(cms, pathname);
      assert.match(pageFooter(html), /<nav class="site-nav"/, `${pathname} lost the menu`);
      assert.equal(
        [...html.matchAll(/class="site-nav"/g)].length,
        1,
        `${pathname} prints the menu more than once`,
      );
    }
  });
});

describe('the IndieNews link (AC #3)', () => {
  it('opens the Published line of a post tagged indienews and of no other', async () => {
    const cms = await site();

    assert.match(
      eContent(await body(cms, '/2026/09/hello/')),
      /<a class="u-category small" href="https:\/\/news\.indieweb\.org\/en">#indienews<\/a>\s*<a href="\/2026\/09\/hello\/" class="u-url">/,
      'the u-category does not open the Published paragraph',
    );
    assert.doesNotMatch(
      await body(cms, '/2026/09/newer/'),
      /news\.indieweb\.org/,
      'a post tagged something else links IndieNews',
    );
    assert.doesNotMatch(
      await body(cms, '/about/'),
      /news\.indieweb\.org/,
      'a page links IndieNews',
    );
  });
});

describe('the neighbouring posts (AC #4)', () => {
  it('links the post either side of this one, with arrows', async () => {
    const html = await body(await site(), '/2026/09/hello/');
    const nav = /<nav class="blog-post-nav">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';

    assert.match(
      nav,
      /<a rel="prev" href="\/2026\/09\/older\/">&larr; The older one<\/a>/,
      'no previous link',
    );
    assert.match(
      nav,
      /<a rel="next" href="\/2026\/09\/newer\/">The newer one &rarr;<\/a>/,
      'no next link',
    );
  });

  it('prints one end of the archive with one link and a lone post with none', async () => {
    const cms = await site();

    const oldest = await body(cms, '/2026/09/older/');
    assert.doesNotMatch(oldest, /rel="prev"/, 'the oldest post has something before it');
    assert.match(oldest, /rel="next"/, 'the oldest post has nothing after it');

    const newest = await body(cms, '/2026/09/nobody/');
    assert.doesNotMatch(newest, /rel="next"/, 'the newest post has something after it');
    assert.match(newest, /rel="prev"/, 'the newest post has nothing before it');
  });
});

describe('categories and tags under the entry (AC #5)', () => {
  it('prints both as post-categories of p-category links, categories first', async () => {
    const inside = entry(await body(await site(), '/2026/09/hello/'));
    const printed = [...inside.matchAll(/<p class="post-categories">([\s\S]*?)<\/p>/g)].map(
      (match) => match[1] ?? '',
    );

    assert.equal(printed.length, 2, 'not one paragraph of categories and one of tags');
    assert.match(
      printed[0] ?? '',
      /<a href="\/category\/notes\/" class="p-category" rel="category">notes<\/a>/,
      'the categories are not first',
    );
    assert.match(
      printed[1] ?? '',
      /<a href="\/tag\/indienews\/" class="p-category" rel="tag">indienews<\/a>/,
      'the tags are not p-category links',
    );
    assert.doesNotMatch(inside, /tag-list/, 'the old tag list is still printed');
  });
});
