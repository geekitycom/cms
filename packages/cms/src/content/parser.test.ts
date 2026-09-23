import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { parseDocument } from './parser.ts';

const FIXTURES = new URL('../../test/fixtures/content/', import.meta.url);

async function fixture(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, FIXTURES), 'utf8');
}

const HELLO_WORLD_HTML = `<p>Geekity is a file-first CMS.<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup> Content is Markdown on disk and the site is
one Node process.</p>
<h2 id="what-it-does">What it does</h2>
<ul>
<li>Serves one URL as HTML, Markdown or ActivityStreams JSON.</li>
<li>Writes files; the database is only an index.</li>
</ul>
<pre tabindex="0"><code class="language-js">const cms = createCms({ baseUrl: 'https://example.com' });
await cms.serve();
</code></pre>
<aside class="note">
<p>Files win. Everything else is derived.</p>
</aside>
<hr class="footnotes-sep">
<section class="footnotes">
<ol class="footnotes-list">
<li id="fn1" class="footnote-item"><p>A database of record is a lock-in you cannot diff. <a href="#fnref1" class="footnote-backref">↩︎</a></p>
</li>
</ol>
</section>
`;

describe('parseDocument', () => {
  it('reads the front matter of a fixture post', async () => {
    const path = 'posts/2026-09-02-hello-world.md';

    const document = parseDocument(await fixture(path), { path });

    assert.equal(document.title, 'Hello, World!');
    assert.equal(document.date, '2026-09-02T09:00:00-05:00');
    assert.equal(document.permalink, '/2026/09/hello-world/');
    assert.deepEqual(document.tags, ['introductions', 'eleventy']);
    assert.equal(document.draft, false);
    assert.equal(document.description, 'The first post on a file-first site.');
    assert.equal(document.author, 'andrew');
  });

  it('renders the body of a fixture post', async () => {
    const path = 'posts/2026-09-02-hello-world.md';

    const document = parseDocument(await fixture(path), { path });

    assert.equal(document.html, HELLO_WORLD_HTML);
  });

  it('keeps the Markdown body without its front matter', async () => {
    const path = 'posts/2026-09-02-hello-world.md';

    const document = parseDocument(await fixture(path), { path });

    assert.match(document.body, /^Geekity is a file-first CMS\.\[\^why\]/);
    assert.match(document.body, /A database of record is a lock-in you cannot diff\.$/);
    assert.doesNotMatch(document.body, /^---/);
  });

  it('takes the type and the slug from the path and the permalink', async () => {
    const path = 'posts/2026-09-02-hello-world.md';

    const document = parseDocument(await fixture(path), { path });

    assert.equal(document.type, 'post');
    assert.equal(document.path, path);
    assert.equal(document.slug, 'hello-world');
  });

  it('recognises a page by its directory', async () => {
    const path = 'pages/about.md';

    const document = parseDocument(await fixture(path), { path });

    assert.equal(document.type, 'page');
    assert.equal(document.slug, 'about');
    assert.equal(document.permalink, '/about/');
    assert.equal(document.date, undefined);
    assert.deepEqual(document.tags, []);
  });

  it('reads drafts, updates and the activitypub block', async () => {
    const path = 'posts/2026-08-15-notes-from-a-draft.md';

    const document = parseDocument(await fixture(path), { path });

    assert.equal(document.draft, true);
    assert.equal(document.updated, '2026-08-20T11:02:00-04:00');
    assert.deepEqual(document.activitypub, {
      id: 'https://fixtures.example/2026/08/notes-from-a-draft/',
      published: '2026-08-20T11:02:04Z',
    });
  });

  it('keeps front-matter keys it does not model', async () => {
    const path = 'posts/2026-08-15-notes-from-a-draft.md';

    const document = parseDocument(await fixture(path), { path });

    assert.deepEqual(document.extra, {
      eleventyExcludeFromCollections: true,
      series: 'notebook',
      review: { by: 'someone-else', due: '2026-09-01' },
    });
  });

  it('fills in the default permalink when the file has none', () => {
    const source = '---\ntitle: No Permalink Here\ndate: 2026-03-04T05:06:07Z\n---\n\nBody.\n';

    const document = parseDocument(source, { path: 'posts/2026-03-04-no-permalink-here.md' });

    assert.equal(document.permalink, '/2026/03/no-permalink-here/');
    assert.equal(document.slug, 'no-permalink-here');
  });

  it('normalises a YAML timestamp to an ISO string', () => {
    const source =
      '---\ntitle: Unquoted\ndate: 2026-03-04T05:06:07Z\npermalink: /a/\n---\n\nBody.\n';

    const document = parseDocument(source, { path: 'posts/unquoted.md' });

    assert.equal(document.date, '2026-03-04T05:06:07.000Z');
  });

  it('accepts a single tag written as a string, as Eleventy does', () => {
    const source = '---\ntitle: One Tag\npermalink: /one-tag/\ntags: notes\n---\n\nBody.\n';

    const document = parseDocument(source, { path: 'pages/one-tag.md' });

    assert.deepEqual(document.tags, ['notes']);
  });

  it('reads categories as a second taxonomy beside the tags', () => {
    const source =
      '---\ntitle: Filed\npermalink: /filed/\ntags:\n  - notes\ncategories:\n  - general\n  - meta\n---\n\nBody.\n';

    const document = parseDocument(source, { path: 'posts/filed.md' });

    assert.deepEqual(document.categories, ['general', 'meta']);
    assert.deepEqual(document.tags, ['notes']);
  });

  it('accepts a single category written as a string', () => {
    const source =
      '---\ntitle: One Category\npermalink: /one-category/\ncategories: general\n---\n\nBody.\n';

    const document = parseDocument(source, { path: 'posts/one-category.md' });

    assert.deepEqual(document.categories, ['general']);
  });

  it('gives a document with no categories key an empty list, not an extra key', () => {
    const source = '---\ntitle: Uncategorised\npermalink: /uncategorised/\n---\n\nBody.\n';

    const document = parseDocument(source, { path: 'posts/uncategorised.md' });

    assert.deepEqual(document.categories, []);
    assert.deepEqual(document.extra, {});
  });

  it('hashes a document with no categories exactly as it did before they existed', () => {
    const document = parseDocument('---\ntitle: A\npermalink: /a/\n---\n\nBody.\n', {
      path: 'pages/a.md',
    });

    // The literal is the hash the fixtures shipped with, so adding the key to
    // the model cannot silently invalidate every indexed row.
    assert.equal(
      document.hash,
      createHash('sha256')
        .update('---\ntitle: A\npermalink: /a/\n---\n\nBody.\n', 'utf8')
        .digest('hex'),
    );
  });

  it('normalises CRLF line endings', () => {
    const source =
      '---\r\ntitle: Windows\r\npermalink: /windows/\r\n---\r\n\r\nOne.\r\n\r\nTwo.\r\n';

    const document = parseDocument(source, { path: 'pages/windows.md' });

    assert.equal(document.body, 'One.\n\nTwo.');
    assert.equal(document.html, '<p>One.</p>\n<p>Two.</p>\n');
  });

  it('hashes the same document to the same value and a changed one to another', () => {
    const one = parseDocument('---\ntitle: A\npermalink: /a/\n---\n\nBody.\n', {
      path: 'pages/a.md',
    });
    const same = parseDocument('---\ntitle: A\npermalink: /a/\n---\n\nBody.\n', {
      path: 'pages/a.md',
    });
    const other = parseDocument('---\ntitle: A\npermalink: /a/\n---\n\nOther body.\n', {
      path: 'pages/a.md',
    });

    assert.match(one.hash, /^[0-9a-f]{64}$/);
    assert.equal(one.hash, same.hash);
    assert.notEqual(one.hash, other.hash);
  });

  it('ignores irrelevant whitespace when hashing', () => {
    const tidy = parseDocument('---\ntitle: A\npermalink: /a/\n---\n\nBody.\n', {
      path: 'pages/a.md',
    });
    const untidy = parseDocument('---\ntitle: A\npermalink: /a/\n---\n\n\nBody.\n\n\n', {
      path: 'pages/a.md',
    });

    assert.equal(tidy.hash, untidy.hash);
  });

  it('refuses a file with no front matter', () => {
    assert.throws(() => parseDocument('Just a body.\n', { path: 'pages/none.md' }), /front matter/);
  });

  it('refuses a page with no title', () => {
    assert.throws(
      () => parseDocument('---\npermalink: /a/\n---\n\nBody.\n', { path: 'pages/a.md' }),
      /title/,
    );
  });

  it('reads a post with no title as one whose title is empty', () => {
    const document = parseDocument('---\ndate: 2026-09-20T09:00:00Z\n---\n\nCoffee first.\n', {
      path: 'posts/2026-09-20-coffee.md',
    });

    assert.equal(document.title, '');
    assert.equal(document.slug, 'coffee');
    assert.equal(document.permalink, '/2026/09/coffee/');
  });

  it('reads an empty title on a post the same as a missing one', () => {
    const document = parseDocument(
      "---\ntitle: ''\ndate: 2026-09-20T09:00:00Z\npermalink: /2026/09/coffee/\n---\n\nCoffee first.\n",
      { path: 'posts/2026-09-20-coffee.md' },
    );

    assert.equal(document.title, '');
    assert.equal(document.slug, 'coffee');
  });

  it('refuses a path it cannot read a type from', () => {
    assert.throws(
      () => parseDocument('---\ntitle: A\npermalink: /a/\n---\n\nBody.\n', { path: 'stray.md' }),
      /type/,
    );
  });

  it('takes an explicit type over the path', () => {
    const document = parseDocument('---\ntitle: A\npermalink: /a/\n---\n\nBody.\n', {
      path: '_trash/a.md',
      type: 'page',
    });

    assert.equal(document.type, 'page');
  });
});
