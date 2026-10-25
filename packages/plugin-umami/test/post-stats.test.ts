import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PluginToolContext, PostAtPath } from '@geekity/cms/plugin';

import umami from '../src/index.ts';
import { umamiClient } from '../src/client.ts';
import { dayIn, midnightIn } from '../src/period.ts';
import { postStatsTool } from '../src/post-stats.ts';
import type { UmamiSettings } from '../src/settings.ts';
import { defaultData, fakeUmami, WEBSITE } from './fake-umami.ts';
import type { FakeUmami } from './fake-umami.ts';
import { closeSites, signIn, umamiSite } from './site.ts';

const TEN_AM_20_OCTOBER_IN_CHICAGO = new Date('2026-10-20T15:00:00.000Z');

let fake: FakeUmami;

before(async () => {
  fake = await fakeUmami();
});
after(async () => {
  await closeSites();
  await fake.close();
});
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

const HELLO: PostAtPath = {
  path: '/2026/10/hello/',
  permalink: '/2026/10/hello/',
  title: 'Hello',
  editUrl: '/admin/posts/hello',
};

function tool(overrides: Partial<UmamiSettings> = {}) {
  const client = umamiClient({
    fetch: (url, init) =>
      fetch(url, { headers: init.headers ?? {}, ...(init.signal ? { signal: init.signal } : {}) }),
    settings: () => Promise.resolve(settings(overrides)),
  });
  return postStatsTool(
    client,
    (paths) => Promise.resolve(paths.includes(HELLO.path) ? [HELLO] : []),
    () => TEN_AM_20_OCTOBER_IN_CHICAGO,
  );
}

const CONTEXT: PluginToolContext = {
  user: { username: 'ada' },
  client: 'https://claude.example/client.json',
  clientName: 'Claude Code',
  signal: new AbortController().signal,
  site: {} as PluginToolContext['site'],
  timezone: 'America/Chicago',
};

function queryOf(path: string): URLSearchParams {
  const [received] = fake.requestsTo(path);
  return new URL(received?.path ?? '/', 'http://fake').searchParams;
}

describe('the post stats MCP tool', () => {
  it('reads Umami and says so in its annotations, changing nothing', () => {
    const declared = tool();
    assert.equal(declared.id, 'post-stats');
    assert.equal(declared.scope, 'inspect');
    assert.deepEqual(declared.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('answers a post’s views, visitors and referrers over the days asked, beside the period before', async () => {
    fake.data.pathViews = { '/2026/10/hello/': 30 };
    fake.data.metrics = {
      referrer: [
        { x: 'news.ycombinator.com', y: 12 },
        { x: '', y: 3 },
      ],
    };
    const outcome = await tool().run({ path: '/2026/10/hello/', days: 7 }, CONTEXT);
    assert.deepEqual(outcome, {
      ok: true,
      summary:
        'Hello (/2026/10/hello/) had 30 views from 30 visitors from 2026-10-14 to 2026-10-20.',
      structured: {
        path: '/2026/10/hello/',
        title: 'Hello',
        from: '2026-10-14',
        to: '2026-10-20',
        views: 30,
        visitors: 30,
        visits: 30,
        previous: { views: 15, visitors: 15, visits: 15 },
        referrers: [
          { referrer: 'news.ycombinator.com', visitors: 12 },
          { referrer: '(direct)', visitors: 3 },
        ],
      },
    });

    const stats = queryOf(`/websites/${WEBSITE.id}/stats`);
    const referrers = queryOf(`/websites/${WEBSITE.id}/metrics`);
    const start = String(midnightIn('2026-10-14', 'America/Chicago').getTime());
    for (const query of [stats, referrers]) {
      assert.equal(query.get('path'), 'eq./2026/10/hello/');
      assert.equal(query.get('startAt'), start);
    }
    assert.equal(referrers.get('type'), 'referrer');
  });

  it('reads 30 days when none are asked, and takes the path of a full URL', async () => {
    const outcome = await tool().run({ path: 'https://example.com/2026/10/hello/?ref=x' }, CONTEXT);
    assert.ok(outcome.ok);
    assert.equal(outcome.structured.from, '2026-09-21');
    assert.equal(outcome.structured.path, '/2026/10/hello/');
  });

  it('names no title for a path that is not a post', async () => {
    const outcome = await tool().run({ path: '/about/' }, CONTEXT);
    assert.ok(outcome.ok);
    assert.equal(outcome.structured.title, undefined);
    assert.match(outcome.summary, /^\/about\/ had 0 views/);
  });

  it('refuses a path that is not one, without asking Umami', async () => {
    const outcome = await tool().run({ path: 'hello' }, CONTEXT);
    assert.deepEqual(outcome, {
      ok: false,
      message: 'path must be a path on the site, such as /2026/10/hello/, or a URL.',
    });
    assert.equal(fake.received.length, 0);
  });

  it('says what to set when the stats are not set up', async () => {
    const outcome = await tool({ api_key: undefined }).run({ path: '/' }, CONTEXT);
    assert.deepEqual(outcome, {
      ok: false,
      message: 'Set the API key on Plugins > Umami to read the stats.',
    });
  });

  it('passes on what Umami refused', async () => {
    const outcome = await tool({ api_key: 'wrong' }).run({ path: '/' }, CONTEXT);
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? '' : outcome.message, /refused the API key/);
  });
});

describe('the post stats tool on a site', () => {
  it('is offered to an MCP client as geekity_plugin_umami__post_stats and answers from Umami', async () => {
    fake.data.pathViews = { '/2026/10/hello/': 8 };
    const cms = await umamiSite(umami, {
      settings: {
        umami_url: 'https://cloud.umami.is',
        website_id: WEBSITE.id,
        api_mode: 'cloud',
        api_url: fake.cloudBase,
      },
      secrets: { api_key: fake.apiKey },
      timezone: 'America/Chicago',
    });
    const admin = await signIn(cms);
    const created = await admin.post('/admin/users/apps/tokens', {
      name: 'Claude Code',
      resource: 'mcp',
      mcp_scope: 'inspect',
      expires: '30',
    });
    const token = /id="created-token"[^>]*value="([^"]+)"/.exec(await created.text())?.[1];
    assert.ok(token !== undefined, 'the admin shows the new token');

    const response = await cms.app.request('/_geekity/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'geekity_plugin_umami__post_stats',
          arguments: { path: '/2026/10/hello/', days: 7 },
        },
      }),
    });
    const body = (await response.json()) as {
      result?: { isError: boolean; structuredContent?: Record<string, unknown> };
    };
    assert.equal(body.result?.isError, false, JSON.stringify(body));
    assert.equal(body.result?.structuredContent?.['title'], 'Hello');
    assert.equal(body.result?.structuredContent?.['views'], 8);
    assert.equal(body.result?.structuredContent?.['to'], dayIn(new Date(), 'America/Chicago'));
  });
});
