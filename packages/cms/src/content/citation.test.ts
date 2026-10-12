import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shownInFull } from './citation.ts';

describe('shownInFull', () => {
  it('is a photo a repost cites, which the post shows as its own picture', () => {
    assert.equal(shownInFull('repost-of', { kind: 'photo' }), true);
  });

  it('is not a thumbnail, nor a picture a like or a bookmark cites', () => {
    assert.equal(shownInFull('repost-of', { kind: 'thumbnail' }), false);
    assert.equal(shownInFull('like-of', { kind: 'photo' }), false);
    assert.equal(shownInFull('bookmark-of', { kind: 'photo' }), false);
  });
});
