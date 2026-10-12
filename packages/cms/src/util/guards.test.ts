import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isRecord, nonEmptyStrings } from './guards.ts';

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

describe('nonEmptyStrings', () => {
  it('is one string as a list, or the non-empty strings of a list', () => {
    assert.deepEqual(nonEmptyStrings('a'), ['a']);
    assert.deepEqual(nonEmptyStrings(['a', '', 1, null, 'b']), ['a', 'b']);
  });

  it('is empty for an empty string and for anything else', () => {
    assert.deepEqual(nonEmptyStrings(''), []);
    assert.deepEqual(nonEmptyStrings(undefined), []);
    assert.deepEqual(nonEmptyStrings({ a: 'b' }), []);
  });
});
