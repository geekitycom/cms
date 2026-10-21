import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PluginBlock, PluginWidgetContext, PostAtPath } from '@geekity/cms/plugin';

import { umamiClient } from '../src/client.ts';
import type { UmamiSettings } from '../src/settings.ts';
import { topPagesWidget, topReferrersWidget } from '../src/top.ts';
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

function clientWith(overrides: Partial<UmamiSettings> = {}) {
  return umamiClient({
    fetch: (url, init) =>
      fetch(url, { headers: init.headers ?? {}, ...(init.signal ? { signal: init.signal } : {}) }),
    settings: () => Promise.resolve(settings(overrides)),
  });
}

const HELLO: PostAtPath = {
  path: '/2026/10/hello',
  permalink: '/2026/10/hello/',
  title: 'Hello',
  editUrl: '/admin/posts/hello',
};

function pages(overrides: Partial<UmamiSettings> = {}, posts: readonly PostAtPath[] = []) {
  const asked: (readonly string[])[] = [];
  const widget = topPagesWidget(
    clientWith(overrides),
    (paths) => {
      asked.push(paths);
      return Promise.resolve(posts.filter((post) => paths.includes(post.path)));
    },
    () => TEN_AM_20_OCTOBER_IN_CHICAGO,
  );
  return { widget, asked };
}

