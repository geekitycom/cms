/**
 * The compatibility promise of decision-3, checked against the real thing.
 *
 * The fixtures content directory is built by Eleventy 3 with the example
 * config this package ships, and every URL Eleventy writes is compared with the
 * permalink the CMS computes for the same file. If the two ever disagree, a
 * site that leaves Geekity for a static build would find its URLs moved.
 *
 * The build is run from `test/fixtures/`, the way a site runs Eleventy from its
 * own root, so the relative paths in the example config mean here what they
 * would mean there.
 */
import assert from 'node:assert/strict';
import { cp, readdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { after, before, describe, it } from 'node:test';

import Eleventy from '@11ty/eleventy';

import { createUser, listUsers, setUserProfile } from '../src/admin/accounts.ts';
import {
  categoryHref,
  DEFAULT_TAXONOMY_BASES,
  frontPageSlugs,
  isTrashedPath,
  parseDocument,
  siteAuthorName,
} from '../src/index.ts';
import type { Document, FrontPageSlugs, SiteData } from '../src/index.ts';

/** Where a site's Eleventy build would be run from: the fixtures project root. */
const PROJECT_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CONTENT_DIR = path.join(PROJECT_DIR, 'content');
const CONFIG_PATH = fileURLToPath(new URL('../docs/eleventy.config.example.js', import.meta.url));
const THEME_DIR = fileURLToPath(new URL('../themes/default/', import.meta.url));

/**
 * Feeds are generated in code by the CMS rather than by a template, so they are
 * not part of the comparison in either direction.
 */
const FEED_PATTERN = /^feed\.[^/]+$/;

/** Every Markdown document in the fixtures, parsed the way the CMS reads it. */
async function fixtureDocuments(): Promise<Document[]> {
  const documents: Document[] = [];

  for (const relativePath of await markdownPaths(CONTENT_DIR, '')) {
    const source = await readFile(path.join(CONTENT_DIR, relativePath), 'utf8');
    // Trashed files keep the `posts/` or `pages/` directory they were trashed
    // from, so the path still says which type they are.
    documents.push(parseDocument(source, { path: relativePath }));
  }

  return documents;
}

/** Content-relative paths of every Markdown file under `posts/` or `pages/`. */
async function markdownPaths(directory: string, prefix: string): Promise<string[]> {
  const found: string[] = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '_data' || entry.name === '_includes' || entry.name === 'uploads')
        continue;
      found.push(...(await markdownPaths(path.join(directory, entry.name), relativePath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) found.push(relativePath);
  }

  return found.sort();
}

/** Output-relative paths of every file Eleventy wrote, with `/` separators. */
async function outputPaths(directory: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await outputPaths(path.join(directory, entry.name), relativePath)));
      continue;
    }
    if (entry.isFile()) found.push(relativePath);
  }

  return found.sort();
}

/**
 * The placeholder `<li>` for a hidden comment, through the end of the list of
 * replies it holds, or the empty string when the page has none for it.
 */
function placeholderAt(html: string, id: string): string {
  const start = html.indexOf(`<li class="comment comment-placeholder" id="comment-${id}">`);
  if (start < 0) return '';
  const end = html.indexOf('</ol>', start);
  return html.slice(start, end < 0 ? undefined : end);
}

/** The file Eleventy should write for a permalink: `/a/b/` becomes `a/b/index.html`. */
function outputPathFor(permalink: string): string {
  return `${permalink.replace(/^\//, '')}index.html`;
}

/**
 * The Reading choice the fixtures make: which page the site serves at `/`, and
 * which one carries the listing. Read out of the same `site.json` the build
 * reads, through the CMS's own reader, so the two cannot disagree.
 */
async function reading(): Promise<FrontPageSlugs> {
  const file = await readFile(path.join(CONTENT_DIR, '_data', 'site.json'), 'utf8');
  return frontPageSlugs(JSON.parse(file) as SiteData);
}

