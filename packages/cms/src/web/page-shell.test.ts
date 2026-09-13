/**
 * The shell of the default theme: the wrapper, the header and the footer
 * (decision-16, TASK-80).
 *
 * The source design puts the site title and the tagline on the front page as a
 * heading and a small link home on every other page, keeps the whole page in
 * one `.global-wrapper` that says when it is at the root, and ends with a
 * footer holding the copyright, the colophon, an RSS link and the site author's
 * `rel="me"` links. None of that is a function's return value, so all of it is
 * asserted over HTTP against the packaged theme.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms, GeekityConfig } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

/** What the site's clock says while these tests run. */
const NOW = '2026-09-13T12:00:00Z';

/**
 * The year the footer prints: the wall clock rather than the site's injected
 * `now`, because `{{ "now" | date("year") }}` is read when the page is rendered
 * and a site left running over New Year should say the new one.
 */
const YEAR = String(new Date().getUTCFullYear());

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/** One published post and one page, which is enough to visit every shell. */
const CONTENT: Record<string, string> = {
  'posts/hello.md':
    "---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/hello/\ntags:\n  - notes\n---\n\nBody.\n",
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout us.\n',
};

/** A CMS wearing the packaged theme, with whatever `site.json` says. */
async function site(
  settings: Record<string, unknown> = {},
  config: GeekityConfig = {},
): Promise<Cms> {
  const contentDir = await box.dir('geekity-shell-content-');
  const dataDir = await box.dir('geekity-shell-data-');

  await writeTree(contentDir, {
    ...CONTENT,
    '_data/site.json': JSON.stringify(
      { title: 'A Site', tagline: 'Words about words', ...settings },
      null,
      2,
    ),
  });

  return await box.open({ contentDir, dataDir, now: () => new Date(NOW), ...config });
}

/** Give the site a user with a profile, the way the users screen would. */
async function addUser(
  cms: Cms,
  username: string,
  profile: Record<string, unknown>,
): Promise<void> {
  const user = await createUser({
    dataDir: cms.config.dataDir,
    username,
    password: 'a password of theirs',
  });
  await setUserProfile({ dataDir: cms.config.dataDir, userId: user.id, profile });
}

