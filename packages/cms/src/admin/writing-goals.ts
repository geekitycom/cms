/**
 * Users > Writing goals (TASK-500, decision-63): the signed-in user's own
 * "Track writing goals" switch, goal and streak rule, stored on their record.
 *
 * The goal fields are drawn only while tracking is on, as saved or as just
 * posted, so the page works without JavaScript: ticking the switch and saving
 * reveals them. A field the post does not carry, because it was not drawn,
 * keeps its saved value, which is how turning tracking back on restores the
 * goal.
 */
import type { Context, Hono } from 'hono';

import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { USERS_PATH } from '../site/admin-paths.ts';
import { findUserById, setUserWritingGoals } from '../site/users.ts';
import {
  defaultDailyWords,
  GOAL_PERIODS,
  isGoalPeriod,
  isMissesAllowed,
  MAX_MISSES_ALLOWED,
} from '../site/writing-goals.ts';
import type { WritingGoals } from '../site/writing-goals.ts';
import type { GeekityEnv } from '../web/env.ts';

export const WRITING_GOALS_PATH = `${USERS_PATH}/writing-goals`;

export const WRITING_GOALS_CHILD = 'writing-goals';

export const WRITING_GOALS_FIELDS = {
  tracking: 'tracking',
  words: 'words',
  period: 'period',
  dailyWords: 'daily_words',
  missesAllowed: 'misses_allowed',
} as const;

const DEFAULT_MISSES_ALLOWED = 1;

const PERIOD_LABELS: Readonly<Record<(typeof GOAL_PERIODS)[number], string>> = {
  day: 'a day',
  week: 'a week',
  month: 'a month',
  year: 'a year',
};

/** The form as drawn: what is saved, or what was just posted. */
export interface GoalsForm {
  readonly tracking: boolean;
  readonly words: string;
  readonly period: string;
  readonly dailyWords: string;
  readonly missesAllowed: string;
}

type GoalsProblems = Partial<Record<Exclude<keyof GoalsForm, 'tracking'>, string>>;

export type GoalsOutcome =
  | { readonly saved: WritingGoals | undefined }
  | { readonly refused: GoalsForm; readonly problems: GoalsProblems };

export function mountWritingGoals(app: Hono<GeekityEnv>, options: { render: AdminRender }): void {
  const { render } = options;

  app.get(WRITING_GOALS_PATH, (c) => {
    const user = signedInUser(c);
    if (user === undefined) return c.redirect(USERS_PATH, 303);
    return render(c, ADMIN_TEMPLATES.writingGoals, screen(goalsForm(user.writingGoals), {}));
  });

  app.post(WRITING_GOALS_PATH, async (c) => {
    const user = signedInUser(c);
    if (user === undefined) return c.redirect(USERS_PATH, 303);

    const outcome = readGoalsForm(await c.req.parseBody(), user.writingGoals);
    if ('refused' in outcome) {
      c.status(400);
      return render(c, ADMIN_TEMPLATES.writingGoals, screen(outcome.refused, outcome.problems));
    }

    const goals = outcome.saved;
    if (goals !== undefined) {
      await setUserWritingGoals({ dataDir: c.var.config.dataDir, userId: user.id, goals });
    }
    flash(
      c,
      'notice',
      goals?.tracking === true
        ? `Tracking a goal of ${wordsText(goals.words)} words ${PERIOD_LABELS[goals.period]}.`
        : 'Writing goals are off. A saved goal is kept for when you turn them on again.',
    );
    return c.redirect(WRITING_GOALS_PATH, 303);
  });
}

/**
 * A posted form as the goals to save, or the form to draw again with what is
 * wrong. Unticked keeps the stored goal and only turns tracking off.
 */
export function readGoalsForm(
  body: Readonly<Record<string, unknown>>,
  stored: WritingGoals | undefined,
): GoalsOutcome {
  if (body[WRITING_GOALS_FIELDS.tracking] === undefined) {
    return { saved: stored === undefined ? undefined : { ...stored, tracking: false } };
  }

  const shown = goalsForm(stored);
  const posted = (name: keyof typeof WRITING_GOALS_FIELDS, fallback: string): string => {
    const value = body[WRITING_GOALS_FIELDS[name]];
    return typeof value === 'string' ? value.trim() : fallback;
  };
  const form: GoalsForm = {
    tracking: true,
    words: posted('words', shown.words),
    period: posted('period', shown.period),
    dailyWords: posted('dailyWords', shown.dailyWords),
    missesAllowed: posted('missesAllowed', shown.missesAllowed),
  };

  const words = wholeNumber(form.words);
  const dailyWords = wholeNumber(form.dailyWords);
  const missesAllowed = wholeNumber(form.missesAllowed);
  const problems: GoalsProblems = {};
  if (!isPositive(words)) {
    problems.words =
      form.words === ''
        ? 'Set a goal to track writing goals.'
        : 'Enter a whole number of words above 0.';
  }
  if (!isGoalPeriod(form.period)) problems.period = 'Choose a day, a week, a month or a year.';
  if (form.dailyWords !== '' && !isPositive(dailyWords)) {
    problems.dailyWords =
      "Enter a whole number of words above 0, or leave it empty for the goal's daily pace.";
  }
  if (!isMissesAllowed(missesAllowed)) {
    problems.missesAllowed = `Enter a number of days from 0 to ${String(MAX_MISSES_ALLOWED)}.`;
  }

  if (
    !isPositive(words) ||
    !isGoalPeriod(form.period) ||
    !isMissesAllowed(missesAllowed) ||
    problems.dailyWords !== undefined
  ) {
    return { refused: form, problems };
  }
  return {
    saved: {
      tracking: true,
      words,
      period: form.period,
      streak: {
        dailyWords: isPositive(dailyWords) ? dailyWords : defaultDailyWords(words, form.period),
        missesAllowed,
      },
    },
  };
}

function goalsForm(stored: WritingGoals | undefined): GoalsForm {
  return {
    tracking: stored?.tracking ?? false,
    words: stored === undefined ? '' : String(stored.words),
    period: stored?.period ?? 'day',
    dailyWords: stored === undefined ? '' : String(stored.streak.dailyWords),
    missesAllowed: String(stored?.streak.missesAllowed ?? DEFAULT_MISSES_ALLOWED),
  };
}

function screen(form: GoalsForm, problems: GoalsProblems): Record<string, unknown> {
  const words = wholeNumber(form.words);
  return {
    section: 'users',
    child: WRITING_GOALS_CHILD,
    formUrl: WRITING_GOALS_PATH,
    fields: WRITING_GOALS_FIELDS,
    form,
    problems,
    hasProblems: Object.keys(problems).length > 0,
    periods: GOAL_PERIODS.map((value) => ({
      value,
      label: `Words ${PERIOD_LABELS[value]}`,
      chosen: value === form.period,
    })),
    maxMissesAllowed: MAX_MISSES_ALLOWED,
    paceWords:
      isPositive(words) && isGoalPeriod(form.period)
        ? wordsText(defaultDailyWords(words, form.period))
        : undefined,
  };
}

function signedInUser(c: Context<GeekityEnv>) {
  const userId = c.var.session?.userId;
  return userId == null ? undefined : findUserById(c.var.config.dataDir, userId);
}

/** A typed count, allowing thousands separators: `100,000` is 100000. */
function wholeNumber(text: string): number | undefined {
  const digits = text.replaceAll(',', '');
  if (!/^\d+$/.test(digits)) return undefined;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : undefined;
}

function isPositive(value: number | undefined): value is number {
  return value !== undefined && value > 0;
}

function wordsText(words: number): string {
  return words.toLocaleString('en-US');
}
