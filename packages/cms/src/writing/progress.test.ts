import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GoalPeriod, StreakRule } from '../site/writing-goals.ts';
import { meetsStreak, writingProgress } from './progress.ts';

const NOON = 'T12:00:00Z';

function progress(
  days: Record<string, number>,
  today: string,
  goal: { words: number; period: GoalPeriod } = { words: 250, period: 'day' },
  streak: StreakRule = { dailyWords: 100, missesAllowed: 0 },
  timezone = 'UTC',
  now = new Date(`${today}${NOON}`),
) {
  return writingProgress({ days }, { tracking: true, ...goal, streak }, now, timezone);
}

describe('period progress', () => {
  it('sums today for a daily goal', () => {
    const { period, wordsToday } = progress({ '2026-10-22': 900, '2026-10-23': 120 }, '2026-10-23');
    assert.deepEqual(period, {
      start: '2026-10-23',
      end: '2026-10-23',
      words: 120,
      goal: 250,
      expected: 250,
      pace: -130,
    });
    assert.equal(wordsToday, 120);
  });

  it('sums a month up to its last day and starts again on the first', () => {
    const days = { '2026-01-01': 100, '2026-01-31': 200, '2026-02-01': 50 };
    const january = progress(days, '2026-01-31', { words: 3100, period: 'month' }).period;
    assert.equal(january.start, '2026-01-01');
    assert.equal(january.end, '2026-01-31');
    assert.equal(january.words, 300);
    assert.equal(january.expected, 3100);

    const february = progress(days, '2026-02-01', { words: 2800, period: 'month' }).period;
    assert.equal(february.start, '2026-02-01');
    assert.equal(february.end, '2026-02-28');
    assert.equal(february.words, 50);
    assert.equal(february.expected, 100);
    assert.equal(february.pace, -50);
  });

  it('knows February has 29 days and the year 366 in a leap year', () => {
    const february = progress({}, '2028-02-29', { words: 2900, period: 'month' }).period;
    assert.equal(february.end, '2028-02-29');
    assert.equal(february.expected, 2900);

    const year = progress({ '2028-12-31': 10 }, '2028-12-31', {
      words: 366,
      period: 'year',
    }).period;
    assert.deepEqual(
      [year.start, year.end, year.expected, year.words],
      ['2028-01-01', '2028-12-31', 366, 10],
    );

    const midYear = progress({}, '2028-03-01', { words: 366, period: 'year' }).period;
    assert.equal(midYear.expected, 61, 'Jan 31 + Feb 29 + Mar 1');
  });

  it('starts a week on Monday, across a year end', () => {
    const days = {
      '2025-12-28': 999,
      '2025-12-29': 100,
      '2026-01-01': 200,
      '2026-01-04': 300,
      '2026-01-05': 7,
    };
    const sunday = progress(days, '2026-01-04', { words: 700, period: 'week' }).period;
    assert.deepEqual(
      [sunday.start, sunday.end, sunday.words, sunday.expected],
      ['2025-12-29', '2026-01-04', 600, 700],
    );

    const monday = progress(days, '2026-01-05', { words: 700, period: 'week' }).period;
    assert.deepEqual(
      [monday.start, monday.end, monday.words, monday.expected],
      ['2026-01-05', '2026-01-11', 7, 100],
    );
  });

  it('reports ahead of the even share as a positive pace', () => {
    const { period } = progress({ '2026-10-01': 5000 }, '2026-10-03', {
      words: 31_000,
      period: 'month',
    });
    assert.equal(period.expected, 3000);
    assert.equal(period.pace, 2000);
  });

  it('places today by the site timezone, across a DST change', () => {
    const chicago = 'America/Chicago';
    const days = { '2026-03-07': 40, '2026-03-08': 60, '2026-03-09': 80 };
    const week = { words: 700, period: 'week' as const };

    const saturdayNight = progress(
      days,
      '2026-03-07',
      week,
      undefined,
      chicago,
      new Date('2026-03-08T05:30:00Z'),
    );
    assert.equal(saturdayNight.today, '2026-03-07');

    const sunday = progress(
      days,
      '2026-03-08',
      week,
      undefined,
      chicago,
      new Date('2026-03-09T04:30:00Z'),
    );
    assert.equal(sunday.today, '2026-03-08', '23:30 CDT on the day clocks went forward');
    assert.equal(sunday.period.start, '2026-03-02');
    assert.equal(sunday.period.words, 100);

    const monday = progress(
      days,
      '2026-03-09',
      week,
      undefined,
      chicago,
      new Date('2026-03-09T05:30:00Z'),
    );
    assert.equal(monday.today, '2026-03-09');
    assert.equal(monday.period.start, '2026-03-09');
    assert.equal(monday.period.words, 80);

    const fallBack = progress(
      { '2026-11-01': 5 },
      '2026-11-01',
      undefined,
      undefined,
      chicago,
      new Date('2026-11-02T05:30:00Z'),
    );
    assert.equal(fallBack.today, '2026-11-01', '23:30 CST on the day clocks went back');
    assert.equal(fallBack.wordsToday, 5);
  });
});

