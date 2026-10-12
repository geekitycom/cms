import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Document } from './document.ts';
import { hiddenReason, isGone, isListed, isServed } from './served.ts';

const NOW = new Date('2026-09-02T10:00:00.000Z');

function post(overrides: Partial<Document> = {}): Document {
  return {
    type: 'post',
    path: 'posts/2026-09-01-hello.md',
    slug: 'hello',
    permalink: '/2026/09/hello/',
    title: 'Hello',
    date: '2026-09-01T10:00:00.000Z',
    tags: [],
    categories: [],
    draft: false,
    extra: {},
    body: '',
    html: '',
    hash: '',
    ...overrides,
  };
}

describe('why a document is not served', () => {
  it('is nothing for a published, public post, which is served and listed', () => {
    assert.equal(hiddenReason(post(), NOW), undefined);
    assert.equal(isServed(post(), NOW), true);
    assert.equal(isListed(post(), NOW), true);
  });

  it('names the trash before anything else', () => {
    const trashed = post({ path: '_trash/posts/2026-09-01-hello.md', draft: true });
    assert.deepEqual(hiddenReason(trashed, NOW), { kind: 'trashed' });
  });

  it('names a draft, a date still to come and a visibility the site does not know', () => {
    assert.deepEqual(hiddenReason(post({ draft: true }), NOW), { kind: 'draft' });
    assert.equal(hiddenReason(post({ date: '2026-09-03T10:00:00.000Z' }), NOW)?.kind, 'scheduled');
    assert.deepEqual(hiddenReason(post({ extra: { visibility: 'secret' } }), NOW), {
      kind: 'unrecognized-visibility',
      visibility: 'secret',
    });
  });

  it('serves an unlisted document without listing it', () => {
    const unlisted = post({ extra: { visibility: 'unlisted' } });
    assert.equal(isServed(unlisted, NOW), true);
    assert.equal(isListed(unlisted, NOW), false);
  });
});

describe('isGone', () => {
  it('is a trashed document that would otherwise be served', () => {
    assert.equal(isGone(post({ path: '_trash/posts/2026-09-01-hello.md' }), NOW), true);
  });

  it('is not a trashed draft, which was never public, nor a live document', () => {
    assert.equal(
      isGone(post({ path: '_trash/posts/2026-09-01-hello.md', draft: true }), NOW),
      false,
    );
    assert.equal(isGone(post(), NOW), false);
  });
});
