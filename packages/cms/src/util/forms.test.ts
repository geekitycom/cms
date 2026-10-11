import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nonEmptyStringOrNull, stringOrEmpty } from './forms.ts';

describe('stringOrEmpty', () => {
  it('keeps a string as it is, untrimmed', () => {
    assert.equal(stringOrEmpty(' a b '), ' a b ');
  });

  it('reads a file upload, a missing field or a non-string as empty', () => {
    assert.equal(stringOrEmpty(new File(['x'], 'x.txt')), '');
    assert.equal(stringOrEmpty(undefined), '');
    assert.equal(stringOrEmpty(['a']), '');
    assert.equal(stringOrEmpty(3), '');
  });
});

describe('nonEmptyStringOrNull', () => {
  it('keeps a non-empty string', () => {
    assert.equal(nonEmptyStringOrNull('a'), 'a');
  });

  it('reads an empty string or a non-string as null', () => {
    assert.equal(nonEmptyStringOrNull(''), null);
    assert.equal(nonEmptyStringOrNull(undefined), null);
    assert.equal(nonEmptyStringOrNull(7), null);
  });
});
