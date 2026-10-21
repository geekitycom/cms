import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PluginBlock, PluginWidgetContext } from '@geekity/cms/plugin';

import { audienceWidget, visitorsNowWidget } from '../src/audience.ts';
import { umamiClient } from '../src/client.ts';
import type { UmamiSettings } from '../src/settings.ts';
import { defaultData, fakeUmami, WEBSITE } from './fake-umami.ts';
import type { FakeUmami } from './fake-umami.ts';

/**
 * The countries, browsers, devices and visitors right now widgets against a
 * fake Umami on loopback, at ten in the morning on 20 October in Chicago.
 */

const TEN_AM_20_OCTOBER_IN_CHICAGO = new Date('2026-10-20T15:00:00.000Z');

let fake: FakeUmami;

before(async () => {
  fake = await fakeUmami();
});
after(() => fake.close());
beforeEach(() => {
  fake.received.length = 0;
  fake.data = defaultData();
});

function clientWith(overrides: Partial<UmamiSettings> = {}) {
  const settings: UmamiSettings = {
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
  return umamiClient({
    fetch: (url, init) =>
      fetch(url, { headers: init.headers ?? {}, ...(init.signal ? { signal: init.signal } : {}) }),
    settings: () => Promise.resolve(settings),
  });
}

function audience(type: 'country' | 'browser' | 'device', overrides: Partial<UmamiSettings> = {}) {
  return audienceWidget(clientWith(overrides), type, () => TEN_AM_20_OCTOBER_IN_CHICAGO);
}

const CHICAGO = {
  site: { baseUrl: 'https://example.com/' } as PluginWidgetContext['site'],
  timezone: 'America/Chicago',
  period: 7,
} satisfies PluginWidgetContext;

type Ranked = Extract<PluginBlock, { ranked: unknown }>['ranked'];

function rankedOf(blocks: readonly PluginBlock[]): Ranked {
  const [block] = blocks;
  assert.ok(block !== undefined && 'ranked' in block, 'the widget draws a ranked list');
  return block.ranked;
}

function shares(ranked: Ranked): [string, number][] {
  return ranked.items.map((item) => [item.label, Math.round(item.value * 10) / 10]);
}

function queryOf(path: string): URLSearchParams {
  const [received] = fake.requestsTo(path);
  return new URL(received?.path ?? '/', 'http://fake').searchParams;
}

const METRICS_PATH = `/websites/${WEBSITE.id}/metrics`;

describe('the countries, browsers and devices widgets', () => {
  it('are half-width cards that refresh every five minutes', () => {
    assert.deepEqual(
      (['country', 'browser', 'device'] as const).map((type) => {
        const { id, title, width, refreshSeconds } = audience(type);
        return { id, title, width, refreshSeconds };
      }),
      [
        { id: 'countries', title: 'Umami: countries', width: 'half', refreshSeconds: 300 },
        { id: 'browsers', title: 'Umami: browsers', width: 'half', refreshSeconds: 300 },
        { id: 'devices', title: 'Umami: devices', width: 'half', refreshSeconds: 300 },
      ],
    );
  });

  it('lists the five countries with the most visitors by name, as a share of all visitors (AC #1)', async () => {
    fake.data.metrics['country'] = [
      { x: 'US', y: 20 },
      { x: 'DE', y: 8 },
      { x: 'GB', y: 5 },
      { x: 'FR', y: 3 },
      { x: 'JP', y: 2 },
    ];
    const ranked = rankedOf(await audience('country').load(CHICAGO));
    assert.equal(ranked.caption, 'Share of visitors per country over the last 7 days');
    assert.equal(ranked.format, 'percent');
    assert.deepEqual(shares(ranked), [
      ['United States', 50],
      ['Germany', 20],
      ['United Kingdom', 12.5],
      ['France', 7.5],
      ['Japan', 5],
    ]);
    assert.equal(queryOf(METRICS_PATH).get('type'), 'country');
    assert.equal(queryOf(METRICS_PATH).get('limit'), '5');
  });

  it('keeps a country code it has no name for, and says Unknown for a visitor with none', async () => {
    fake.data.metrics['country'] = [
      { x: null, y: 4 },
      { x: 'XX', y: 2 },
      { x: '(unknown)', y: 1 },
    ];
    assert.deepEqual(shares(rankedOf(await audience('country').load(CHICAGO))), [
      ['Unknown', 10],
      ['XX', 5],
      ['(unknown)', 2.5],
    ]);
  });

  it('names browsers and devices as Umami does, and keeps one it does not know (AC #1)', async () => {
    fake.data.metrics['browser'] = [
      { x: 'chrome', y: 16 },
      { x: 'ios', y: 10 },
      { x: 'edge-chromium', y: 6 },
      { x: 'crios', y: 4 },
      { x: 'netsurf', y: 2 },
    ];
    fake.data.metrics['device'] = [
      { x: 'desktop', y: 24 },
      { x: 'mobile', y: 12 },
      { x: 'tablet', y: 2 },
      { x: '', y: 2 },
    ];
    assert.deepEqual(shares(rankedOf(await audience('browser').load(CHICAGO))), [
      ['Chrome', 40],
      ['iOS', 25],
      ['Edge (Chromium)', 15],
      ['Chrome (iOS)', 10],
      ['netsurf', 5],
    ]);
    const devices = rankedOf(await audience('device').load(CHICAGO));
    assert.equal(devices.caption, 'Share of visitors per device over the last 7 days');
    assert.deepEqual(shares(devices), [
      ['Desktop', 60],
      ['Mobile', 30],
      ['Tablet', 5],
      ['Unknown', 5],
    ]);
  });

  it('covers the 30 days the dashboard shows when it shows 30', async () => {
    const ranked = rankedOf(await audience('browser').load({ ...CHICAGO, period: 30 }));
    assert.equal(ranked.caption, 'Share of visitors per browser over the last 30 days');
    assert.equal(
      new Date(Number(queryOf(METRICS_PATH).get('startAt'))).toISOString(),
      '2026-09-21T05:00:00.000Z',
    );
    assert.equal(
      new Date(Number(queryOf(`/websites/${WEBSITE.id}/stats`).get('startAt'))).toISOString(),
      '2026-09-21T05:00:00.000Z',
    );
  });

  it('says so when the period has no visitors', async () => {
    fake.data.metrics['country'] = [];
    assert.deepEqual(await audience('country').load(CHICAGO), [
      { paragraph: ['No visitors in this period.'] },
    ]);
  });

  it('draws no card and asks Umami nothing while the settings are incomplete', async () => {
    assert.deepEqual(await audience('device', { api_key: undefined }).load(CHICAGO), []);
    assert.equal(fake.received.length, 0);
  });

  it('throws when Umami fails, so the dashboard marks the card', async () => {
    fake.data.metrics['browser'] = 'not metrics';
    await assert.rejects(async () => audience('browser').load(CHICAGO), { name: 'UmamiError' });
  });
});

describe('the visitors right now widget', () => {
  it('is a half-width card that refreshes every 30 seconds', () => {
    const { id, title, width, refreshSeconds } = visitorsNowWidget(clientWith());
    assert.deepEqual(
      { id, title, width, refreshSeconds },
      { id: 'visitors-now', title: 'Umami: visitors right now', width: 'half', refreshSeconds: 30 },
    );
  });

  it('shows the visitors Umami counts on the site now as a stat (AC #2)', async () => {
    fake.data.active = { visitors: 7 };
    assert.deepEqual(await visitorsNowWidget(clientWith()).load(CHICAGO), [
      { stats: [{ label: 'Visitors right now', value: 7 }] },
      { paragraph: ['Umami counts the visitors seen on the site in the last 5 minutes.'] },
    ]);
    assert.equal(fake.requestsTo(`/websites/${WEBSITE.id}/active`).length, 1);
  });

  it('draws no card and asks Umami nothing while the settings are incomplete', async () => {
    assert.deepEqual(await visitorsNowWidget(clientWith({ api_key: undefined })).load(CHICAGO), []);
    assert.equal(fake.received.length, 0);
  });

  it('throws when Umami fails, so the dashboard marks the card', async () => {
    fake.data.active = 'nobody';
    await assert.rejects(async () => visitorsNowWidget(clientWith()).load(CHICAGO), {
      name: 'UmamiError',
    });
  });
});
