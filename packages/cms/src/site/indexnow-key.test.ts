import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  generateIndexNowKey,
  indexNowKeyPath,
  indexNowKeyResponse,
  isIndexNowKey,
} from './indexnow-key.ts';

describe('the IndexNow key', () => {
  it('accepts 8 to 128 letters, digits and dashes', () => {
    assert.equal(isIndexNowKey('abcd-1234'), true);
    assert.equal(isIndexNowKey('a'.repeat(128)), true);
    for (const value of ['short', 'a'.repeat(129), 'has space1', 'under_score']) {
      assert.equal(isIndexNowKey(value), false, value);
    }
  });

  it('generates a key it accepts', () => {
    const key = generateIndexNowKey();
    assert.match(key, /^[0-9a-f]{32}$/);
    assert.equal(isIndexNowKey(key), true);
  });

  it('serves the key as plain text at /{key}.txt', async () => {
    assert.equal(indexNowKeyPath('abcd-1234'), '/abcd-1234.txt');
    const response = indexNowKeyResponse('abcd-1234');
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await response.text(), 'abcd-1234');
  });
});
