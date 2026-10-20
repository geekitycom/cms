import { Temporal } from '@js-temporal/polyfill';

import { calendarDayIn } from '../content/time.ts';
import { followerDays, readFollowerChanges } from '../federation/follower-history.ts';
import type { FollowerDay } from '../federation/follower-history.ts';
import type { CoreWidget } from './widgets.ts';

/**
 * The site's follower count at the end of each day of the dashboard's period,
 * in the site's time zone, with the follows and unfollows of the period
 * against the period before.
 */
export const FOLLOWERS_WIDGET: CoreWidget = {
  id: 'followers',
  title: 'Followers',
  width: 'half',
  refreshSeconds: 300,
  load(vars, period) {
    const timezone = vars.siteAtRequestStart.timezone;
    const today = calendarDayIn(vars.config.now(), timezone);
    if (today === undefined) throw new Error('The clock does not read as a date.');

    const first = Temporal.PlainDate.from(today).subtract({ days: 2 * period - 1 });
    const days = followerDays(
      readFollowerChanges(vars.config.dataDir),
      Array.from({ length: 2 * period }, (_, index) => first.add({ days: index }).toString()),
      timezone,
      vars.admin.countFollowers(),
    );

    const previous = days.slice(0, period);
    const shown = days.slice(period);
    const countAtEnd = (over: readonly FollowerDay[]): number => over.at(-1)?.count ?? 0;
    const total = (over: readonly FollowerDay[], key: 'gained' | 'lost'): number =>
      over.reduce((sum, day) => sum + day[key], 0);

    return [
      {
        stats: [
          { label: 'Followers', value: countAtEnd(shown), previous: countAtEnd(previous) },
          { label: 'Gained', value: total(shown, 'gained'), previous: total(previous, 'gained') },
          {
            label: 'Lost',
            value: total(shown, 'lost'),
            previous: total(previous, 'lost'),
            better: 'down',
          },
        ],
      },
      {
        timeSeries: {
          caption: 'Followers at the end of each day',
          days: shown.map((day) => day.day),
          series: [{ name: 'Followers', values: shown.map((day) => day.count) }],
        },
      },
    ];
  },
};
