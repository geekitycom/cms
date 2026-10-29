import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isDocumentPath } from './content-tree.ts';
import { WIKI_KIND } from './document-kind.ts';
import { ignoredWikiKeys, parseDocument, typeForPath } from './parser.ts';
import { contentFilePath } from './save.ts';
import { defaultPermalink } from './slug.ts';
import { serializeDocument } from './writer.ts';

/**
 * Wiki pages: a third document type, filed under `wiki/`, whose URL is the
 * wiki base and the file name rather than anything in the front matter.
 */

describe('wiki documents', () => {
  it('describes a wiki page as undated, unfiled, unfederated and without a form', () => {
    assert.equal(WIKI_KIND.type, 'wiki');
    assert.equal(WIKI_KIND.singular, 'wiki page');
    assert.equal(WIKI_KIND.dated, false);
    assert.equal(WIKI_KIND.tagged, false);
    assert.equal(WIKI_KIND.categorised, false);
    assert.equal(WIKI_KIND.federated, false);
    assert.equal(WIKI_KIND.excludable, false);
    assert.equal(WIKI_KIND.contactable, false);
    assert.equal(WIKI_KIND.replies, false);
    assert.equal(WIKI_KIND.located, false);
  });

  it('types and walks files under wiki/, in the trash too', () => {
    assert.equal(typeForPath('wiki/some-page.md'), 'wiki');
    assert.equal(typeForPath('_trash/wiki/some-page.md'), 'wiki');
    assert.equal(isDocumentPath('wiki/some-page.md'), true);
  });

  it('takes its permalink from the default base and its file name', () => {
    const document = parseDocument('---\ntitle: Some Page\n---\n\nHello.\n', {
      path: 'wiki/some-page.md',
    });
    assert.equal(document.type, 'wiki');
    assert.equal(document.permalink, '/wiki/some-page/');
    assert.equal(document.slug, 'some-page');
  });

  it('takes its permalink from the base it is given', () => {
    const document = parseDocument('---\ntitle: Some Page\n---\n\nHello.\n', {
      path: 'wiki/some-page.md',
      wikiBase: 'notes',
    });
    assert.equal(document.permalink, '/notes/some-page/');
  });

  it('slugs the file name, not the title', () => {
    const document = parseDocument('---\ntitle: Something Else\n---\n', {
      path: 'wiki/Garden Tools.md',
    });
    assert.equal(document.permalink, '/wiki/garden-tools/');
    assert.equal(document.slug, 'garden-tools');
  });

  it('ignores a permalink in its front matter', () => {
    const document = parseDocument('---\ntitle: Moved\npermalink: /elsewhere/\n---\n', {
      path: 'wiki/moved.md',
    });
    assert.equal(document.permalink, '/wiki/moved/');
  });

  it('is never dated, tagged, filed or a reply, and names the keys it ignores', () => {
    const source = [
      '---',
      'title: Ignored',
      'date: 2026-09-02T10:00:00Z',
      'permalink: /elsewhere/',
      'tags: [one]',
      'categories: [two]',
      'in-reply-to: https://example.com/a/',
      'mood: kept',
      '---',
      '',
    ].join('\n');
    const document = parseDocument(source, { path: 'wiki/ignored.md' });
    assert.equal(document.date, undefined);
    assert.deepEqual(document.tags, []);
    assert.deepEqual(document.categories, []);
    assert.equal(document.inReplyTo, undefined);
    assert.deepEqual(document.extra, { mood: 'kept' });
    assert.deepEqual(ignoredWikiKeys(source), [
      'date',
      'permalink',
      'tags',
      'categories',
      'in-reply-to',
    ]);
    assert.deepEqual(ignoredWikiKeys('---\ntitle: Fine\n---\n'), []);
  });

  it('hashes the file without the permalink, so a base change keeps the hash', () => {
    const source = '---\ntitle: Same\n---\n\nBody.\n';
    const under = parseDocument(source, { path: 'wiki/same.md', wikiBase: 'wiki' });
    const moved = parseDocument(source, { path: 'wiki/same.md', wikiBase: 'notes' });
    assert.equal(under.hash, moved.hash);
    assert.notEqual(under.permalink, moved.permalink);
  });

  it('is written without a permalink', () => {
    const document = parseDocument('---\ntitle: Written\n---\n\nBody.\n', {
      path: 'wiki/written.md',
    });
    const text = serializeDocument(document, 'wiki');
    assert.doesNotMatch(text, /permalink/);
    assert.match(serializeDocument(document), /permalink: \/wiki\/written\//);
  });

  it('is filed as wiki/<slug>.md at /<base>/<slug>/', () => {
    assert.equal(contentFilePath({ type: 'wiki', slug: 'some-page' }), 'wiki/some-page.md');
    assert.equal(defaultPermalink({ type: 'wiki', slug: 'some-page' }), '/wiki/some-page/');
    assert.equal(
      defaultPermalink({ type: 'wiki', slug: 'some-page', wikiBase: 'notes' }),
      '/notes/some-page/',
    );
  });
});
