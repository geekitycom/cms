import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Document } from './document.ts';
import { EXCERPT_WORDS, excerptFromHtml, feedExcerpt } from './excerpt.ts';

function post(overrides: Partial<Document> = {}): Document {
  return {
    type: 'post',
    path: 'posts/hello.md',
    slug: 'hello',
    permalink: '/hello/',
    title: 'Hello',
    tags: [],
    categories: [],
    draft: false,
    extra: {},
    body: '',
    html: '<p>First <em>words</em>, &amp; more.</p><p>Second.</p>',
    hash: '',
    ...overrides,
  };
}

describe('feedExcerpt', () => {
  it('is the description when the post has one', () => {
    assert.equal(feedExcerpt(post({ description: 'Said here.' })), 'Said here.');
  });

  it('is the first paragraph as text otherwise', () => {
    assert.equal(feedExcerpt(post()), 'First words, & more.');
  });
});

describe('excerptFromHtml', () => {
  it('cuts a long paragraph at the excerpt length', () => {
    const words = Array.from({ length: EXCERPT_WORDS + 5 }, (_, index) => `w${String(index)}`);
    const excerpt = excerptFromHtml(`<p>${words.join(' ')}</p>`);
    assert.equal(excerpt, `${words.slice(0, EXCERPT_WORDS).join(' ')} …`);
  });

  it('is empty for HTML with no text', () => {
    assert.equal(excerptFromHtml('<p><img src="/a.png"></p>'), '');
  });
});
