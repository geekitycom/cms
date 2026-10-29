import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderMarkdown } from './markdown.ts';
import { wikiLinksIn } from './wiki-link-syntax.ts';

describe('wikiLinksIn', () => {
  it('finds each link with its range and the slug of its target', () => {
    const text = 'See [[Garden tools]] and [[Compost#Heat|the heap]].';
    assert.deepEqual(wikiLinksIn(text), [
      { from: 4, to: 20, slug: 'garden-tools' },
      { from: 25, to: 50, slug: 'compost' },
    ]);
  });

  it('leaves out a target that slugifies to nothing, as the server does', () => {
    assert.deepEqual(wikiLinksIn('[[]] [[ !! ]] [[#Only a heading]] [[|text]]'), []);
  });

  it('does not cross a line break', () => {
    assert.deepEqual(wikiLinksIn('[[Some\nPage]]'), []);
  });

  it('leaves an escaped bracket alone, but not an escaped backslash', () => {
    assert.deepEqual(wikiLinksIn('\\[[Page]]'), []);
    assert.deepEqual(wikiLinksIn('\\\\[[Page]]'), [{ from: 2, to: 10, slug: 'page' }]);
  });

  it('finds the inner link when brackets are doubled up', () => {
    assert.deepEqual(wikiLinksIn('[[[Page]]]'), [{ from: 1, to: 9, slug: 'page' }]);
  });

  it('gives the slug the server puts in the href', () => {
    const targets = [
      'Some Page',
      'Where it’s at: Café',
      'Straße & Smørrebrød',
      "  Tom's  Æsir  ",
      'ÐÞŁ',
      '2026 plans!',
    ];
    for (const target of targets) {
      const [link] = wikiLinksIn(`[[${target}]]`);
      const href = /href="\/wiki\/([^/]*)\/"/.exec(renderMarkdown(`[[${target}]]`))?.[1];
      assert.ok(link !== undefined && href !== undefined, target);
      assert.equal(link.slug, href, target);
    }
  });
});
