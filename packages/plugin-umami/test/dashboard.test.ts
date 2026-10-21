import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import umami from '../src/index.ts';
import { dayIn } from '../src/period.ts';
import { defaultData, fakeUmami, WEBSITE } from './fake-umami.ts';
import type { FakeUmami } from './fake-umami.ts';
import { closeSites, signIn, umamiSite } from './site.ts';
import type { SiteOptions } from './site.ts';

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
    assert.match(card, /^<div class="min-w-0 @3xl:col-span-2"[ >]/);
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

function cardTitled(html: string, title: string): string {
  const start = html.indexOf(title);
  assert.ok(start >= 0, `the ${title} card is on the dashboard`);
  return html.slice(
    html.lastIndexOf('<div class="min-w-0', start),
    html.indexOf('</section>', start),
  );
}

describe('the Umami top pages and top referrers cards on the dashboard', () => {
  it('sit side by side after the views and visitors card', async () => {
    const html = await (await dashboard(cloudOn(fake)))();
    const traffic = html.indexOf(TITLE);
    const pages = html.indexOf('Umami: top pages');
    const referrers = html.indexOf('Umami: top referrers');
    assert.ok(traffic < pages && pages < referrers, 'traffic, then pages, then referrers');
    assert.match(cardTitled(html, 'Umami: top pages'), /^<div class="min-w-0"[ >]/);
    assert.match(cardTitled(html, 'Umami: top referrers'), /^<div class="min-w-0"[ >]/);
  });

  it('lists views per page, with a post shown by its title and linked to its editor (AC #1)', async () => {
    fake.data.expanded['path'] = [
      { name: '/', pageviews: 60, visitors: 30, visits: 35, bounces: 0, totaltime: 0 },
      { name: '/2026/10/hello', pageviews: 30, visitors: 12, visits: 14, bounces: 0, totaltime: 0 },
      { name: '/about/', pageviews: 8, visitors: 6, visits: 6, bounces: 0, totaltime: 0 },
    ];
    const card = cardTitled(await (await dashboard(cloudOn(fake)))(), 'Umami: top pages');
    assert.match(card, /<a class="link" href="\/admin\/posts\/hello">Hello<\/a>/);
    assert.match(words(card), /\/ 60 Hello 30 \/about\/ 8/);
  });

  it('lists visitors per referring domain without the site own domain (AC #2)', async () => {
    fake.data.metrics['referrer'] = [
      { x: 'localhost', y: 50 },
      { x: 'www.example.org', y: 40 },
      { x: 'news.ycombinator.com', y: 12 },
    ];
    const options = cloudOn(fake);
    const card = cardTitled(
      await (
        await dashboard({
          ...options,
          settings: { ...options.settings, domains: 'example.org' },
        })
      )(),
      'Umami: top referrers',
    );
    assert.match(words(card), /news\.ycombinator\.com 12/);
    assert.doesNotMatch(card, /localhost|example\.org/);
  });

  it('says so in each card when the period has no data (AC #3)', async () => {
    fake.data.expanded['path'] = [];
    fake.data.metrics['referrer'] = [];
    const html = await (await dashboard(cloudOn(fake)))();
    assert.match(words(cardTitled(html, 'Umami: top pages')), /No page views in this period\./);
    assert.match(
      words(cardTitled(html, 'Umami: top referrers')),
      /No visitors came from another site in this period\./,
    );
  });
});

describe('the Umami audience and visitors right now cards on the dashboard', () => {
  const TITLES = [
    'Umami: top referrers',
    'Umami: countries',
    'Umami: browsers',
    'Umami: devices',
    'Umami: visitors right now',
  ];

  it('sit in pairs after the top referrers card, so no half card sits alone', async () => {
    const html = await (await dashboard(cloudOn(fake)))();
    const at = TITLES.map((title) => html.indexOf(title));
    assert.deepEqual(
      at.toSorted((a, b) => a - b),
      at,
      'referrers, countries, browsers, devices, then right now',
    );
    for (const title of TITLES.slice(1)) {
      assert.match(cardTitled(html, title), /^<div class="min-w-0"[ >]/);
    }
  });

  it('lists the share of visitors per country, browser and device (AC #1)', async () => {
    fake.data.metrics['country'] = [
      { x: 'US', y: 20 },
      { x: 'DE', y: 8 },
    ];
    fake.data.metrics['browser'] = [{ x: 'chrome', y: 30 }];
    fake.data.metrics['device'] = [
      { x: 'desktop', y: 25 },
      { x: 'mobile', y: 15 },
    ];
    const html = await (await dashboard(cloudOn(fake)))();
    assert.match(words(cardTitled(html, 'Umami: countries')), /United States 50% Germany 20%/);
    assert.match(words(cardTitled(html, 'Umami: browsers')), /Chrome 75%/);
    assert.match(words(cardTitled(html, 'Umami: devices')), /Desktop 62\.5% Mobile 37\.5%/);
  });

  it('shows the visitors right now as a stat, read again after 30 seconds (AC #2)', async () => {
    let clock = new Date();
    const load = await dashboard(cloudOn(fake, { now: () => clock }));
    fake.data.active = { visitors: 3 };
    assert.match(
      words(cardTitled(await load(), 'Umami: visitors right now')),
      /Visitors right now 3/,
    );
    fake.data.active = { visitors: 5 };
    clock = new Date(clock.getTime() + 10_000);
    assert.match(
      words(cardTitled(await load(), 'Umami: visitors right now')),
      /Visitors right now 3/,
    );
    clock = new Date(clock.getTime() + 30_000);
    const html = await load();
    assert.match(words(cardTitled(html, 'Umami: visitors right now')), /Visitors right now 5/);
    assert.match(words(cardTitled(html, 'Umami: countries')), /United States 50%/);
  });
});

describe('the Umami recent posts card on the dashboard', () => {
  it('spans the row after the visitors right now card', async () => {
    const html = await (await dashboard(cloudOn(fake)))();
    assert.ok(
      html.indexOf('Umami: visitors right now') < html.indexOf('Umami: recent posts'),
      'right now, then recent posts',
    );
    assert.match(
      cardTitled(html, 'Umami: recent posts'),
      /^<div class="min-w-0 @3xl:col-span-2"[ >]/,
    );
  });

  it('sets a recent post views beside its engagement, read through the core services', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    fake.data.expanded['path'] = [
      { name: '/2026/10/fresh/', pageviews: 9, visitors: 5, visits: 5, bounces: 0, totaltime: 0 },
    ];
    fake.data.pathViews = { '/2026/10/fresh/': 9 };
    const html = await (
      await dashboard(
        cloudOn(fake, {
          posts: {
            'fresh.md': `---\ntitle: Fresh\ndate: '${yesterday}'\npermalink: /2026/10/fresh/\n---\n\nNew.\n`,
          },
        }),
      )
    )();
    const card = cardTitled(html, 'Umami: recent posts');
    assert.match(card, /<a class="link" href="\/admin\/posts\/fresh">Fresh<\/a>/);
    assert.match(words(card), /Most read [^]*?Post Views Engaged Week 1 Fresh 9 0 9 so far/);
  });
});
