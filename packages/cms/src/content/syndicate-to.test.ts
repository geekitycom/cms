import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { syndicateToOf } from './syndicate-to.ts';

describe('syndicateToOf', () => {
  it('is the ids a post lists under syndicate-to, one or many', () => {
    assert.deepEqual(syndicateToOf({ 'syndicate-to': 'mastodon' }), ['mastodon']);
    assert.deepEqual(syndicateToOf({ 'syndicate-to': ['mastodon', '', 3, 'bluesky'] }), [
      'mastodon',
      'bluesky',
    ]);
  });

  it('is nothing for a post that lists none', () => {
    assert.deepEqual(syndicateToOf({}), []);
    assert.deepEqual(syndicateToOf({ 'syndicate-to': '' }), []);
    assert.deepEqual(syndicateToOf({ 'syndicate-to': { id: 'x' } }), []);
  });
});