describe('the fixtures content directory under Eleventy', () => {
  let buildDir: string;
  let written: string[];
  let documents: Document[];
  let picks: FrontPageSlugs;
  const originalCwd = process.cwd();

  before(async () => {
    documents = await fixtureDocuments();
    picks = await reading();

    // The fixtures are copied somewhere writable and built there: Eleventy
    // resolves both the config's relative paths and its output directory
    // against the working directory, so the build has to happen where a site's
    // own build would, and that must not be the repository.
    buildDir = await mkdtemp(path.join(tmpdir(), 'geekity-11ty-'));
    await cp(PROJECT_DIR, buildDir, { recursive: true });

    // The user `author` in the fixtures' site.json names, in the data
    // directory a site keeps beside `content/`, written by the CMS itself.
    const dataDir = path.join(buildDir, 'data');
    const andrew = await createUser({
      dataDir,
      username: 'andrew',
      password: 'correct horse battery',
    });
    await setUserProfile({
      dataDir,
      userId: andrew.id,
      profile: { displayName: 'Andrew Fixture' },
    });

    // The example config honours BUILD_DRAFTS as a local preview escape hatch.
    // The compatibility check is about the published site, so it never applies.
    delete process.env['BUILD_DRAFTS'];

    process.chdir(buildDir);
    try {
      const eleventy = new Eleventy('content', '_site', {
        configPath: CONFIG_PATH,
        quietMode: true,
      });
      await eleventy.write();
    } finally {
      process.chdir(originalCwd);
    }

    written = await outputPaths(path.join(buildDir, '_site'));
  });

  after(async () => {
    process.chdir(originalCwd);
    if (buildDir !== undefined) await rm(buildDir, { recursive: true, force: true });
  });

  it('prints the site author by the name the CMS prints (TASK-192 AC #6)', async () => {
    const site = JSON.parse(
      await readFile(path.join(CONTENT_DIR, '_data', 'site.json'), 'utf8'),
    ) as SiteData;
    const name = siteAuthorName(listUsers(path.join(buildDir, 'data')), site);
    assert.equal(name, 'Andrew Fixture', 'the fixtures name a user by username');

    const front = await readFile(path.join(buildDir, '_site', 'index.html'), 'utf8');
    assert.match(front, new RegExp(`<footer class="site-footer">&copy; ${name}</footer>`));
  });

  it('builds without errors and writes pages', () => {
    assert.ok(written.length > 0, 'Eleventy wrote nothing');
    assert.ok(
      written.some((file) => file.endsWith('index.html')),
      `no page was written: ${written.join(', ')}`,
    );
  });

  it('writes every published document at the permalink the CMS computes', () => {
    const published = publishedDocuments();
    assert.ok(published.length >= 4, 'the fixtures do not exercise enough documents');

    for (const document of published) {
      assert.ok(
        written.includes(outputFor(document)),
        `${document.path} is served at ${servedAt(document)}, so Eleventy should have written ` +
          `${outputFor(document)}; it wrote ${written.join(', ')}`,
      );
    }
  });

  it('writes nothing the CMS would not serve at that URL', () => {
    const expected = new Set([
      ...publishedDocuments().map((document) => outputFor(document)),
      // The category archives the CMS serves at the same URLs; the test below
      // is what proves those URLs are the ones it serves.
      ...publishedCategories().map((category) =>
        outputPathFor(categoryHref(category, 0, DEFAULT_TAXONOMY_BASES)),
      ),
    ]);

    const unexplained = written.filter(
      (file) => !expected.has(file) && !FEED_PATTERN.test(file) && !file.startsWith('uploads/'),
    );

    assert.deepEqual(unexplained, []);
  });

  it('builds a category archive per category, at the URL the CMS serves it from', () => {
    const categories = publishedCategories();
    assert.ok(categories.length >= 2, 'the fixtures do not exercise enough categories');

    for (const category of categories) {
      assert.ok(
        written.includes(outputPathFor(categoryHref(category, 0, DEFAULT_TAXONOMY_BASES))),
        `the CMS serves ${category} at ${categoryHref(category, 0, DEFAULT_TAXONOMY_BASES)}, so Eleventy should have ` +
          `written ${outputPathFor(categoryHref(category, 0, DEFAULT_TAXONOMY_BASES))}; it wrote ${written.join(', ')}`,
      );
    }
  });

  it('lists a category’s posts on its archive and nothing else', async () => {
    const html = await readFile(
      path.join(
        buildDir,
        '_site',
        outputPathFor(categoryHref('general', 0, DEFAULT_TAXONOMY_BASES)),
      ),
      'utf8',
    );

    const filed = publishedDocuments().filter((document) =>
      document.categories.includes('general'),
    );
    assert.ok(filed.length >= 2, 'the fixtures do not exercise a shared category');

    for (const document of filed) {
      assert.ok(html.includes(document.title), `${document.title} is on the general archive`);
    }
    for (const document of publishedDocuments()) {
      if (document.categories.includes('general')) continue;
      assert.ok(
        !html.includes(document.title),
        `${document.title} is not filed under general and must not be listed`,
      );
    }
  });

  it('keeps drafts and the trash out of the category archives', () => {
    const hidden = documents.filter(
      (document) =>
        (document.draft || isTrashedPath(document.path)) && document.categories.length > 0,
    );

    for (const document of hidden) {
      for (const category of document.categories) {
        if (publishedCategories().includes(category)) continue;
        assert.ok(
          !written.includes(outputPathFor(categoryHref(category, 0, DEFAULT_TAXONOMY_BASES))),
          `${category} is only carried by hidden documents, so it should have no archive`,
        );
      }
    }
  });

  /** Every document the public site would serve. */
  function publishedDocuments(): Document[] {
    return documents.filter((document) => !document.draft && !isTrashedPath(document.path));
  }

  /**
   * The URL the CMS serves one document at: `/` for the page the Reading
   * setting makes the homepage, and its own permalink for everything else.
   */
  function servedAt(document: Document): string {
    return document.slug === picks.homepage ? '/' : document.permalink;
  }

  /** The file Eleventy should write for it. */
  function outputFor(document: Document): string {
    return outputPathFor(servedAt(document));
  }

  /** Every category the CMS's own archive would exist for. */
  function publishedCategories(): string[] {
    return [...new Set(publishedDocuments().flatMap((document) => document.categories))];
  }

  it('builds the front page and the posts page the Reading setting names (AC #6)', async () => {
    assert.notEqual(picks.homepage, '', 'the fixtures do not exercise the setting');
    assert.notEqual(picks.postsPage, '');

    const home = documents.find((document) => document.slug === picks.homepage);
    const journal = documents.find((document) => document.slug === picks.postsPage);
    assert.ok(home !== undefined && journal !== undefined);

    // The homepage is at `/`, which is where the CMS serves it, and not at the
    // URL the CMS redirects from.
    const index = await readFile(path.join(buildDir, '_site', 'index.html'), 'utf8');
    assert.match(index, /The page the site shows at its root\./);
    assert.ok(!written.includes(outputPathFor(home.permalink)), 'and nowhere else');

    // And the listing is on the posts page, under that page's own title and
    // words, in the order the CMS lists it: newest first.
    const listing = await readFile(
      path.join(buildDir, '_site', outputPathFor(journal.permalink)),
      'utf8',
    );
    assert.match(listing, /Everything I have written, newest first\./);

    const list = /<ul class="post-list">([\s\S]*?)<\/ul>/.exec(listing)?.[1] ?? '';
    const listed = [...list.matchAll(/<a href="([^"]*)">/g)].map((match) => match[1] ?? '');
    assert.deepEqual(listed, [
      '/2026/09/hello-world/',
      '/2026/07/cafe-au-lait/',
      '/notes/renamed/',
    ]);
  });

  it('leaves drafts out of the build', () => {
    const drafts = documents.filter((document) => document.draft);
    assert.ok(drafts.length > 0, 'the fixtures have no draft to exclude');

    for (const draft of drafts) {
      assert.ok(
        !written.includes(outputPathFor(draft.permalink)),
        `${draft.path} is a draft but Eleventy wrote ${outputPathFor(draft.permalink)}`,
      );
    }
  });

  it('leaves the trash out of the build', () => {
    const trashed = documents.filter((document) => isTrashedPath(document.path));
    assert.ok(trashed.length > 0, 'the fixtures have nothing in the trash');

    for (const document of trashed) {
      assert.ok(
        !written.includes(outputPathFor(document.permalink)),
        `${document.path} is in the trash but Eleventy wrote it`,
      );
    }
  });

  it('copies the uploads directory through untouched', async () => {
    const uploads = written.filter((file) => file.startsWith('uploads/'));
    assert.ok(uploads.length > 0, 'no upload was copied');

    // An upload that happens to be Markdown is a file to download. It is
    // copied like any other upload, and the previous test is what catches it
    // being rendered as a page as well.
    assert.ok(
      uploads.includes('uploads/2026/09/attached-notes.md'),
      `the Markdown upload was not copied: ${uploads.join(', ')}`,
    );

    for (const upload of uploads) {
      assert.equal(
        await readFile(path.join(buildDir, '_site', upload), 'utf8'),
        await readFile(path.join(CONTENT_DIR, upload), 'utf8'),
      );
    }
  });

  it('sees the followers and the inbox log under _data/federation as data', async () => {
    const html = await readFile(path.join(buildDir, '_site', 'about/index.html'), 'utf8');

    // `content/_data/federation/{username}/followers.json` is a data file in a
    // namespaced subdirectory, so Eleventy hands it over as
    // `federation.{username}.followers` without being told anything
    // (decision-14).
    const followers = [
      ...(/<ul class="followers">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '').matchAll(
        /<a href="([^"]*)">([^<]*)<\/a>/g,
      ),
    ].map((match) => [match[2], match[1]]);
    assert.deepEqual(followers, [
      ['Ada Lovelace', 'https://remote.example/@ada'],
      ['Grace Hopper', 'https://remote.example/@grace'],
    ]);

    // The inbox log is JSON Lines, which Eleventy has no reader for until the
    // example config registers one; each month file is then an entry of
    // `federation.inbox` holding that month's activities.
    const inbox = [
      ...(/<ul class="inbox">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '').matchAll(
        /<li>([^<]*)<\/li>/g,
      ),
    ].map((match) => (match[1] ?? '').trim());
    assert.deepEqual(inbox, [
      'Like from https://remote.example/users/ada in 2026-09',
      'Create from https://remote.example/users/grace in 2026-09',
    ]);
  });

  it('renders the conversation under a post from the same inbox log', async () => {
    const html = await readFile(
      path.join(buildDir, '_site', '2026/09/hello-world/index.html'),
      'utf8',
    );

    // The reply the log holds, under the post it answers, with the author
    // named the way the CMS names one nobody follows and the remote note
    // linked. This is TASK-49's fifth criterion: the data files carry the
    // whole conversation, so a static build shows what the CMS shows.
    // The note's markup, rebuilt from the sanitiser's allowlist: the script is
    // gone, and the link that pointed at one is unwrapped down to its words.
    assert.ok(html.includes('<p>Good post. link</p>'), `the reply is on the page: ${html}`);
    assert.ok(html.includes('@grace@remote.example'), `the author is named: ${html}`);
    assert.ok(html.includes('href="https://remote.example/@grace/1"'), 'the note is linked');
    assert.ok(html.includes('1 like'), 'the like is counted');

    // The content is somebody else's markup, and the build sanitises it for
    // the same reason the CMS does.
    assert.ok(!html.includes('alert(1)'), 'the script the note carried is gone');
    assert.ok(!html.includes('javascript:'), 'and so is the script URL');
  });

  it('threads a native comment from _data/comments into the same conversation', async () => {
    const html = await readFile(
      path.join(buildDir, '_site', '2026/09/hello-world/index.html'),
      'utf8',
    );

    // The approved comment from `content/_data/comments/hello-world.json` is
    // in the same list as the fediverse reply, marked with its own source, so
    // a static build shows what the CMS shows (TASK-50).
    assert.ok(
      html.includes('<p>Left on the page itself.</p>'),
      `the comment is on the page: ${html}`,
    );
    assert.ok(html.includes('class="comment comment-comment"'), 'it says where it came from');
    assert.ok(html.includes('Ada Lovelace'), 'the commenter is named');

    // The fediverse reply, the comment, and the two replies under hidden
    // comments below: a placeholder is not a reply and is not counted.
    assert.ok(html.includes('4 replies'), `the visible ones are counted: ${html}`);

    // Nothing a moderator has not approved, and no email anywhere near it.
    assert.ok(!html.includes('Still waiting for a moderator.'), 'a pending comment is not built');
    assert.ok(!html.includes('ada@example.com'), 'the email is never published');
  });

  it('keeps a reply under a hidden comment, under a placeholder for it (TASK-325)', async () => {
    const html = await readFile(
      path.join(buildDir, '_site', '2026/09/hello-world/index.html'),
      'utf8',
    );

    // The pending comment is still not printed, but the approved reply to it
    // is, under a placeholder that keeps the pending comment's anchor.
    const held = placeholderAt(html, '01994c7a-0000-7000-8000-0000000ffff0');
    assert.ok(held.includes('<p>Answering one still held.</p>'), `under the held one: ${html}`);
    assert.ok(!held.includes('Still waiting for a moderator.'), 'which says nothing itself');

    // A reply naming a comment the file no longer holds was answering one
    // since deleted, and its placeholder goes under the post.
    const deleted = placeholderAt(html, '01994c7a-0000-7000-8000-0000000dead0');
    assert.ok(deleted.includes('<p>Answering one since deleted.</p>'), `under it: ${html}`);

    // A hidden comment nobody visible answered leaves no trace.
    assert.ok(
      !html.includes('01994c7a-0000-7000-8000-000000005a40'),
      'the spam has no placeholder',
    );
    assert.ok(!html.includes('Buy something.'), 'and is not printed');
  });

  it('puts a webmention from _data/comments in the mentions of the same conversation', async () => {
    const html = await readFile(
      path.join(buildDir, '_site', '2026/09/hello-world/index.html'),
      'utf8',
    );

    // The webmention in `content/_data/comments/hello-world.json` is not a
    // reply and not a reaction, so it is its own group; it links to the page it
    // came from rather than to an anchor here, and it carries the face the
    // source page's h-card gave it (TASK-51).
    assert.ok(html.includes('1 mention'), `it is counted apart: ${html}`);
    assert.ok(
      html.includes('href="https://grace.example/2026/09/about-that/"'),
      'it links to the page that sent it',
    );
    assert.ok(html.includes('src="https://grace.example/me.jpg"'), 'with its author’s photo');
    assert.ok(html.includes('class="mention comment-webmention"'), 'and it says what it is');
  });

  it('writes a post’s date in its own language, and the others in the site’s', async () => {
    const french = await readFile(
      path.join(buildDir, '_site', '2026/07/cafe-au-lait/index.html'),
      'utf8',
    );
    const english = await readFile(
      path.join(buildDir, '_site', '2026/09/hello-world/index.html'),
      'utf8',
    );

    assert.ok(french.includes('Published 4 juillet 2026'), `the date is French: ${french}`);
    assert.ok(english.includes('Published 2 September 2026'), `the date is English: ${english}`);
  });

  it('renders no conversation under a post nobody has answered', async () => {
    const html = await readFile(path.join(buildDir, '_site', 'notes/renamed/index.html'), 'utf8');

    assert.ok(!html.includes('class="conversation"'), 'there is no empty section');
  });

  it('renders the same primary menu the CMS renders, from site.json alone', async () => {
    const html = await readFile(path.join(buildDir, '_site', 'about/index.html'), 'utf8');
    const nav = /<nav class="site-nav">[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';

    const links = [...nav.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((match) => [
      match[2],
      match[1],
    ]);

    // The items `menus.primary` in `content/_data/site.json` names, in the
    // order it names them. A menu has no other source (TASK-106): a page
    // cannot add itself.
    assert.deepEqual(links, [
      ['Home', '/'],
      ['Elsewhere', 'https://elsewhere.example/'],
      ['About', '/about/'],
      ['Colophon', '/colophon/'],
      ['Mastodon', 'https://elsewhere.example/@fixture'],
    ]);
    assert.match(nav, /<a href="\/about\/" aria-current="page">About<\/a>/);
    // And the flags an item carries reach a build too (TASK-107).
    assert.match(nav, /<a href="https:\/\/elsewhere\.example\/@fixture" rel="me">Mastodon<\/a>/);
  });
});

