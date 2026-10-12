import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { authorFeedHref } from './feed-source.ts';

describe('an author archive’s feeds', () => {
  it('hangs the three feeds off the archive, RSS at the bare feed', () => {
    assert.equal(authorFeedHref('ada', 'rss'), '/author/ada/feed/');
    assert.equal(authorFeedHref('ada', 'atom'), '/author/ada/feed/atom/');
    assert.equal(authorFeedHref('ada', 'json'), '/author/ada/feed/json/');
  });
});