function referrers(overrides: Partial<UmamiSettings> = {}) {
  return topReferrersWidget(
    clientWith(overrides),
    () => Promise.resolve(settings(overrides)),
    () => TEN_AM_20_OCTOBER_IN_CHICAGO,
  );
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

function queryOf(path: string): URLSearchParams {
  const [received] = fake.requestsTo(path);
  return new URL(received?.path ?? '/', 'http://fake').searchParams;
}

const EXPANDED_PATH = `/websites/${WEBSITE.id}/metrics/expanded`;
const METRICS_PATH = `/websites/${WEBSITE.id}/metrics`;

function row(name: string, pageviews: number, visitors: number) {
  return { name, pageviews, visitors, visits: visitors, bounces: 0, totaltime: 0 };
}

describe('the top pages widget', () => {
  it('is a half-width card that refreshes every five minutes', () => {
    const { widget } = pages();
    assert.equal(widget.id, 'top-pages');
    assert.equal(widget.title, 'Umami: top pages');
    assert.equal(widget.width, 'half');
    assert.equal(widget.refreshSeconds, 300);
  });

  it('lists the ten most viewed paths with their views, though Umami ranks by visitors (AC #1)', async () => {
    fake.data.expanded['path'] = Array.from({ length: 12 }, (_, index) =>
      row(`/page-${String(index)}/`, index === 11 ? 500 : 100 - index, 50 - index),
    );
    const ranked = rankedOf(await pages().widget.load(CHICAGO));
    assert.equal(ranked.caption, 'Views per page over the last 7 days');
    assert.deepEqual(
      ranked.items.map((item) => [item.label, item.value]),
      [
        ['/page-11/', 500],
        ['/page-0/', 100],
        ['/page-1/', 99],
        ['/page-2/', 98],
        ['/page-3/', 97],
        ['/page-4/', 96],
        ['/page-5/', 95],
        ['/page-6/', 94],
        ['/page-7/', 93],
        ['/page-8/', 92],
      ],
    );
    assert.equal(queryOf(EXPANDED_PATH).get('type'), 'path');
    assert.equal(queryOf(EXPANDED_PATH).get('limit'), '100');
  });

  it('shows the title of a path that leads to a post, linked to its editor (AC #1)', async () => {
    fake.data.expanded['path'] = [row('/', 60, 30), row('/2026/10/hello', 30, 12)];
    const { widget, asked } = pages({}, [HELLO]);
    const ranked = rankedOf(await widget.load(CHICAGO));
    assert.deepEqual(ranked.items, [
      { label: '/', value: 60 },
      { label: 'Hello', value: 30, href: '/admin/posts/hello' },
    ]);
    assert.deepEqual(asked, [['/', '/2026/10/hello']]);
  });

  it('adds up the views of every path that leads to the same post', async () => {
    fake.data.expanded['path'] = [
      row('/', 60, 30),
      row('/2026/10/hello', 30, 12),
      row('/2026/10/hello/?utm_source=mastodon', 40, 20),
    ];
    const tagged = { ...HELLO, path: '/2026/10/hello/?utm_source=mastodon' };
    const ranked = rankedOf(await pages({}, [HELLO, tagged]).widget.load(CHICAGO));
    assert.deepEqual(ranked.items, [
      { label: 'Hello', value: 70, href: '/admin/posts/hello' },
      { label: '/', value: 60 },
    ]);
  });

  it('covers the 30 days the dashboard shows when it shows 30', async () => {
    const ranked = rankedOf(await pages().widget.load({ ...CHICAGO, period: 30 }));
    assert.equal(ranked.caption, 'Views per page over the last 30 days');
    assert.equal(
      new Date(Number(queryOf(EXPANDED_PATH).get('startAt'))).toISOString(),
      '2026-09-21T05:00:00.000Z',
    );
    assert.equal(
      new Date(Number(queryOf(EXPANDED_PATH).get('endAt'))).toISOString(),
      '2026-10-21T04:59:59.999Z',
    );
  });

  it('says so when the period has no page views (AC #3)', async () => {
    fake.data.expanded['path'] = [];
    const { widget, asked } = pages();
    assert.deepEqual(await widget.load(CHICAGO), [
      { paragraph: ['No page views in this period.'] },
    ]);
    assert.deepEqual(asked, []);
  });

  it('draws no card and asks Umami nothing while the settings are incomplete', async () => {
    assert.deepEqual(await pages({ api_key: undefined }).widget.load(CHICAGO), []);
    assert.equal(fake.received.length, 0);
  });

  it('throws when Umami fails, so the dashboard marks the card', async () => {
    fake.data.expanded['path'] = 'not metrics';
    await assert.rejects(async () => pages().widget.load(CHICAGO), { name: 'UmamiError' });
  });
});

describe('the top referrers widget', () => {
  it('is a half-width card that refreshes every five minutes', () => {
    const widget = referrers();
    assert.equal(widget.id, 'top-referrers');
    assert.equal(widget.title, 'Umami: top referrers');
    assert.equal(widget.width, 'half');
    assert.equal(widget.refreshSeconds, 300);
  });

  it('lists the ten biggest referring domains with their visitors (AC #2)', async () => {
    fake.data.metrics['referrer'] = Array.from({ length: 12 }, (_, index) => ({
      x: `site-${String(index)}.example`,
      y: 40 - index,
    }));
    const ranked = rankedOf(await referrers().load(CHICAGO));
    assert.equal(ranked.caption, 'Visitors per referring domain over the last 7 days');
    assert.deepEqual(
      ranked.items.map((item) => [item.label, item.value]),
      Array.from({ length: 10 }, (_, index) => [`site-${String(index)}.example`, 40 - index]),
    );
    assert.equal(queryOf(METRICS_PATH).get('type'), 'referrer');
  });

  it('leaves out the site URL host, the configured domains and their www. forms (AC #2)', async () => {
    fake.data.metrics['referrer'] = [
      { x: 'example.com', y: 90 },
      { x: 'www.example.com', y: 80 },
      { x: 'shll.me', y: 70 },
      { x: 'WWW.Shll.Me', y: 65 },
      { x: 'news.ycombinator.com', y: 12 },
      { x: '', y: 9 },
      { x: null, y: 8 },
      { x: 'mastodon.social', y: 5 },
    ];
    const ranked = rankedOf(await referrers({ domains: 'www.shll.me, ' }).load(CHICAGO));
    assert.deepEqual(ranked.items, [
      { label: 'news.ycombinator.com', value: 12 },
      { label: 'mastodon.social', value: 5 },
    ]);
  });

  it('says so when no visitor came from another site in the period (AC #3)', async () => {
    fake.data.metrics['referrer'] = [{ x: 'www.example.com', y: 3 }];
    assert.deepEqual(await referrers().load(CHICAGO), [
      { paragraph: ['No visitors came from another site in this period.'] },
    ]);
  });

  it('covers the 30 days the dashboard shows when it shows 30', async () => {
    const ranked = rankedOf(await referrers().load({ ...CHICAGO, period: 30 }));
    assert.equal(ranked.caption, 'Visitors per referring domain over the last 30 days');
    assert.equal(
      new Date(Number(queryOf(METRICS_PATH).get('startAt'))).toISOString(),
      '2026-09-21T05:00:00.000Z',
    );
  });

  it('draws no card and asks Umami nothing while the settings are incomplete', async () => {
    assert.deepEqual(await referrers({ website_id: '' }).load(CHICAGO), []);
    assert.equal(fake.received.length, 0);
  });
});
