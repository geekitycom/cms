import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type {
  PluginBlock,
  PluginWidgetContext,
  PostAtPath,
  PostEngagement,
  PublishedPost,
} from '@geekity/cms/plugin';

import { umamiClient } from '../src/client.ts';
import { recentPostsWidget } from '../src/recent.ts';
import type { RecentPostSources } from '../src/recent.ts';
import type { UmamiSettings } from '../src/settings.ts';
import { defaultData, fakeUmami, WEBSITE } from './fake-umami.ts';
import type { FakeUmami } from './fake-umami.ts';

/**
 * The recent posts widget against a fake Umami on loopback, at ten in the
 * morning on 20 October in Chicago.
 */

const TEN_AM_20_OCTOBER_IN_CHICAGO = new Date('2026-10-20T15:00:00.000Z');
const DAY_MS = 86_400_000;

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

function post(slug: string, published: string): PublishedPost {
  return {
    permalink: `/2026/10/${slug}/`,
    title: slug[0]?.toUpperCase() + slug.slice(1),
    editUrl: `/admin/posts/${slug}`,
    published,
  };
}

const ALPHA = post('alpha', '2026-10-01T14:00:00.000Z');
const DELTA = post('delta', '2026-10-05T14:00:00.000Z');
const CHARLIE = post('charlie', '2026-10-10T14:00:00.000Z');
const BRAVO = post('bravo', '2026-10-18T14:00:00.000Z');
const POSTS = [BRAVO, CHARLIE, DELTA, ALPHA];

function engaged(of: PublishedPost, total: number): PostEngagement {
  return {
    slug: of.editUrl.split('/').at(-1) ?? '',
    title: of.title,
    path: of.permalink,
    editUrl: of.editUrl,
    likes: total,
    boosts: 0,
    replies: 0,
    webmentions: 0,
    comments: 0,
    total,
  };
}

function row(name: string, pageviews: number) {
  return { name, pageviews, visitors: pageviews, visits: pageviews, bounces: 0, totaltime: 0 };
}

interface Asked {
  publishedSince: string[];
  engagementSince: string[];
}

function sources(
  posts: readonly PublishedPost[] = POSTS,
  engagement: readonly PostEngagement[] = [
    engaged(BRAVO, 5),
    engaged(CHARLIE, 2),
    engaged(ALPHA, 1),
  ],
  baseDirectory = '',
): { sources: RecentPostSources; asked: Asked } {
  const asked: Asked = { publishedSince: [], engagementSince: [] };
  return {
    asked,
    sources: {
      publishedSince(since) {
        asked.publishedSince.push(since);
        return Promise.resolve(posts.filter((entry) => entry.published >= since));
      },
      postsAt(paths) {
        const found: PostAtPath[] = [];
        for (const asking of paths) {
          const relative = asking.slice(baseDirectory.length);
          const match = posts.find(
            (entry) => entry.permalink === relative || entry.permalink === `${relative}/`,
          );
          if (match !== undefined) found.push({ path: asking, ...match });
        }
        return Promise.resolve(found);
      },
      engagement(since) {
        asked.engagementSince.push(since);
        return Promise.resolve(engagement);
      },
    },
  };
}

const CHICAGO = {
  site: { baseUrl: 'https://example.com/' } as PluginWidgetContext['site'],
  timezone: 'America/Chicago',
  period: 7,
} satisfies PluginWidgetContext;

type Table = Extract<PluginBlock, { table: unknown }>['table'];

/** The tables, each after a paragraph that names its order. */
function tablesOf(blocks: readonly PluginBlock[]): Table[] {
  assert.deepEqual(
    blocks.filter((block) => 'paragraph' in block),
    [{ paragraph: ['Most read'] }, { paragraph: ['Most engaged'] }],
  );
  return blocks.flatMap((block) => ('table' in block ? [block.table] : []));
}

const NO_DATA = 'no data';

function textOf(cell: unknown): string {
  return typeof cell === 'string' ? cell : (cell as { text: string }).text;
}

function rowsOf(table: Table | undefined): string[][] {
  return (table?.rows ?? []).map((cells) => cells.map(textOf));
}

const STATS_PATH = `/websites/${WEBSITE.id}/stats`;

function statsAsked(): { path: string | null; startAt: string | null; endAt: string | null }[] {
  return fake.requestsTo(STATS_PATH).map((received) => {
    const query = new URL(received.path, 'http://fake').searchParams;
    return { path: query.get('path'), startAt: query.get('startAt'), endAt: query.get('endAt') };
  });
}

function seed() {
  fake.data.expanded['path'] = [
    row('/', 90),
    row('/2026/10/alpha/', 40),
    row('/2026/10/bravo/', 20),
    row('/2026/10/alpha', 10),
    row('/2026/10/delta/', 3),
  ];
  fake.data.pathViews = { '/2026/10/alpha/': 35, '/2026/10/bravo/': 20 };
}

