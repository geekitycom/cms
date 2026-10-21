import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PluginFetchInit } from '@geekity/cms/plugin';

import { umamiClient, UmamiError } from '../src/client.ts';
import type { UmamiClient, UmamiFailure } from '../src/client.ts';
import type { UmamiSettings } from '../src/settings.ts';
import { defaultData, fakeUmami, WEBSITE } from './fake-umami.ts';
import type { FakeUmami } from './fake-umami.ts';

/**
 * The Umami API client against a fake Umami on loopback, in both modes. The
 * site's own `host.fetch` is exercised by the screen tests; here a plain
 * `fetch` stands in for it.
 */

let fake: FakeUmami;

before(async () => {
  fake = await fakeUmami();
});
after(() => fake.close());
beforeEach(() => {
  fake.received.length = 0;
  fake.logins = 0;
  fake.delayMs = 0;
  fake.twoFactor = false;
  fake.data = defaultData();
  fake.expireTokens();
  fake.refuseAllTokens(false);
});

function plainFetch(url: string, init: PluginFetchInit = {}): Promise<Response> {
  return fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      ...init.headers,
      ...(init.json === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });
}

const BLANK: UmamiSettings = {
  umami_url: '',
  website_id: '',
  domains: '',
  do_not_track: false,
  exclude_search: false,
  exclude_hash: false,
  count_signed_in: false,
  api_mode: 'cloud',
  api_url: '',
  api_key: undefined,
  username: '',
  password: undefined,
};

function cloud(overrides: Partial<UmamiSettings> = {}): UmamiSettings {
  return {
    ...BLANK,
    umami_url: 'https://cloud.umami.is',
    website_id: WEBSITE.id,
    api_mode: 'cloud',
    api_url: fake.cloudBase,
    api_key: fake.apiKey,
    ...overrides,
  };
}

function selfHosted(overrides: Partial<UmamiSettings> = {}): UmamiSettings {
  return {
    ...BLANK,
    umami_url: fake.origin,
    website_id: WEBSITE.id,
    api_mode: 'self-hosted',
    username: fake.username,
    password: fake.password,
    ...overrides,
  };
}

function client(settings: UmamiSettings, timeoutMs?: number): UmamiClient {
  return umamiClient({ fetch: plainFetch, settings: () => Promise.resolve(settings), timeoutMs });
}

async function failureOf(call: Promise<unknown>): Promise<UmamiFailure> {
  try {
    await call;
  } catch (error) {
    assert.ok(error instanceof UmamiError, `expected an UmamiError, got ${String(error)}`);
    return error.failure;
  }
  assert.fail('the call succeeded');
}

const WEEK = {
  start: new Date('2026-10-14T05:00:00Z'),
  end: new Date('2026-10-21T04:59:59.999Z'),
};

describe('the Umami client on Umami Cloud', () => {
  it('sends the API key and reads the stats with the previous period', async () => {
    const stats = await client(cloud()).stats(WEEK);

    assert.deepEqual(stats, {
      current: { pageviews: 120, visitors: 40, visits: 50, bounces: 20, totaltime: 6000 },
      previous: { pageviews: 100, visitors: 32, visits: 40, bounces: 18, totaltime: 4000 },
    });
    const [sent] = fake.requestsTo(`/websites/${WEBSITE.id}/stats`);
    assert.equal(sent?.headers.authorization, `Bearer ${fake.apiKey}`);
    assert.equal(sent?.headers['x-umami-api-key'], fake.apiKey);
    const query = new URL(sent?.path ?? '', 'http://x').searchParams;
    assert.equal(query.get('startAt'), String(WEEK.start.getTime()));
    assert.equal(query.get('endAt'), String(WEEK.end.getTime()));
    assert.equal(fake.logins, 0);
    assert.equal(fake.requestsTo('/auth/login').length, 0);
  });

  it('goes to api.umami.is unless an API URL is set', async () => {
    const seen: string[] = [];
    const recording = umamiClient({
      fetch: (url) => {
        seen.push(url);
        return Promise.resolve(Response.json({ id: WEBSITE.id, name: 'x', domain: 'y' }));
      },
      settings: () => Promise.resolve(cloud({ api_url: '' })),
    });
    await recording.website();
    assert.deepEqual(seen, [`https://api.umami.is/v1/websites/${WEBSITE.id}`]);
  });

  it('reports a refused API key without retrying', async () => {
    const failure = await failureOf(client(cloud({ api_key: 'wrong' })).stats(WEEK));
    assert.equal(failure.kind, 'unauthorized');
    assert.equal(fake.requestsTo(`/websites/${WEBSITE.id}/stats`).length, 1);
  });

  it('sends nothing while the API key or the website ID is unset', async () => {
    for (const settings of [cloud({ api_key: undefined }), cloud({ website_id: ' ' })]) {
      const failure = await failureOf(client(settings).stats(WEEK));
      assert.equal(failure.kind, 'unconfigured');
      assert.equal(await client(settings).configured(), false);
    }
    assert.equal(fake.received.length, 0);
    assert.equal(await client(cloud()).configured(), true);
  });
});