/**
 * andrewshell.org's own front page, as its site theme overrides the default
 * theme's (TASK-317): the homepage's words, the five newest posts through the
 * default theme's `partials/post-list.njk`, then its own links.
 */
const FRONT_PAGE_OVERRIDE = `{% extends "layouts/base.njk" %}

{% block content %}
<div class="page-body e-content">
  {{ content | safe }}
</div>

<h2 class="section-title">Recent Posts</h2>
{% set posts = newestPosts(5) %}
{% set feedHeading = 3 %}
{% include "partials/post-list.njk" %}

<p class="front-links">
  <a href="{{ "/essays/" | url }}">See all essays<span aria-hidden="true"> &rarr;</span></a> |
  <a href="{{ "/search/" | url }}">Search<span aria-hidden="true"> &rarr;</span></a>
</p>
{% endblock %}
`;

/**
 * The fixtures built the way a site leaving Geekity with the default theme
 * would build them: the theme's layouts and partials as the includes, the
 * directory data files naming them, and the homepage on the override of
 * `front-page.njk`, the layout the CMS picks for it.
 *
 * Eleventy caches a compiled layout by its path for the life of the process,
 * so each build names its override afresh; otherwise a second build in this
 * file would render the first one's.
 */
let builds = 0;
async function buildWithDefaultTheme(frontPage: string, dir: string): Promise<void> {
  builds += 1;
  const layout = `layouts/front-page-${builds}.njk`;
  await cp(PROJECT_DIR, dir, { recursive: true });
  // A build that fails leaves its copy of the uploads running after it, and
  // nothing here needs them.
  await rm(path.join(dir, 'content', 'uploads'), { recursive: true, force: true });

  const includes = path.join(dir, 'content', '_includes');
  await rm(includes, { recursive: true, force: true });
  for (const part of ['layouts', 'partials']) {
    await cp(path.join(THEME_DIR, part), path.join(includes, part), { recursive: true });
  }
  await writeFile(path.join(includes, layout), frontPage);
  await writeFile(
    path.join(dir, 'content', 'posts', 'posts.json'),
    JSON.stringify({ layout: 'layouts/post.njk', tags: ['post'] }),
  );
  await writeFile(
    path.join(dir, 'content', 'pages', 'pages.json'),
    JSON.stringify({ layout: 'layouts/page.njk' }),
  );
  const front = path.join(dir, 'content', 'pages', 'front.md');
  await writeFile(
    front,
    (await readFile(front, 'utf8')).replace(/^---\n/, `---\nlayout: ${layout}\n`),
  );

  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    await new Eleventy('content', '_site', { configPath: CONFIG_PATH, quietMode: true }).write();
  } finally {
    process.chdir(originalCwd);
  }
}

