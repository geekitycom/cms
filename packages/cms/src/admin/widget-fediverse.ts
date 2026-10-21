import { calendarDayIn, toUtcInstant } from '../content/time.ts';
import type { InboxInteraction } from '../store/admin-store.ts';
import { daysEndingToday } from './widgets.ts';
import type { CoreWidget } from './widgets.ts';

const SERIES: readonly { kind: InboxInteraction['kind']; name: string }[] = [
  { kind: 'like', name: 'Likes' },
  { kind: 'boost', name: 'Boosts' },
  { kind: 'reply', name: 'Replies' },
];

export const FEDIVERSE_WIDGET: CoreWidget = {
  id: 'fediverse-activity',
  title: 'Fediverse',
  width: 'full',
  refreshSeconds: 300,
  load(vars, period) {
    const timezone = vars.siteAtRequestStart.timezone;
    const days = daysEndingToday(vars, 2 * period);
    const since = toUtcInstant(days[0] ?? '', timezone);
    if (since === undefined) throw new Error('The period does not start on a date.');

    const counts = new Map(SERIES.map(({ kind }) => [kind, new Map<string, number>()]));
    for (const { kind, receivedAt } of vars.admin.listInteractionsSince(since)) {
      const day = calendarDayIn(receivedAt, timezone);
      const perDay = counts.get(kind);
      if (day === undefined || perDay === undefined) continue;
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }

    const previousDays = days.slice(0, period);
    const shownDays = days.slice(period);
    const valuesOf = (kind: InboxInteraction['kind'], over: readonly string[]): number[] =>
      over.map((day) => counts.get(kind)?.get(day) ?? 0);
    const total = (values: readonly number[]): number => values.reduce((sum, n) => sum + n, 0);

    return [
      {
        stats: SERIES.map(({ kind, name }) => ({
          label: name,
          value: total(valuesOf(kind, shownDays)),
          previous: total(valuesOf(kind, previousDays)),
        })),
      },
      {
        timeSeries: {
          caption: 'Likes, boosts and replies per day',
          days: shownDays,
          series: SERIES.map(({ kind, name }) => ({ name, values: valuesOf(kind, shownDays) })),
        },
      },
    ];
  },
};