describe('streaks', () => {
  const oneMiss: StreakRule = { dailyWords: 100, missesAllowed: 1 };

  it('survives one missed day with one miss allowed, and the miss adds nothing', () => {
    const days = { '2026-10-20': 100, '2026-10-22': 150, '2026-10-23': 100 };
    const { streak } = progress(days, '2026-10-23', undefined, oneMiss);
    assert.equal(streak.current, 3);
  });

  it('ends after two missed days in a row with one miss allowed', () => {
    const days = { '2026-10-19': 100, '2026-10-22': 150, '2026-10-23': 100 };
    assert.equal(progress(days, '2026-10-23', undefined, oneMiss).streak.current, 2);
  });

  it('counts a day under the streak words as a miss', () => {
    const days = { '2026-10-20': 100, '2026-10-21': 99, '2026-10-22': 99, '2026-10-23': 100 };
    assert.equal(progress(days, '2026-10-23', undefined, oneMiss).streak.current, 1);
  });

  it('is not broken by today until today is over', () => {
    const days = { '2026-10-21': 100, '2026-10-22': 100, '2026-10-23': 30 };
    const { streak } = progress(days, '2026-10-23');
    assert.equal(streak.current, 2);
    assert.equal(streak.todayMet, false);
    assert.equal(streak.todayNeeds, 70);
  });

  it('is broken by yesterday beyond the allowance', () => {
    const days = { '2026-10-20': 100, '2026-10-21': 100 };
    assert.equal(
      progress(days, '2026-10-23', undefined, { dailyWords: 100, missesAllowed: 0 }).streak.current,
      0,
    );
    assert.equal(
      progress(days, '2026-10-23', undefined, oneMiss).streak.current,
      2,
      'one miss is allowed',
    );
    assert.equal(
      progress({ ...days, '2026-10-23': 100 }, '2026-10-23').streak.current,
      1,
      'today starts a new run',
    );
  });

  it('counts today once it meets the rule', () => {
    const { streak } = progress({ '2026-10-22': 100, '2026-10-23': 100 }, '2026-10-23');
    assert.deepEqual([streak.current, streak.todayMet, streak.todayNeeds], [2, true, 0]);
  });

  it('finds the best streak anywhere in the ledger under the current rules', () => {
    const days = {
      '2026-01-01': 100,
      '2026-01-02': 100,
      '2026-01-04': 100,
      '2026-01-05': 100,
      '2026-03-01': 300,
      '2026-10-23': 300,
    };
    assert.equal(
      progress(days, '2026-10-23', undefined, { dailyWords: 100, missesAllowed: 0 }).streak.best,
      2,
    );
    assert.equal(progress(days, '2026-10-23', undefined, oneMiss).streak.best, 4);
    assert.equal(
      progress(days, '2026-10-23', undefined, { dailyWords: 200, missesAllowed: 0 }).streak.best,
      1,
    );
  });

  it('is nothing for an empty ledger', () => {
    const { streak, wordsToday } = progress({}, '2026-10-23');
    assert.deepEqual([streak.current, streak.best, streak.todayMet, wordsToday], [0, 0, false, 0]);
  });

  it('ignores days after today', () => {
    assert.equal(progress({ '2026-10-24': 500 }, '2026-10-23').streak.best, 0);
  });

  it('marks a day met by the streak words', () => {
    assert.equal(meetsStreak(100, oneMiss), true);
    assert.equal(meetsStreak(99, oneMiss), false);
    assert.equal(meetsStreak(undefined, oneMiss), false);
  });
});