describe('the default theme under Eleventy', () => {
  const built: string[] = [];

  async function freshDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'geekity-11ty-theme-'));
    built.push(dir);
    return dir;
  }

  after(async () => {
    for (const dir of built) await rm(dir, { recursive: true, force: true });
  });

  it('builds a front page override that lists newestPosts(5) (TASK-331 AC #1)', async () => {
    const dir = await freshDir();
    await buildWithDefaultTheme(FRONT_PAGE_OVERRIDE, dir);

    const html = await readFile(path.join(dir, '_site', 'index.html'), 'utf8');
    assert.match(html, /The page the site shows at its root\./);

    // The newest published posts, newest first, through the default theme's
    // own list: the draft is not one of them.
    const titles = [
      ...html.matchAll(
        /<h3 class="feed-title p-name">\s*<a href="([^"]*)" class="u-url">([^<]*)<\/a>/g,
      ),
    ].map((match) => [match[2], match[1]]);
    assert.deepEqual(titles, [
      ['Hello, World!', '/2026/09/hello-world/'],
      ['Café au Lait', '/2026/07/cafe-au-lait/'],
      ['Renamed in the Admin', '/notes/renamed/'],
    ]);
    assert.ok(!html.includes('Notes from a Draft'), 'the draft is not listed');
    assert.match(html, /<p>The first post on a file-first site\.<\/p>/, 'with its summary');
  });

  it('lists only as many as the theme asks for', async () => {
    const dir = await freshDir();
    await buildWithDefaultTheme(
      FRONT_PAGE_OVERRIDE.replace('newestPosts(5)', 'newestPosts(2)'),
      dir,
    );

    const html = await readFile(path.join(dir, '_site', 'index.html'), 'utf8');
    assert.equal([...html.matchAll(/class="feed-title p-name"/g)].length, 2);
    assert.ok(!html.includes('Renamed in the Admin'), 'the third newest is left out');
  });

  it('refuses a count that is not a whole number of posts, as the CMS does', async () => {
    await assert.rejects(
      buildWithDefaultTheme(
        FRONT_PAGE_OVERRIDE.replace('newestPosts(5)', 'newestPosts(0)'),
        await freshDir(),
      ),
      // Eleventy wraps what the template threw in errors of its own.
      (error) =>
        /newestPosts\(count\) takes a whole number of posts, at least 1, not 0/.test(
          inspect(error, { depth: 10 }),
        ),
    );
  });
});