describe('the Umami client on a self-hosted Umami', () => {
  it('signs in with the username and password and reuses the token', async () => {
    const umami = client(selfHosted());
    await umami.stats(WEEK);
    await umami.active();
    await umami.metrics('path', WEEK);

    assert.equal(fake.logins, 1);
    const [login] = fake.requestsTo('/auth/login');
    assert.equal(login?.method, 'POST');
    assert.deepEqual(login?.body, { username: fake.username, password: fake.password });
    const tokens = fake.received
      .filter((entry) => entry.path !== '/auth/login')
      .map((entry) => entry.headers.authorization);
    assert.equal(tokens.length, 3);
    assert.equal(new Set(tokens).size, 1, 'every call carries the one token');
    assert.match(tokens[0] ?? '', /^Bearer token-\d+$/);
  });

  it('signs in once for calls made at the same time', async () => {
    const umami = client(selfHosted());
    await Promise.all([umami.stats(WEEK), umami.active(), umami.website()]);
    assert.equal(fake.logins, 1);
  });

  it('signs in again once when the token is refused, then answers', async () => {
    const umami = client(selfHosted());
    await umami.active();
    fake.expireTokens();

    assert.equal(await umami.active(), 3);
    assert.equal(fake.logins, 2);
    assert.equal(fake.requestsTo(`/websites/${WEBSITE.id}/active`).length, 3);
  });

  it('gives up when the new token is refused too', async () => {
    const umami = client(selfHosted());
    await umami.active();
    fake.refuseAllTokens();

    const failure = await failureOf(umami.active());
    assert.equal(failure.kind, 'unauthorized');
    assert.equal(fake.logins, 2, 'one sign-in again, no more');
    assert.equal(fake.requestsTo(`/websites/${WEBSITE.id}/active`).length, 3);
  });

  it('reports a wrong password as refused', async () => {
    const failure = await failureOf(client(selfHosted({ password: 'nope' })).active());
    assert.equal(failure.kind, 'unauthorized');
    assert.equal(fake.requestsTo(`/websites/${WEBSITE.id}/active`).length, 0);
  });

  it('reports an account with two-factor sign-in', async () => {
    fake.twoFactor = true;
    const failure = await failureOf(client(selfHosted()).active());
    assert.equal(failure.kind, 'two-factor');
  });

  it('sends nothing while the username, the password or the Umami URL is unset', async () => {
    for (const settings of [
      selfHosted({ username: '' }),
      selfHosted({ password: undefined }),
      selfHosted({ umami_url: '' }),
    ]) {
      assert.equal((await failureOf(client(settings).active())).kind, 'unconfigured');
    }
    assert.equal(fake.received.length, 0);
  });

  it('uses the API URL in place of the Umami URL when it is set', async () => {
    const umami = client(
      selfHosted({ umami_url: 'https://cdn.example.com', api_url: `${fake.origin}/api/` }),
    );
    assert.equal(await umami.active(), 3);
  });
});

describe('the Umami client on a slow or odd Umami', () => {
  it('stops waiting after its timeout', async () => {
    fake.delayMs = 1000;
    const started = Date.now();
    const failure = await failureOf(client(cloud(), 150).active());
    assert.deepEqual(failure, { kind: 'timeout', seconds: 0.15 });
    assert.ok(Date.now() - started < 800, 'the call gave up at the timeout');
  });

  it('times out a slow sign-in too', async () => {
    fake.delayMs = 1000;
    const failure = await failureOf(client(selfHosted(), 150).active());
    assert.equal(failure.kind, 'timeout');
  });

  it('stops when the caller aborts', async () => {
    fake.delayMs = 1000;
    const failure = await failureOf(client(cloud()).active({ signal: AbortSignal.timeout(50) }));
    assert.equal(failure.kind, 'aborted');
  });

  it('reports an Umami that cannot be reached', async () => {
    const failure = await failureOf(client(cloud({ api_url: 'http://127.0.0.1:1/v1' })).active());
    assert.equal(failure.kind, 'network');
  });

  it('reports an answer it cannot read', async () => {
    fake.data.active = 'many';
    assert.equal((await failureOf(client(cloud()).active())).kind, 'invalid-answer');
  });

  it('times out below the dashboard widget limit by default', async () => {
    fake.delayMs = 3500;
    const started = Date.now();
    assert.equal((await failureOf(client(cloud()).active())).kind, 'timeout');
    assert.ok(Date.now() - started < 3000);
  });
});

