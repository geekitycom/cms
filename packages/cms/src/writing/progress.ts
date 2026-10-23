import { Temporal } from '@js-temporal/polyfill';

import type { GoalPeriod, StreakRule, WritingGoals } from '../site/writing-goals.ts';
import { writingDay } from './ledger.ts';
import type { WritingLedger } from './ledger.ts';

/** Where a user stands against their goal and streak rule today (decision-63). */
export interface WritingProgress {
  /** Today in the site timezone, `YYYY-MM-DD`. */
  readonly today: string;
  readonly wordsToday: number;
  readonly period: PeriodProgress;
  readonly streak: StreakProgress;
}

export interface PeriodProgress {
  /** The period's first and last days, inclusive. */
  readonly start: string;
  readonly end: string;
  readonly words: number;
  readonly goal: number;
  /** The even share of the goal for the days up to and including today, rounded up. */
  readonly expected: number;
  /** `words - expected`: ahead of pace when positive, behind when negative. */
  readonly pace: number;
}

export interface StreakProgress {
  /** Days that met the rule in the current run. Allowed misses add nothing. */
  readonly current: number;
  /** The longest run anywhere in the ledger under the current rule. */
  readonly best: number;
  readonly todayMet: boolean;
  /** Words still to write today to meet the rule, 0 once met. */
  readonly todayNeeds: number;
}

export function writingProgress(
  ledger: WritingLedger,
  goals: WritingGoals,
  now: Date,
  timezone: string,
): WritingProgress {
  const today = Temporal.PlainDate.from(writingDay(now, timezone));
  const wordsToday = ledger.days[today.toString()] ?? 0;
  return {
    today: today.toString(),
    wordsToday,
    period: periodProgress(ledger, goals, today),
    streak: {
      ...streaks(ledger, goals.streak, today),
      todayMet: meetsStreak(wordsToday, goals.streak),
      todayNeeds: Math.max(0, goals.streak.dailyWords - wordsToday),
    },
  };
}

/** Whether a day's words keep the streak. */
export function meetsStreak(words: number | undefined, rule: StreakRule): boolean {
  return (words ?? 0) >= rule.dailyWords;
}

function periodProgress(
  ledger: WritingLedger,
  goal: { readonly words: number; readonly period: GoalPeriod },
  today: Temporal.PlainDate,
): PeriodProgress {
  const [start, end] = periodBounds(goal.period, today);
  let words = 0;
  for (const [day, total] of Object.entries(ledger.days)) {
    if (
      Temporal.PlainDate.compare(start, day) <= 0 &&
      Temporal.PlainDate.compare(day, today) <= 0
    ) {
      words += total;
    }
  }
  const elapsed = daysBetween(start, today) + 1;
  const length = daysBetween(start, end) + 1;
  const expected = Math.ceil((goal.words * elapsed) / length);
  return {
    start: start.toString(),
    end: end.toString(),
    words,
    goal: goal.words,
    expected,
    pace: words - expected,
  };
}

function periodBounds(
  period: GoalPeriod,
  today: Temporal.PlainDate,
): [Temporal.PlainDate, Temporal.PlainDate] {
  switch (period) {
    case 'day':
      return [today, today];
    case 'week': {
      const monday = today.subtract({ days: today.dayOfWeek - 1 });
      return [monday, monday.add({ days: 6 })];
    }
    case 'month':
      return [today.with({ day: 1 }), today.with({ day: today.daysInMonth })];
    case 'year':
      return [today.with({ month: 1, day: 1 }), today.with({ month: 12, day: 31 })];
  }
}

/**
 * One pass from the first day in the ledger to today. Today counts once it
 * meets the rule and is never a miss, because it is not over.
 */
function streaks(
  ledger: WritingLedger,
  rule: StreakRule,
  today: Temporal.PlainDate,
): { current: number; best: number } {
  const first = Object.keys(ledger.days)
    .filter((day) => meetsStreak(ledger.days[day], rule))
    .sort()[0];
  if (first === undefined) return { current: 0, best: 0 };

  let run = 0;
  let misses = 0;
  let best = 0;
  for (
    let day = Temporal.PlainDate.from(first);
    Temporal.PlainDate.compare(day, today) <= 0;
    day = day.add({ days: 1 })
  ) {
    if (meetsStreak(ledger.days[day.toString()], rule)) {
      run += 1;
      misses = 0;
    } else if (!day.equals(today)) {
      misses += 1;
      if (misses > rule.missesAllowed) run = 0;
    }
    best = Math.max(best, run);
  }
  return { current: run, best };
}

function daysBetween(from: Temporal.PlainDate, to: Temporal.PlainDate): number {
  return from.until(to, { largestUnit: 'day' }).days;
}
