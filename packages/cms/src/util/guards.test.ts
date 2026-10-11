import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isRecord } from './guards.ts';

describe('isRecord', () => {
  it('accepts a plain object', () => {
    assert.equal(isRecord({ a: 1 }), true);
    assert.equal(isRecord({}), true);
  });

  it('refuses null, arrays and primitives', () => {
    assert.equal(isRecord(null), false);
    assert.equal(isRecord([]), false);
    assert.equal(isRecord('x'), false);
    assert.equal(isRecord(1), false);
    assert.equal(isRecord(undefined), false);
  });
});