describe('what the Umami client reads', () => {
  it('reads the website', async () => {
    assert.deepEqual(await client(cloud()).website(), WEBSITE);
  });

  it('reports an unknown website as not found', async () => {
    const failure = await failureOf(client(cloud({ website_id: 'missing' })).website());
    assert.equal(failure.kind, 'not-found');
  });

  it('reads Umami 2 stats, which carry the previous period beside each value', async () => {
    fake.data.stats = {
      pageviews: { value: 9, prev: 7 },
      visitors: { value: 5, prev: 4 },
      visits: { value: 6, prev: 5 },
      bounces: { value: 2, prev: 1 },
      totaltime: { value: 300, prev: 200 },
    };
    assert.deepEqual(await client(cloud()).stats(WEEK), {
      current: { pageviews: 9, visitors: 5, visits: 6, bounces: 2, totaltime: 300 },
      previous: { pageviews: 7, visitors: 4, visits: 5, bounces: 1, totaltime: 200 },
    });
  });

  it('reads counts Umami sends as strings, and stats without a comparison', async () => {
    fake.data.stats = { pageviews: '12', visitors: '3', visits: 4, bounces: 1, totaltime: '60' };
    assert.deepEqual(await client(cloud()).stats(WEEK), {
      current: { pageviews: 12, visitors: 3, visits: 4, bounces: 1, totaltime: 60 },
      previous: undefined,
    });
  });

  it('reads views and visitors per day in the time zone asked for', async () => {
    const daily = await client(cloud()).pageviews(WEEK, { timezone: 'America/Chicago' });
    assert.deepEqual(daily, {
      pageviews: [
        { day: '2026-10-14', count: 10 },
        { day: '2026-10-15', count: 20 },
      ],
      sessions: [
        { day: '2026-10-14', count: 4 },
        { day: '2026-10-15', count: 6 },
      ],
    });
    const [sent] = fake.requestsTo(`/websites/${WEBSITE.id}/pageviews`);
    const query = new URL(sent?.path ?? '', 'http://x').searchParams;
    assert.equal(query.get('unit'), 'day');
    assert.equal(query.get('timezone'), 'America/Chicago');
  });

  it('reads the top values of a metric, with a limit', async () => {
    const umami = client(cloud());
    assert.deepEqual(await umami.metrics('path', WEEK, { limit: 10 }), [
      { value: '/', count: 60 },
      { value: '/2026/10/hello/', count: 30 },
    ]);
    for (const type of ['referrer', 'country', 'browser', 'device'] as const) {
      assert.equal((await umami.metrics(type, WEEK)).length, 1, type);
    }
    const [sent] = fake.requestsTo(`/websites/${WEBSITE.id}/metrics`);
    const query = new URL(sent?.path ?? '', 'http://x').searchParams;
    assert.equal(query.get('type'), 'path');
    assert.equal(query.get('limit'), '10');
  });

  it('reads views and visitors for the top values of a metric, with a limit', async () => {
    const umami = client(cloud());
    fake.data.expanded['path'] = [
      { name: '/', pageviews: 60, visitors: 20, visits: 25, bounces: 0, totaltime: 0 },
      {
        name: '/2026/10/hello/',
        pageviews: '90',
        visitors: '10',
        visits: 12,
        bounces: 0,
        totaltime: 0,
      },
    ];
    assert.deepEqual(await umami.expandedMetrics('path', WEEK, { limit: 50 }), [
      { value: '/', pageviews: 60, visitors: 20 },
      { value: '/2026/10/hello/', pageviews: 90, visitors: 10 },
    ]);
    const [sent] = fake.requestsTo(`/websites/${WEBSITE.id}/metrics/expanded`);
    const query = new URL(sent?.path ?? '', 'http://x').searchParams;
    assert.equal(query.get('type'), 'path');
    assert.equal(query.get('limit'), '50');
    assert.ok(query.get('startAt') !== null && query.get('endAt') !== null);
  });

  it('calls an expanded metric answer without views and visitors invalid', async () => {
    const umami = client(cloud());
    fake.data.expanded['path'] = [{ x: '/', y: 3 }];
    await assert.rejects(umami.expandedMetrics('path', WEEK), (error: unknown) => {
      assert.ok(error instanceof UmamiError);
      assert.equal(error.failure.kind, 'invalid-answer');
      return true;
    });
  });

  it('reads the visitors right now, in the Umami 3 and Umami 2 shapes', async () => {
    const umami = client(cloud());
    assert.equal(await umami.active(), 3);
    fake.data.active = { x: 4 };
    assert.equal(await umami.active(), 4);
    fake.data.active = [{ x: 5 }];
    assert.equal(await umami.active(), 5);
  });
});
