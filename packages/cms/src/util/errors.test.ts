import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { messageOf } from './errors.ts';

describe('messageOf', () => {
  it('reads the message of an Error', () => {
    assert.equal(messageOf(new TypeError('bad input')), 'bad input');
  });

  it('turns anything else thrown into text', () => {
    assert.equal(messageOf('plain string'), 'plain string');
    assert.equal(messageOf(42), '42');
    assert.equal(messageOf(undefined), 'undefined');
  });
});
