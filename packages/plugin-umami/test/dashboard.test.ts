import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import umami from '../src/index.ts';
import { dayIn } from '../src/traffic.ts';
import { defaultData, fakeUmami, WEBSITE } from './fake-umami.ts';
import type { FakeUmami } from './fake-umami.ts';
import { closeSites, signIn, umamiSite } from './site.ts';
import type { SiteOptions } from './site.ts';

/**
 * The views and visitors card on the admin dashboard, loaded through the
 * site's own `host.fetch` from a fake Umami on loopback.
 */

const TITLE = 'Umami: views and visitors';

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
  mock.method(console, 'warn', () => {});
});
afterEach(() => mock.restoreAll());

function cloudOn(umamiFake: FakeUmami, extra: SiteOptions = {}): SiteOptions {
  return {
    settings: {
      umami_url: 'https://cloud.umami.is',
      website_id: WEBSITE.id,
      api_mode: 'cloud',
      api_url: umamiFake.cloudBase,
    },
    secrets: { api_key: umamiFake.apiKey },
    timezone: 'America/Chicago',
    ...extra,
  };
}

async function dashboard(options: SiteOptions) {
  const cms = await umamiSite(umami, options);
  const admin = await signIn(cms);
  return async (query = '') => {
    const response = await admin.get(`/admin${query}`);
    assert.equal(response.status, 200);
    return response.text();
  };
}

function words(html: string): string {
  return html
    .replaceAll(/<script[\s\S]*?<\/script>/g, ' ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/\s+/g, ' ');
}

function cardOf(html: string): string {
  const start = html.indexOf(TITLE);
  assert.ok(start >= 0, 'the Umami card is on the dashboard');
  return html.slice(
    html.lastIndexOf('<div class="min-w-0', start),
    html.indexOf('</section>', start),
  );
}

describe('the Umami card on the dashboard', () => {
  it('spans the row and draws views and visitors per day in the site time zone (AC #1)', async () => {
    const html = await (await dashboard(cloudOn(fake)))();
    const card = cardOf(html);
    assert.match(card, /^<div class="min-w-0 @3xl:col-span-2">/);
    assert.match(card, /<svg[^>]*role="img"/);
    assert.match(words(card), /Day Views Visitors/);
    const today = dayIn(new Date(), 'America/Chicago');
    const label = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(Date.parse(`${today}T00:00:00Z`));
    assert.match(words(card), new RegExp(`${label} 0 0`));
    const [pageviews] = fake.requestsTo(`/websites/${WEBSITE.id}/pageviews`);
    assert.match(pageviews?.path ?? '', /timezone=America%2FChicago/);
  });

  it('shows visitors, views, bounce rate and average visit time with the change from the 7 days before (AC #2)', async () => {
    const text = words(cardOf(await (await dashboard(cloudOn(fake)))()));
    assert.match(text, /Visitors 40 ▲ \+25%, up from 32/);
    assert.match(text, /Views 120 ▲ \+20%, up from 100/);
    assert.match(text, /Bounce rate 40% ▼ −11%, down from 45%/);
    assert.match(text, /Average visit time 2m 0s ▲ \+20%, up from 1m 40s/);
  });

  it('marks the last good result stale when Umami stops answering, and the dashboard still draws (AC #3)', async (t) => {
    const own = await fakeUmami();
    t.after(() => own.close());
    let clock = new Date();
    const load = await dashboard(cloudOn(own, { now: () => clock }));
    assert.match(words(cardOf(await load())), /Views 120/);

    await own.close();
    clock = new Date(clock.getTime() + 10 * 60_000);
    const html = await load();
    const text = words(cardOf(html));
    assert.match(text, /Stale The latest load failed\./);
    assert.match(text, /Views 120/);
    assert.match(words(html), /At a glance/);
  });

  it('says the stats are unavailable when Umami never answered, and the dashboard still draws (AC #3)', async () => {
    const gone = await fakeUmami();
    await gone.close();
    const html = await (await dashboard(cloudOn(gone)))();
    assert.match(words(cardOf(html)), /These stats are unavailable right now\./);
    assert.match(words(html), /At a glance/);
  });

  it('is absent, and asks Umami nothing, while the settings are incomplete (AC #4)', async () => {
    const html = await (await dashboard({ ...cloudOn(fake), secrets: {} }))();
    assert.doesNotMatch(html, new RegExp(TITLE));
    assert.match(words(html), /At a glance/);
    assert.equal(fake.received.length, 0);
  });

  it('covers 30 days when the dashboard shows 30', async () => {
    const card = cardOf(await (await dashboard(cloudOn(fake)))('?period=30'));
    assert.match(card, /Views and visitors per day, 30 days from/);
  });
});