/** GET a path and read the body. */
async function body(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** The `<header>…</header>` of a page. */
function header(html: string): string {
  return /<header class="global-header">([\s\S]*?)<\/header>/.exec(html)?.[1] ?? '';
}

/** The `<footer>…</footer>` of a page. */
function footer(html: string): string {
  return /<footer>([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? '';
}

describe('the page shell (AC #1)', () => {
  it('wraps every page in a global wrapper, marked only at the root', async () => {
    const cms = await site();

    assert.match(
      await body(cms, '/'),
      /<div class="global-wrapper" data-is-root-path="true">/,
      'the front page is not marked as the root path',
    );

    for (const pathname of ['/about/', '/2026/09/hello/', '/tag/notes/']) {
      const html = await body(cms, pathname);
      assert.match(html, /<div class="global-wrapper">/, `${pathname} has no wrapper`);
      assert.doesNotMatch(html, /data-is-root-path/, `${pathname} claims to be the root path`);
    }

    const missing = await cms.app.request('/nothing-here/');
    assert.equal(missing.status, 404);
    assert.doesNotMatch(await missing.text(), /data-is-root-path/, 'and the 404 does not either');
  });

  it('keeps the skip link ahead of the wrapper', async () => {
    const html = await body(await site(), '/');

    assert.match(html, /<a class="screen-reader-text" href="#main">Skip to content<\/a>/);
    assert.ok(
      html.indexOf('Skip to content') < html.indexOf('global-wrapper'),
      'the skip link is not the first thing in the body',
    );
    assert.match(html, /<main id="main">/, 'there is nothing for the skip link to reach');
  });

  it('heads the front page with the site title and the tagline', async () => {
    const front = header(await body(await site(), '/'));

    assert.match(front, /<h1 class="main-heading">\s*<a href="\/">A Site<\/a>\s*<\/h1>/);
    assert.match(front, /<p>Words about words<\/p>/);
    assert.doesNotMatch(front, /header-link-home/, 'the front page also has the small home link');
  });

  it('heads every other page with the small link home', async () => {
    const cms = await site();

    for (const pathname of ['/about/', '/2026/09/hello/', '/tag/notes/']) {
      const inside = header(await body(cms, pathname));
      assert.match(
        inside,
        /<a class="header-link-home" href="\/">A Site<\/a>/,
        `${pathname} has no link home`,
      );
      assert.doesNotMatch(inside, /main-heading/, `${pathname} repeats the front page heading`);
      assert.doesNotMatch(
        inside,
        /Words about words/,
        `${pathname} repeats the tagline under the heading`,
      );
    }
  });

  it('puts no navigation in the header', async () => {
    const cms = await site({
      navigation: [
        { label: 'Home', url: '/' },
        { label: 'About', url: '/about/' },
      ],
    });

    for (const pathname of ['/', '/about/', '/2026/09/hello/']) {
      const html = await body(cms, pathname);
      assert.doesNotMatch(header(html), /<nav/, `${pathname} still has a header menu`);
      assert.match(footer(html), /<nav class="site-nav"/, `${pathname} lost the menu altogether`);
    }
  });
});

describe('the footer (AC #2)', () => {
  it('prints the year, the site author, the colophon and an RSS link', async () => {
    const printed = footer(await body(await site({ author: 'Ada Lovelace' }), '/'));

    assert.match(printed, new RegExp(`&copy; ${YEAR}, Ada Lovelace`), 'no copyright line');
    assert.match(printed, /Published with[\s\S]*Geekity/, 'no colophon');
    assert.match(printed, /<a href="\/feed\/">RSS<\/a>/, 'no RSS link');
  });

  it('lists the site author’s links as rel="me" in an hlist', async () => {
    const cms = await site({ author: 'Ada Lovelace' });
    await addUser(cms, 'ada', {
      displayName: 'Ada Lovelace',
      links: [
        { label: 'Mastodon', href: 'https://example.social/@ada' },
        { label: 'GitHub', href: 'https://github.example/ada' },
      ],
    });

    const printed = footer(await body(cms, '/2026/09/hello/'));
    const list = /<ul class="hlist">([\s\S]*?)<\/ul>/.exec(printed)?.[1] ?? '';

    assert.match(list, /<a rel="me" href="https:\/\/example\.social\/@ada">Mastodon<\/a>/);
    assert.match(list, /<a rel="me" href="https:\/\/github\.example\/ada">GitHub<\/a>/);
    assert.equal([...list.matchAll(/rel="me"/g)].length, 2, 'one rel="me" link per profile link');
  });

  it('still has a footer when the site author is nobody this site has', async () => {
    // What the demo does: `site.json` names an author no user answers to, so
    // `siteAuthor` is absent and there are no identity links to print.
    const printed = footer(await body(await site({ author: 'Joe Blog' }), '/'));

    assert.match(
      printed,
      new RegExp(`&copy; ${YEAR}, Joe Blog`),
      'the name in the setting is still printed',
    );
    assert.doesNotMatch(printed, /rel="me"/, 'a name with no profile behind it has no links');
    assert.match(printed, /<a href="\/feed\/">RSS<\/a>/, 'and the RSS link is still there');
  });
});

describe('the head (AC #5)', () => {
  it('still carries the canonical, the feeds, the comments feed and webmention', async () => {
    const cms = await site({ url: 'https://example.com' });
    const html = await body(cms, '/2026/09/hello/');

    for (const marker of [
      '<link rel="canonical" href="https://example.com/2026/09/hello/">',
      'type="application/rss+xml"',
      'type="application/atom+xml"',
      'type="application/feed+json"',
      '/comments/feed/',
      'title="Comments on: Hello" href="/2026/09/hello/feed/"',
      'type="application/activity+json"',
      'rel="webmention"',
      '<link rel="stylesheet" href="/theme/style.css">',
    ]) {
      assert.ok(html.includes(marker), `the head lost ${marker}`);
    }
  });
});
