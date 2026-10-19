import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatFileSize } from './formatting.ts';

describe('formatFileSize', () => {
  it('counts bytes, then kilobytes, then megabytes to one place', () => {
    assert.equal(formatFileSize(1), '1 byte');
    assert.equal(formatFileSize(8), '8 bytes');
    assert.equal(formatFileSize(942080), '920 KB');
    assert.equal(formatFileSize(1843200), '1.8 MB');
  });
});
