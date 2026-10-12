import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LANGUAGE_TAG_PATTERN } from './language.ts';

describe('LANGUAGE_TAG_PATTERN', () => {
  it('takes a tag of BCP 47’s shape, registered or not', () => {
    for (const tag of ['en', 'fr', 'pt-BR', 'zh-Hant-TW', 'gsw']) {
      assert.equal(LANGUAGE_TAG_PATTERN.test(tag), true, tag);
    }
  });

  it('refuses what is not a tag', () => {
    for (const tag of ['', 'e', 'english', 'en_US', 'en-', '-en', 'en-toolongsubtag']) {
      assert.equal(LANGUAGE_TAG_PATTERN.test(tag), false, tag);
    }
  });
});
