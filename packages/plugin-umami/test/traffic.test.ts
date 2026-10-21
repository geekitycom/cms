import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PluginBlock, PluginWidgetContext } from '@geekity/cms/plugin';

import { umamiClient } from '../src/client.ts';
import type { UmamiSettings } from '../src/settings.ts';
import { midnightIn } from '../src/period.ts';
import { trafficWidget } from '../src/traffic.ts';
import { defaultData, fakeUmami, WEBSITE } from './fake-umami.ts';
import type { FakeUmami } from './fake-umami.ts';

const TEN_AM_20_OCTOBER_IN_CHICAGO = new Date('2026-10-20T15:00:00.000Z');

let fake: FakeUmami;

before(async () => {
  fake = await fakeUmami();
});
after(() => fake.close());
beforeEach(() => {
  fake.received.length = 0;
  fake.data = defaultData();
  fake.delayMs = 0;
});

function settings(overrides: Partial<UmamiSettings> = {}): UmamiSettings {
  return {
    umami_url: 'https://cloud.umami.is',
    website_id: WEBSITE.id,
    domains: '',
    do_not_track: false,
    exclude_search: false,
    exclude_hash: false,
    count_signed_in: false,
    api_mode: 'cloud',
    api_url: fake.cloudBase,
    api_key: fake.apiKey,
    username: '',
    password: undefined,
    ...overrides,
  };
}

function widget(overrides: Partial<UmamiSettings> = {}) {
  const client = umamiClient({
    fetch: (url, init) =>
      fetch(url, { headers: init.headers ?? {}, ...(init.signal ? { signal: init.signal } : {}) }),
    settings: () => Promise.resolve(settings(overrides)),
  });
  return trafficWidget(client, () => TEN_AM_20_OCTOBER_IN_CHICAGO);
}

const CHICAGO = {
  site: {} as PluginWidgetContext['site'],
  timezone: 'America/Chicago',
  period: 7,
} satisfies PluginWidgetContext;

type Stats = Extract<PluginBlock, { stats: unknown }>['stats'];
type Series = Extract<PluginBlock, { timeSeries: unknown }>['timeSeries'];

async function load(context: PluginWidgetContext = CHICAGO) {
  const blocks = await widget().load(context);
  const stats = blocks.find((block) => 'stats' in block) as { stats: Stats } | undefined;
  const series = blocks.find((block) => 'timeSeries' in block) as
    { timeSeries: Series } | undefined;
  return { blocks, stats: stats?.stats, series: series?.timeSeries };
}

function queryOf(path: string): URLSearchParams {
  const [received] = fake.requestsTo(path);
  return new URL(received?.path ?? '/', 'http://fake').searchParams;
}

const STATS_PATH = `/websites/${WEBSITE.id}/stats`;
const PAGEVIEWS_PATH = `/websites/${WEBSITE.id}/pageviews`;

