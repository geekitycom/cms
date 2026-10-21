import type { PluginBlock, PluginWidget } from '@geekity/cms/plugin';

import type { UmamiClient, UmamiDayCount, UmamiTotals } from './client.ts';
import { dayIn, daysEnding, rangeOf } from './period.ts';

/**
 * The dashboard's main Umami card: visitors, views, bounce rate and average
 * visit time against the period before, and views and visitors per day. The
 * period is the dashboard's, its days in the site's time zone.
 */
export function trafficWidget(
  client: UmamiClient,
  now: () => Date = () => new Date(),
): PluginWidget {
  return {
    id: 'traffic',
    title: 'Umami: views and visitors',
    width: 'full',
    refreshSeconds: 300,
    async load({ timezone, period }) {
      if (!(await client.configured())) return [];
      const days = daysEnding(dayIn(now(), timezone), period);
      const range = rangeOf(days, timezone);
      const [stats, daily] = await Promise.all([
        client.stats(range),
        client.pageviews(range, { timezone }),
      ]);
      return [statsBlock(stats.current, stats.previous), seriesBlock(days, daily)];
    },
  };
}

function statsBlock(current: UmamiTotals, previous: UmamiTotals | undefined): PluginBlock {
  const stat = (
    label: string,
    value: (totals: UmamiTotals) => number,
    extra: { format?: 'percent' | 'duration'; better?: 'down' } = {},
  ) => ({
    label,
    value: value(current),
    ...(previous === undefined ? {} : { previous: value(previous) }),
    ...extra,
  });
  return {
    stats: [
      stat('Visitors', (totals) => totals.visitors),
      stat('Views', (totals) => totals.pageviews),
      stat('Bounce rate', bounceRate, { format: 'percent', better: 'down' }),
      stat('Average visit time', averageVisit, { format: 'duration' }),
    ],
  };
}

/** As Umami's own dashboard: visits that saw one page, of all visits. */
function bounceRate(totals: UmamiTotals): number {
  return totals.visits === 0 ? 0 : (Math.min(totals.bounces, totals.visits) / totals.visits) * 100;
}

/** Seconds, as Umami's own dashboard: the summed visit time over the visits. */
function averageVisit(totals: UmamiTotals): number {
  return totals.visits === 0 ? 0 : totals.totaltime / totals.visits;
}

function seriesBlock(
  days: readonly string[],
  daily: { pageviews: readonly UmamiDayCount[]; sessions: readonly UmamiDayCount[] },
): PluginBlock {
  const perDay = (counts: readonly UmamiDayCount[]) => {
    const byDay = new Map(counts.map((entry) => [entry.day, entry.count]));
    return days.map((day) => byDay.get(day) ?? 0);
  };
  return {
    timeSeries: {
      caption: 'Views and visitors per day',
      days,
      series: [
        { name: 'Views', values: perDay(daily.pageviews) },
        { name: 'Visitors', values: perDay(daily.sessions) },
      ],
    },
  };
}