describe('the recent posts widget', () => {
  it('is a full-width card that refreshes every half hour', () => {
    const widget = recentPostsWidget(clientWith(), sources().sources);
    assert.equal(widget.id, 'recent-posts');
    assert.equal(widget.title, 'Umami: recent posts');
    assert.equal(widget.width, 'full');
    assert.equal(widget.refreshSeconds, 1800);
  });

  it('lists the posts of the last 30 days with views and engagement side by side, in both orders (AC #1)', async () => {
    seed();
    const { sources: from, asked } = sources();
    const widget = recentPostsWidget(clientWith(), from, () => TEN_AM_20_OCTOBER_IN_CHICAGO);
    const [read, engagedMost] = tablesOf(await widget.load(CHICAGO));

    assert.equal(read?.caption, 'Posts published in the last 30 days, most read first');
    assert.deepEqual(read?.columns, ['Post', 'Views', 'Engaged', 'Week 1']);
    assert.deepEqual(
      rowsOf(read).map(([title, views, engagement]) => [title, views, engagement]),
      [
        ['Alpha', '50', '1'],
        ['Bravo', '20', '5'],
        ['Delta', '3', '0'],
        ['Charlie', NO_DATA, '2'],
      ],
    );
    assert.deepEqual(read?.rows[0]?.[0], { text: 'Alpha', href: '/admin/posts/alpha' });

    assert.equal(engagedMost?.caption, 'Posts published in the last 30 days, most engaged first');
    assert.deepEqual(
      rowsOf(engagedMost).map(([title]) => title),
      ['Bravo', 'Charlie', 'Alpha', 'Delta'],
    );

    const since = '2026-09-21T05:00:00.000Z';
    assert.deepEqual(asked.publishedSince, [since]);
    assert.deepEqual(asked.engagementSince, [since]);
    const [expanded] = fake.requestsTo(`/websites/${WEBSITE.id}/metrics/expanded`);
    const query = new URL(expanded?.path ?? '/', 'http://fake').searchParams;
    assert.equal(query.get('startAt'), String(Date.parse(since)));
  });

  it('shows ten posts in each order', async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      post(`post${String(index)}`, `2026-10-${String(index + 1).padStart(2, '0')}T14:00:00.000Z`),
    );
    const widget = recentPostsWidget(
      clientWith(),
      sources(many, []).sources,
      () => TEN_AM_20_OCTOBER_IN_CHICAGO,
    );
    const tables = tablesOf(await widget.load(CHICAGO));
    assert.deepEqual(
      tables.map((table) => table.rows.length),
      [10, 10],
    );
  });

  it('shows each post views over its first 7 days, so far for one not a week old (AC #2)', async () => {
    seed();
    const widget = recentPostsWidget(
      clientWith(),
      sources().sources,
      () => TEN_AM_20_OCTOBER_IN_CHICAGO,
    );
    const [read] = tablesOf(await widget.load(CHICAGO));
    assert.deepEqual(
      rowsOf(read).map(([title, , , first]) => [title, first]),
      [
        ['Alpha', '35'],
        ['Bravo', '20 so far'],
        ['Delta', '0'],
        ['Charlie', NO_DATA],
      ],
    );
    const alpha = statsAsked().find((asked) => asked.path === 'eq./2026/10/alpha/');
    assert.deepEqual(alpha, {
      path: 'eq./2026/10/alpha/',
      startAt: String(Date.parse(ALPHA.published)),
      endAt: String(Date.parse(ALPHA.published) + 7 * DAY_MS),
    });
    const bravo = statsAsked().find((asked) => asked.path === 'eq./2026/10/bravo/');
    assert.equal(bravo?.endAt, String(TEN_AM_20_OCTOBER_IN_CHICAGO.getTime()));
  });

  it('asks Umami again only for the first weeks not yet over', async () => {
    seed();
    const widget = recentPostsWidget(
      clientWith(),
      sources().sources,
      () => TEN_AM_20_OCTOBER_IN_CHICAGO,
    );
    await widget.load(CHICAGO);
    fake.received.length = 0;
    await widget.load(CHICAGO);
    assert.deepEqual(
      statsAsked().map((asked) => asked.path),
      ['eq./2026/10/bravo/'],
    );
  });

  it('asks for the path on a site served from a directory', async () => {
    fake.data.expanded['path'] = [row('/blog/2026/10/alpha/', 4)];
    const widget = recentPostsWidget(
      clientWith(),
      sources([ALPHA], [], '/blog').sources,
      () => TEN_AM_20_OCTOBER_IN_CHICAGO,
    );
    const [read] = tablesOf(
      await widget.load({
        ...CHICAGO,
        site: { baseUrl: 'https://example.com/blog/' } as PluginWidgetContext['site'],
      }),
    );
    assert.deepEqual(rowsOf(read)[0]?.slice(0, 2), ['Alpha', '4']);
    assert.deepEqual(
      statsAsked().map((asked) => asked.path),
      ['eq./blog/2026/10/alpha/'],
    );
  });

  it('shows no data, not zero, and asks nothing more, for a post Umami recorded no view of (AC #3)', async () => {
    fake.data.expanded['path'] = [row('/', 90), row('/2026/10/charlie/', 0)];
    const widget = recentPostsWidget(
      clientWith(),
      sources([CHARLIE], [engaged(CHARLIE, 2)]).sources,
      () => TEN_AM_20_OCTOBER_IN_CHICAGO,
    );
    const [read] = tablesOf(await widget.load(CHICAGO));
    assert.deepEqual(rowsOf(read), [['Charlie', NO_DATA, '2', NO_DATA]]);
    assert.equal(statsAsked().length, 0);
  });

  it('says so when no post was published in the last 30 days', async () => {
    const widget = recentPostsWidget(
      clientWith(),
      sources([], []).sources,
      () => TEN_AM_20_OCTOBER_IN_CHICAGO,
    );
    assert.deepEqual(await widget.load(CHICAGO), [
      { paragraph: ['No posts were published in the last 30 days.'] },
    ]);
  });

  it('draws no card and asks Umami nothing while the settings are incomplete', async () => {
    const widget = recentPostsWidget(
      clientWith({ api_key: undefined }),
      sources().sources,
      () => TEN_AM_20_OCTOBER_IN_CHICAGO,
    );
    assert.deepEqual(await widget.load(CHICAGO), []);
    assert.equal(fake.received.length, 0);
  });
});
