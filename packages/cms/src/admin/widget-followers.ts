import { followerDays, readFollowerChanges } from '../federation/follower-history.ts';
import type { FollowerDay } from '../federation/follower-history.ts';
import { daysEndingToday } from './widgets.ts';
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
    const days = followerDays(
      readFollowerChanges(vars.config.dataDir),
      daysEndingToday(vars, 2 * period),
      vars.siteAtRequestStart.timezone,
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
