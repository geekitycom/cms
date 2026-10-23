import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultDailyWords, trackedWritingGoals, writingGoals } from './writing-goals.ts';
import type { WritingGoals } from './writing-goals.ts';

const GOALS: WritingGoals = {
  tracking: true,
  words: 250,
  period: 'day',
  streak: { dailyWords: 250, missesAllowed: 1 },
};

describe('the streak words default', () => {
  it('is the goal itself for a daily goal', () => {
    assert.equal(defaultDailyWords(250, 'day'), 250);
  });

  it('is the daily pace rounded up for a longer period', () => {
    assert.equal(defaultDailyWords(100_000, 'month'), 3334);
    assert.equal(defaultDailyWords(1000, 'week'), 143);
    assert.equal(defaultDailyWords(365_000, 'year'), 1000);
    assert.equal(defaultDailyWords(1, 'year'), 1);
  });
});

describe('stored writing goals', () => {
  it('read back as saved', () => {
    assert.deepEqual(writingGoals(JSON.parse(JSON.stringify(GOALS))), GOALS);
  });

  it('are dropped when the goal or rules are not usable', () => {
    assert.equal(writingGoals(undefined), undefined);
    assert.equal(writingGoals({ ...GOALS, words: 0 }), undefined);
    assert.equal(writingGoals({ ...GOALS, period: 'fortnight' }), undefined);
    assert.equal(
      writingGoals({ ...GOALS, streak: { dailyWords: 10, missesAllowed: 8 } }),
      undefined,
    );
    assert.equal(writingGoals({ ...GOALS, tracking: 'yes' }), undefined);
  });

  it('count as tracked only while the switch is on', () => {
    assert.deepEqual(trackedWritingGoals({ writingGoals: GOALS }), GOALS);
    assert.equal(trackedWritingGoals({ writingGoals: { ...GOALS, tracking: false } }), undefined);
    assert.equal(trackedWritingGoals({}), undefined);
  });
});
