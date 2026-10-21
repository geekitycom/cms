import { Temporal } from '@js-temporal/polyfill';

import { dateSortKey } from '../content/store.ts';
import { calendarDayIn, toUtcInstant } from '../content/time.ts';
import type { CoreWidget } from './widgets.ts';

const WEEKS = 52;

export const POSTING_WIDGET: CoreWidget = {
  id: 'posting-activity',
  title: 'Posting activity',
  width: 'full',
  refreshSeconds: 900,
  load(vars) {
    const timezone = vars.siteAtRequestStart.timezone;
    const today = calendarDayIn(vars.config.now(), timezone);
    if (today === undefined) throw new Error('The clock does not read as a date.');

    const firstDay = Temporal.PlainDate.from(today).subtract({ days: WEEKS * 7 - 1 });
    const since = toUtcInstant(firstDay.toString(), timezone);
    if (since === undefined) throw new Error('The year does not start on a date.');

    const perDay = new Map<string, number>();
    for (const document of vars.store.listPostsPublishedSince(since)) {
      const at = dateSortKey(document.date);
      const day = at === null ? undefined : calendarDayIn(at, timezone);
      if (day === undefined) continue;
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }

    if (perDay.size === 0) return [{ paragraph: ['No posts published in the last 52 weeks.'] }];
    const days = Array.from({ length: WEEKS * 7 }, (_, index) =>
      firstDay.add({ days: index }).toString(),
    );

    return [
      {
        calendar: {
          caption: 'Posts per day',
          days: days.map((day) => ({ day, count: perDay.get(day) ?? 0 })),
        },
      },
    ];
  },
};
