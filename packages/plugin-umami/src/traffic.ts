import type { PluginBlock, PluginWidget } from '@geekity/cms/plugin';

import type { UmamiClient, UmamiDayCount, UmamiRange, UmamiTotals } from './client.ts';

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

const DAY_MS = 86_400_000;

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

/** `YYYY-MM-DD` for the instant in the time zone. */
export function dayIn(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function addDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

function daysEnding(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(today, index - count + 1));
}

/** How far the time zone's wall clock is ahead of UTC at the instant. */
function offsetAt(instant: number, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  const wall = Date.UTC(
    parts['year'] ?? 0,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    parts['hour'] ?? 0,
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant the day starts in the time zone. */
export function midnightIn(day: string, timezone: string): Date {
  const wall = Date.parse(`${day}T00:00:00Z`);
  const guess = wall - offsetAt(wall, timezone);
  return new Date(wall - offsetAt(guess, timezone));
}

/** From the start of the first day to the end of the last, so Umami compares whole days. */
function rangeOf(days: readonly string[], timezone: string): UmamiRange {
  return {
    start: midnightIn(days[0] ?? '', timezone),
    end: new Date(midnightIn(addDays(days.at(-1) ?? '', 1), timezone).getTime() - 1),
  };
}
