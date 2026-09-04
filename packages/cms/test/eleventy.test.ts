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
import { cp, readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import Eleventy from '@11ty/eleventy';

import {
  categoryHref,
  DEFAULT_TAXONOMY_BASES,
  isTrashedPath,
  parseDocument,
} from '../src/index.ts';
import type { Document } from '../src/index.ts';

/** Where a site's Eleventy build would be run from: the fixtures project root. */
const PROJECT_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CONTENT_DIR = path.join(PROJECT_DIR, 'content');
const CONFIG_PATH = fileURLToPath(new URL('../docs/eleventy.config.example.js', import.meta.url));

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

/** The file Eleventy should write for a permalink: `/a/b/` becomes `a/b/index.html`. */
function outputPathFor(permalink: string): string {
  return `${permalink.replace(/^\//, '')}index.html`;
}

describe('the fixtures content directory under Eleventy', () => {
  let buildDir: string;
  let written: string[];
  let documents: Document[];
  const originalCwd = process.cwd();

  before(async () => {
    documents = await fixtureDocuments();

    // The fixtures are copied somewhere writable and built there: Eleventy
    // resolves both the config's relative paths and its output directory
    // against the working directory, so the build has to happen where a site's
    // own build would, and that must not be the repository.
    buildDir = await mkdtemp(path.join(tmpdir(), 'geekity-11ty-'));
    await cp(PROJECT_DIR, buildDir, { recursive: true });

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

  it('builds without errors and writes pages', () => {
    assert.ok(written.length > 0, 'Eleventy wrote nothing');
    assert.ok(
      written.some((file) => file.endsWith('index.html')),
      `no page was written: ${written.join(', ')}`,
    );
  });

  it('writes every published document at the permalink the CMS computes', () => {
    const published = documents.filter(
      (document) => !document.draft && !isTrashedPath(document.path),
    );
    assert.ok(published.length >= 4, 'the fixtures do not exercise enough documents');

    for (const document of published) {
      assert.ok(
        written.includes(outputPathFor(document.permalink)),
        `${document.path} has permalink ${document.permalink}, so Eleventy should have written ` +
          `${outputPathFor(document.permalink)}; it wrote ${written.join(', ')}`,
      );
    }
  });

  it('writes nothing the CMS would not serve at that URL', () => {
    const expected = new Set([
      ...publishedDocuments().map((document) => outputPathFor(document.permalink)),
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

  /** Every category the CMS's own archive would exist for. */
  function publishedCategories(): string[] {
    return [...new Set(publishedDocuments().flatMap((document) => document.categories))];
  }

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

    // `content/_data/federation/followers.json` is a data file in a namespaced
    // subdirectory, so Eleventy hands it over as `federation.followers`
    // without being told anything.
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

    // Two answers now: the fediverse reply and the comment.
    assert.ok(html.includes('2 replies'), `both are counted: ${html}`);

    // Nothing a moderator has not approved, and no email anywhere near it.
    assert.ok(!html.includes('Still waiting for a moderator.'), 'a pending comment is not built');
    assert.ok(!html.includes('ada@example.com'), 'the email is never published');
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

  it('renders no conversation under a post nobody has answered', async () => {
    const html = await readFile(path.join(buildDir, '_site', 'notes/renamed/index.html'), 'utf8');

    assert.ok(!html.includes('class="conversation"'), 'there is no empty section');
  });

  it('renders the same site menu the CMS renders, from site.json and the flagged pages', async () => {
    const html = await readFile(path.join(buildDir, '_site', 'about/index.html'), 'utf8');
    const nav = /<nav class="site-nav">[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';

    const links = [...nav.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((match) => [
      match[2],
      match[1],
    ]);

    // The two items `content/_data/site.json` names, in its order, and then the
    // pages whose front matter opted in: About carries navigationOrder 1 and
    // Colophon carries none, so About comes first.
    assert.deepEqual(links, [
      ['Home', '/'],
      ['Elsewhere', 'https://elsewhere.example/'],
      ['About', '/about/'],
      ['Colophon', '/colophon/'],
    ]);
    assert.match(nav, /<a href="\/about\/" aria-current="page">About<\/a>/);
  });
});
