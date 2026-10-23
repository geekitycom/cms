import { Temporal } from '@js-temporal/polyfill';

import type { PluginBlock } from '../plugin.ts';
import { trackedWritingGoals } from '../site/writing-goals.ts';
import type { GoalPeriod } from '../site/writing-goals.ts';
import { messageOf } from '../util/errors.ts';
import { readWritingLedger } from '../writing/ledger.ts';
import type { WritingLedger } from '../writing/ledger.ts';
import { meetsStreak, writingProgress } from '../writing/progress.ts';
import type { WritingProgress } from '../writing/progress.ts';
import type { CoreWidget } from './widgets.ts';

const WEEKS = 52;

const whole = new Intl.NumberFormat('en');

const PERIOD_LABEL: Readonly<Record<GoalPeriod, string>> = {
  day: 'Words today',
  week: 'Words this week',
  month: 'Words this month',
  year: 'Words this year',
};

/** The signed-in user's progress toward their writing goal (decision-63). */
export const WRITING_WIDGET: CoreWidget = {
  id: 'writing-goal',
  title: 'Writing goal',
  width: 'half',
  // The ledger is one small local file and changes with every autosave.
  refreshSeconds: 0,
  forUser: (user) => trackedWritingGoals(user) !== undefined,
  load(vars, _period, user) {
    const goals = user === undefined ? undefined : trackedWritingGoals(user);
    if (user === undefined || goals === undefined) return [];

    let ledger: WritingLedger;
    try {
      ledger = readWritingLedger(vars.config.dataDir, user.id);
    } catch (error) {
      console.warn(`The record of words written for user ${String(user.id)}: ${messageOf(error)}`);
      return [
        {
          paragraph: [
            'Your record of words written could not be read, so there is no progress to show.',
          ],
        },
      ];
    }
    const progress = writingProgress(
      ledger,
      goals,
      vars.config.now(),
      vars.siteAtRequestStart.timezone,
    );
    const bar: PluginBlock = {
      progress: {
        label: PERIOD_LABEL[goals.period],
        value: progress.period.words,
        max: progress.period.goal,
      },
    };
    if (Object.keys(ledger.days).length === 0) {
      return [
        bar,
        {
          paragraph: [
            'No words written yet. Words you write in the editor count from the day you write them.',
          ],
        },
      ];
    }

    return [
      bar,
      { paragraph: [paceText(progress)] },
      {
        stats: [
          { label: 'Words today', value: progress.wordsToday },
          { label: 'Current streak (days)', value: progress.streak.current },
          { label: 'Best streak (days)', value: progress.streak.best },
        ],
      },
      { paragraph: [streakText(progress)] },
      {
        calendar: {
          caption: 'Words per day',
          mark: 'Met the streak rule',
          days: lastWeeks(progress.today).map((day) => {
            const count = ledger.days[day] ?? 0;
            return { day, count, marked: meetsStreak(count, goals.streak) };
          }),
        },
      },
    ];
  },
};

function paceText({ period }: WritingProgress): string {
  const byToday = `(${whole.format(period.expected)} by today)`;
  if (period.pace === 0) return `Right on even pace ${byToday}.`;
  const words = `${whole.format(Math.abs(period.pace))} ${Math.abs(period.pace) === 1 ? 'word' : 'words'}`;
  return `${words} ${period.pace > 0 ? 'ahead of' : 'behind'} even pace ${byToday}.`;
}

function streakText({ streak }: WritingProgress): string {
  if (streak.todayMet) return 'You have written enough today to keep your streak going.';
  const count = whole.format(streak.todayNeeds);
  const noun = streak.todayNeeds === 1 ? 'word' : 'words';
  return streak.current === 0
    ? `Write ${count} ${noun} today to start a streak.`
    : `Write ${count} more ${noun} today to keep your streak going.`;
}

function lastWeeks(today: string): string[] {
  const first = Temporal.PlainDate.from(today).subtract({ days: WEEKS * 7 - 1 });
  return Array.from({ length: WEEKS * 7 }, (_, index) => first.add({ days: index }).toString());
}
