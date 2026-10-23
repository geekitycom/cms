import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { wordsLabel, wordsTodayAt } from './editor-words.ts';

describe('wordsLabel', () => {
  it('says word for one and words otherwise', () => {
    assert.equal(wordsLabel(0), '0 words');
    assert.equal(wordsLabel(1), '1 word');
    assert.equal(wordsLabel(2), '2 words');
  });

  it('groups thousands', () => {
    assert.equal(wordsLabel(12345), '12,345 words');
  });

  it("adds today's words when there is a figure for today", () => {
    assert.equal(wordsLabel(1240, 312), '1,240 words · 312 today');
    assert.equal(wordsLabel(1, 0), '1 word · 0 today');
    assert.equal(wordsLabel(0, 1500), '0 words · 1,500 today');
  });
});

describe('wordsTodayAt', () => {
  const baseline = { body: 'one two three', today: 40 };

  it('is the baseline total while the body is unchanged', () => {
    assert.equal(wordsTodayAt(baseline, 'one two three'), 40);
  });

  it('rises by the words typed since the baseline', () => {
    assert.equal(wordsTodayAt(baseline, 'one two three four five'), 42);
  });

  it('never drops below the baseline total when text is deleted', () => {
    assert.equal(wordsTodayAt(baseline, 'one'), 40);
    assert.equal(wordsTodayAt(baseline, ''), 40);
  });

  it('counts a replaced word as one added', () => {
    assert.equal(wordsTodayAt(baseline, 'one two four'), 41);
  });
});
