import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pageCount } from './pagination.ts';

describe('pageCount', () => {
  it('rounds a partly filled last page up', () => {
    assert.equal(pageCount(21, 10), 3);
    assert.equal(pageCount(20, 10), 2);
  });

  it('gives an empty listing one page', () => {
    assert.equal(pageCount(0, 10), 1);
  });

  it('treats a page size below 1 as 1', () => {
    assert.equal(pageCount(3, 0), 3);
  });
});
