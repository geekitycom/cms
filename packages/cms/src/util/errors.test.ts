import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { messageOf, oneLineMessageOf } from './errors.ts';

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

describe('oneLineMessageOf', () => {
  it('keeps only the first line of the message', () => {
    assert.equal(oneLineMessageOf(new Error('refused (500)\nbody\nmore')), 'refused (500)');
    assert.equal(oneLineMessageOf(new Error('refused\r\nbody')), 'refused');
  });

  it('writes control characters as escapes', () => {
    assert.equal(
      oneLineMessageOf('a\u001b[2Jb\tc\u009bd\u007f'),
      'a\\u001b[2Jb\\u0009c\\u009bd\\u007f',
    );
  });

  it('leaves other text as it is', () => {
    assert.equal(oneLineMessageOf(new Error('Café — 404')), 'Café — 404');
  });
});