describe('the views and visitors widget', () => {
  it('stops its requests when the dashboard’s signal aborts', async () => {
    fake.delayMs = 1000;
    const started = Date.now();
    await assert.rejects(
      async () => widget().load({ ...CHICAGO, signal: AbortSignal.timeout(50) }),
      /stopped before it finished/,
    );
    assert.ok(Date.now() - started < 800, 'the load gave up at the signal');
  });

  it('is a full-width card that refreshes every five minutes', () => {
    const traffic = widget();
    assert.equal(traffic.id, 'traffic');
    assert.equal(traffic.title, 'Umami: views and visitors');
    assert.equal(traffic.width, 'full');
    assert.equal(traffic.refreshSeconds, 300);
  });

  it('draws views and visitors for each of the last 7 days in the site time zone, as two series (AC #1)', async () => {
    const { series } = await load();
    assert.deepEqual(series?.days, [
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
    ]);
    assert.deepEqual(
      series?.series.map((entry) => entry.name),
      ['Views', 'Visitors'],
    );
    assert.deepEqual(series?.series[0]?.values, [10, 20, 0, 0, 0, 0, 0]);
    assert.deepEqual(series?.series[1]?.values, [4, 6, 0, 0, 0, 0, 0]);
  });

  it('asks Umami for days in the site time zone, from its midnight on the first day to the end of today', async () => {
    await load();
    const query = queryOf(PAGEVIEWS_PATH);
    assert.equal(query.get('timezone'), 'America/Chicago');
    assert.equal(query.get('unit'), 'day');
    assert.equal(new Date(Number(query.get('startAt'))).toISOString(), '2026-10-14T05:00:00.000Z');
    assert.equal(new Date(Number(query.get('endAt'))).toISOString(), '2026-10-21T04:59:59.999Z');
    assert.deepEqual(
      [queryOf(STATS_PATH).get('startAt'), queryOf(STATS_PATH).get('endAt')],
      [query.get('startAt'), query.get('endAt')],
    );
  });

  it('counts a day Umami left out as zero and ignores a day outside the period', async () => {
    fake.data.pageviews = {
      pageviews: [
        { x: '2026-10-01 00:00:00', y: 99 },
        { x: '2026-10-20 00:00:00', y: 7 },
      ],
      sessions: [],
    };
    const { series } = await load();
    assert.deepEqual(series?.series[0]?.values, [0, 0, 0, 0, 0, 0, 7]);
    assert.deepEqual(series?.series[1]?.values, [0, 0, 0, 0, 0, 0, 0]);
  });

  it('shows visitors, views, bounce rate and average visit time against the 7 days before (AC #2)', async () => {
    const { stats } = await load();
    assert.deepEqual(stats, [
      { label: 'Visitors', value: 40, previous: 32 },
      { label: 'Views', value: 120, previous: 100 },
      { label: 'Bounce rate', value: 40, previous: 45, format: 'percent', better: 'down' },
      { label: 'Average visit time', value: 120, previous: 100, format: 'duration' },
    ]);
  });

  it('shows the stats without a change when Umami sends no comparison', async () => {
    fake.data.stats = { pageviews: 3, visitors: 1, visits: 0, bounces: 0, totaltime: 0 };
    const { stats } = await load();
    assert.deepEqual(stats, [
      { label: 'Visitors', value: 1 },
      { label: 'Views', value: 3 },
      { label: 'Bounce rate', value: 0, format: 'percent', better: 'down' },
      { label: 'Average visit time', value: 0, format: 'duration' },
    ]);
  });

  it('covers 30 days, against the 30 before, when the dashboard shows 30', async () => {
    const { series } = await load({ ...CHICAGO, period: 30 });
    assert.equal(series?.days.length, 30);
    assert.equal(series?.days[0], '2026-09-21');
    assert.equal(series?.days.at(-1), '2026-10-20');
    assert.equal(
      new Date(Number(queryOf(STATS_PATH).get('startAt'))).toISOString(),
      '2026-09-21T05:00:00.000Z',
    );
  });

  it('follows the site time zone where the day has already turned', async () => {
    const { series } = await load({ ...CHICAGO, timezone: 'Pacific/Auckland' });
    assert.equal(series?.days.at(-1), '2026-10-21');
    assert.equal(queryOf(PAGEVIEWS_PATH).get('timezone'), 'Pacific/Auckland');
  });

  it('draws no card and asks Umami nothing while the settings are incomplete (AC #4)', async () => {
    const blocks = await widget({ api_key: undefined }).load(CHICAGO);
    assert.deepEqual(blocks, []);
    assert.equal(fake.received.length, 0);
  });

  it('throws when Umami fails, so the dashboard marks the card', async () => {
    fake.data.stats = 'not stats';
    await assert.rejects(async () => widget().load(CHICAGO), { name: 'UmamiError' });
  });
});

describe('midnight in a time zone', () => {
  it('follows the change of clocks', () => {
    assert.equal(
      midnightIn('2026-11-01', 'America/Chicago').toISOString(),
      '2026-11-01T05:00:00.000Z',
    );
    assert.equal(
      midnightIn('2026-11-02', 'America/Chicago').toISOString(),
      '2026-11-02T06:00:00.000Z',
    );
    assert.equal(
      midnightIn('2026-03-29', 'Europe/London').toISOString(),
      '2026-03-29T00:00:00.000Z',
    );
    assert.equal(
      midnightIn('2026-03-30', 'Europe/London').toISOString(),
      '2026-03-29T23:00:00.000Z',
    );
    assert.equal(midnightIn('2026-10-20', 'UTC').toISOString(), '2026-10-20T00:00:00.000Z');
  });
});
