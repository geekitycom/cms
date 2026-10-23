import { isRecord } from '../util/guards.ts';

export interface WritingGoals {
  readonly tracking: boolean;
  readonly words: number;
  readonly period: GoalPeriod;
  readonly streak: StreakRule;
}

export interface StreakRule {
  readonly dailyWords: number;
  readonly missesAllowed: number;
}

export const GOAL_PERIODS = ['day', 'week', 'month', 'year'] as const;

export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export const MAX_MISSES_ALLOWED = 7;

const NOMINAL_DAYS_IN: Readonly<Record<GoalPeriod, number>> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

export function defaultDailyWords(words: number, period: GoalPeriod): number {
  return Math.ceil(words / NOMINAL_DAYS_IN[period]);
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

export function trackedWritingGoals(user: {
  readonly writingGoals?: WritingGoals | undefined;
}): WritingGoals | undefined {
  return user.writingGoals?.tracking === true ? user.writingGoals : undefined;
}
