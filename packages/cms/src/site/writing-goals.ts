import { isRecord } from '../util/guards.ts';

/**
 * A user's writing goal and streak rule, stored on their record in
 * `data/users.json` (decision-63). `tracking` is the "Track writing goals"
 * switch; turning it off keeps the goal, so turning it on again restores it.
 */
export interface WritingGoals {
  readonly tracking: boolean;
  readonly words: number;
  readonly period: GoalPeriod;
  readonly streak: StreakRule;
}

/** A day keeps the streak when it has at least `dailyWords`; `missesAllowed` missed days in a row do not end it. */
export interface StreakRule {
  readonly dailyWords: number;
  readonly missesAllowed: number;
}

export const GOAL_PERIODS = ['day', 'week', 'month', 'year'] as const;

export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export const MAX_MISSES_ALLOWED = 7;

// Fixed lengths, so a goal's default streak words do not change from one month to the next.
const DAYS_IN: Readonly<Record<GoalPeriod, number>> = { day: 1, week: 7, month: 30, year: 365 };

/** The streak words a goal suggests: the goal for a daily goal, else its daily pace rounded up. */
export function defaultDailyWords(words: number, period: GoalPeriod): number {
  return Math.ceil(words / DAYS_IN[period]);
}

export function isGoalPeriod(value: unknown): value is GoalPeriod {
  return GOAL_PERIODS.includes(value as GoalPeriod);
}

export function isGoalWords(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isMissesAllowed(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_MISSES_ALLOWED
  );
}

/** Stored writing goals as this version reads them, or `undefined` when they are not usable. */
export function writingGoals(value: unknown): WritingGoals | undefined {
  if (!isRecord(value) || !isRecord(value['streak'])) return undefined;
  const { tracking, words, period } = value;
  const { dailyWords, missesAllowed } = value['streak'];
  if (
    typeof tracking !== 'boolean' ||
    !isGoalWords(words) ||
    !isGoalPeriod(period) ||
    !isGoalWords(dailyWords) ||
    !isMissesAllowed(missesAllowed)
  ) {
    return undefined;
  }
  return { tracking, words, period, streak: { dailyWords, missesAllowed } };
}

/** The user's goals while they track writing goals, otherwise `undefined`. */
export function trackedWritingGoals(user: {
  readonly writingGoals?: WritingGoals | undefined;
}): WritingGoals | undefined {
  return user.writingGoals?.tracking === true ? user.writingGoals : undefined;
}
