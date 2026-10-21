import type { PluginBlock, PluginWidget } from '@geekity/cms/plugin';

import type { UmamiClient, UmamiDailyCounts, UmamiDayCount, UmamiTotals } from './client.ts';
import { lastDays } from './period.ts';

export function trafficWidget(
  client: UmamiClient,
  now: () => Date = () => new Date(),
): PluginWidget {
  return {
    id: 'traffic',
    title: 'Umami: views and visitors',
    width: 'half',
    refreshSeconds: 300,
    async load({ timezone, period, signal }) {
      if (!(await client.configured())) return [];
      const { days, range } = lastDays(now(), timezone, period);
      const [stats, daily] = await Promise.all([
        client.stats(range, { signal }),
        client.pageviews(range, { timezone, signal }),
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

function bounceRate(totals: UmamiTotals): number {
  return totals.visits === 0 ? 0 : (Math.min(totals.bounces, totals.visits) / totals.visits) * 100;
}

function averageVisit(totals: UmamiTotals): number {
  return totals.visits === 0 ? 0 : totals.totaltime / totals.visits;
}

function seriesBlock(days: readonly string[], daily: UmamiDailyCounts): PluginBlock {
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
        { name: 'Visitors', values: perDay(daily.visitors) },
      ],
    },
  };
}
