import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { newestFirst } from './conversation-feed.ts';

describe('the newest of a mixed list', () => {
  const said = [
    { id: 'a', published: new Date('2026-01-01') },
    { id: 'c', published: new Date('2026-03-01') },
    { id: 'b', published: new Date('2026-02-01') },
  ];

  it('keeps the newest `limit`, newest first', () => {
    assert.deepEqual(
      newestFirst(said, 2).map((entry) => entry.id),
      ['c', 'b'],
    );
  });

  it('leaves the list it was handed in the order it was in', () => {
    newestFirst(said, 3);
    assert.deepEqual(
      said.map((entry) => entry.id),
      ['a', 'c', 'b'],
    );
  });
});
