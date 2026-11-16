import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';

import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PluginWidget } from '../plugin.ts';
import type { Cms } from '../index.ts';
import { browser, sandbox, signedIn, waitedDashboardUrl } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { screenOf, text } from './__testing__/markup.ts';

const box = sandbox();
after(() => box.cleanup());

beforeEach(() => {
  mock.method(console, 'warn', () => {});
});
afterEach(() => mock.restoreAll());

function widgetPlugin(name: string, widgets: readonly PluginWidget[]): Plugin {
  return definePlugin({
    name,
    version: '1.0.0',
    label: name,
    description: 'Adds widgets.',
    hostApi: HOST_API_VERSION,
    register(host) {
      for (const widget of widgets) host.widget(widget);
    },
  });
}

function siteJson(enabled: readonly string[]): string {
  return JSON.stringify({
    title: 'A Site',
    plugins: Object.fromEntries(enabled.map((name) => [name, { enabled: true }])),
  });
}

async function site(
  plugins: Plugin[],
  enabled: readonly string[] = plugins.map((plugin) => plugin.name),
  now?: () => Date,
): Promise<{ cms: Cms; agent: Browser; contentDir: string }> {
  const contentDir = await box.dir('geekity-widgets-content-');
  const dataDir = await box.dir('geekity-widgets-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(path.join(contentDir, '_data', 'site.json'), siteJson(enabled), 'utf8');
  const cms = await box.open({
    contentDir,
    dataDir,
    plugins,
    ...(now === undefined ? {} : { now }),
  });
  return { cms, agent: await signedIn(cms), contentDir };
}

async function dashboard(agent: Browser): Promise<string> {
  const response = await agent.get(waitedDashboardUrl());
  assert.equal(response.status, 200);
  return screenOf(await response.text());
}

const VISITS: PluginWidget = {
  id: 'visits',
  title: 'Visits',
  width: 'full',
  refreshSeconds: 60,
  load: ({ timezone }) => [
    { stats: [{ label: 'Visitors', value: 1234, previous: 1000 }] },
    { paragraph: [`Days follow ${timezone}.`] },
  ],
};

const TOP_PAGES: PluginWidget = {
  id: 'top-pages',
  title: 'Top pages',
  width: 'half',
  refreshSeconds: 60,
  load: () => [{ ranked: { caption: 'Most read', items: [{ label: '/about/', value: 9 }] } }],
};

describe('dashboard widgets (TASK-444)', () => {
  it('draws an enabled plugin’s widgets below the stat tiles, in the order the plugins run (AC #1)', async () => {
    const first = widgetPlugin('@test/plugin-first', [VISITS, TOP_PAGES]);
    const second = widgetPlugin('@test/plugin-second', [
      { ...TOP_PAGES, id: 'referrers', title: 'Referrers' },
    ]);
    const { agent } = await site([first, second]);

    const words = text(await dashboard(agent));

    const glance = words.indexOf('At a glance');
    assert.ok(glance >= 0, words);
    for (const title of ['Visits', 'Top pages', 'Referrers']) {
      assert.ok(words.indexOf(title) > glance, words);
    }
    assert.match(words, /Visitors 1,234/);
    assert.match(words, /Days follow UTC\./);
    assert.match(words, /Top pages ↑ ↓ ← → − ✕ \/about\/ 9/);
  });

  it('draws the rest of the dashboard when a widget throws, and says that one is unavailable (AC #2)', async () => {
    const broken = widgetPlugin('@test/plugin-broken', [
      {
        ...TOP_PAGES,
        id: 'broken',
        title: 'Broken',
        load: () => {
          throw new Error('the API said 500');
        },
      },
      VISITS,
    ]);
    const { agent } = await site([broken]);

    const words = text(await dashboard(agent));

    assert.match(words, /Broken ↑ ↓ ← → − ✕ These stats are unavailable right now\./);
    assert.match(words, /Visits ↑ ↓ ← → − ✕ Visitors 1,234/);
    assert.match(words, /At a glance/);
  });

  it('reuses a widget’s result on the next dashboard request instead of loading again (AC #3)', async () => {
    let calls = 0;
    const counted = widgetPlugin('@test/plugin-counted', [
      {
        ...VISITS,
        refreshSeconds: 300,
        load: () => {
          calls += 1;
          return [{ paragraph: ['Counted.'] }];
        },
      },
    ]);
    const { agent } = await site([counted]);

    await dashboard(agent);
    await dashboard(agent);

    assert.equal(calls, 1);
  });

  it('drops a disabled plugin’s widgets and brings them back on enabling, with no restart (AC #4)', async () => {
    const plugin = widgetPlugin('@test/plugin-toggled', [VISITS]);
    const { agent, contentDir } = await site([plugin], []);
    const siteFile = path.join(contentDir, '_data', 'site.json');

    assert.doesNotMatch(text(await dashboard(agent)), /Visits/);

    await writeFile(siteFile, siteJson([plugin.name]), 'utf8');
    assert.match(text(await dashboard(agent)), /Visits/);

    await writeFile(siteFile, siteJson([]), 'utf8');
    assert.doesNotMatch(text(await dashboard(agent)), /Visits/);
  });
});

async function page(agent: Browser): Promise<string> {
  const response = await agent.get('/admin');
  assert.equal(response.status, 200);
  return await response.text();
}

function cardOf(html: string, key: string): string {
  const [, card = ''] = html.split(`data-dashboard-card="${key}"`);
  return card.split('data-dashboard-card=')[0] ?? '';
}

function widgetUrlIn(html: string): string | undefined {
  return /data-widget-url="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&');
}

describe('the dashboard drawn before its widgets load', () => {
  it('answers while a widget is still loading, with a placeholder the browser fills in', async () => {
    let calls = 0;
    const hanging = widgetPlugin('@test/plugin-hanging', [
      {
        ...VISITS,
        load: () => {
          calls += 1;
          return new Promise<never>(() => {});
        },
      },
    ]);
    const { agent } = await site([hanging]);

    const html = await page(agent);

    assert.equal(calls, 0, 'the page did not start the load');
    const card = cardOf(html, '@test/plugin-hanging:visits');
    assert.match(card, /<h2 class="card-title">Visits<\/h2>/);
    assert.match(card, /class="skeleton/);
    assert.equal(
      widgetUrlIn(card),
      '/admin/dashboard/widget?key=%40test%2Fplugin-hanging%3Avisits&period=7',
    );
    assert.match(
      html,
      /<noscript>[\s\S]*<a class="link" href="\/admin\?wait=1">Show the dashboard with every card loaded<\/a>/,
    );
  });

  it('serves one widget’s card body by key and period, behind the sign-in', async () => {
    const seen: number[] = [];
    const plugin = widgetPlugin('@test/plugin-period', [
      {
        ...VISITS,
        load: ({ period }) => {
          seen.push(period);
          return [{ paragraph: [`Over ${String(period)} days.`] }];
        },
      },
    ]);
    const { cms, agent } = await site([plugin]);
    const url = '/admin/dashboard/widget?key=%40test%2Fplugin-period%3Avisits&period=30';

    const response = await agent.get(url);

    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(text(body), 'Over 30 days.');
    assert.doesNotMatch(body, /<html|card-title/);
    assert.deepEqual(seen, [30]);

    const unknown = await agent.get('/admin/dashboard/widget?key=%40test%2Fnone%3Avisits');
    assert.equal(unknown.status, 404);

    const anonymous = await browser(cms).get(url);
    assert.equal(anonymous.status, 302);
    assert.match(anonymous.headers.get('location') ?? '', /\/admin\/login/);
  });

  it('gives a card the browser loads longer than the waiting page gives it', async () => {
    const slow = widgetPlugin('@test/plugin-slow', [
      {
        ...VISITS,
        load: ({ signal }) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve([{ paragraph: ['Slow but there.'] }]), 3300);
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('stopped'));
            });
          }),
      },
    ]);
    const { agent } = await site([slow]);
    const url = widgetUrlIn(cardOf(await page(agent), '@test/plugin-slow:visits')) ?? '';

    const [waited, card] = await Promise.all([dashboard(agent), agent.get(url)]);

    assert.match(text(waited), /Visits ↑ ↓ ← → − ✕ These stats are unavailable right now\./);
    assert.equal(card.status, 200);
    assert.equal(text(await card.text()), 'Slow but there.');
  });

  it('answers 204 for a widget with nothing to show, so the browser drops its card', async () => {
    const empty = widgetPlugin('@test/plugin-empty', [{ ...VISITS, load: () => [] }]);
    const { agent } = await site([empty]);

    const response = await agent.get(
      widgetUrlIn(cardOf(await page(agent), '@test/plugin-empty:visits')) ?? '',
    );

    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  });

  it('draws a kept result with the page, and reloads it in the browser once it is due', async () => {
    let now = new Date('2026-10-20T15:00:00.000Z');
    let calls = 0;
    const counted = widgetPlugin('@test/plugin-kept', [
      {
        ...VISITS,
        refreshSeconds: 60,
        load: () => {
          calls += 1;
          return [{ paragraph: [`Load ${String(calls)}.`] }];
        },
      },
    ]);
    const { agent } = await site([counted], undefined, () => now);
    const key = '@test/plugin-kept:visits';
    await agent.get(widgetUrlIn(cardOf(await page(agent), key)) ?? '');

    const fresh = cardOf(await page(agent), key);
    assert.match(text(fresh), /Load 1\./);
    assert.equal(widgetUrlIn(fresh), undefined);
    assert.doesNotMatch(fresh, /skeleton/);

    now = new Date(now.getTime() + 61_000);
    const due = cardOf(await page(agent), key);
    assert.match(text(due), /Load 1\./);
    assert.ok(widgetUrlIn(due) !== undefined, 'the browser is asked to load it again');
    assert.equal(calls, 1);
  });

  it('shows a failed reload as stale and a widget with no result as unavailable', async () => {
    let now = new Date('2026-10-20T15:00:00.000Z');
    let failing = false;
    const flaky = widgetPlugin('@test/plugin-flaky', [
      {
        ...VISITS,
        refreshSeconds: 60,
        load: () => {
          if (failing) throw new Error('the API said 500');
          return [{ paragraph: ['Figures.'] }];
        },
      },
      { ...TOP_PAGES, load: () => Promise.reject(new Error('the API said 500')) },
    ]);
    const { agent } = await site([flaky], undefined, () => now);
    const html = await page(agent);
    const visits = widgetUrlIn(cardOf(html, '@test/plugin-flaky:visits')) ?? '';
    const topPages = widgetUrlIn(cardOf(html, '@test/plugin-flaky:top-pages')) ?? '';
    await agent.get(visits);

    failing = true;
    now = new Date(now.getTime() + 61_000);
    const stale = text(await (await agent.get(visits)).text());
    const unavailable = text(await (await agent.get(topPages)).text());

    assert.match(stale, /^Stale The latest load failed\. These figures are from .+\. Figures\.$/);
    assert.equal(unavailable, 'These stats are unavailable right now.');
  });

  it('leaves an alert out of the page until the browser finds it has something to say', async () => {
    const { agent } = await site([]);

    const html = await page(agent);

    assert.match(
      html,
      /<section class="mb-8" data-widget-url="\/admin\/dashboard\/widget\?key=core%3Ahealth&amp;period=7" hidden>\s*<\/section>/,
    );
    const response = await agent.get('/admin/dashboard/widget?key=core%3Ahealth');
    assert.equal(response.status, 204);
  });

  it('loads nothing for a collapsed card', async () => {
    let calls = 0;
    const plugin = widgetPlugin('@test/plugin-folded', [
      {
        ...VISITS,
        load: () => {
          calls += 1;
          return [{ paragraph: ['Loaded.'] }];
        },
      },
    ]);
    const { agent } = await site([plugin]);
    const html = await page(agent);
    const token = /name="csrf_token" value="([^"]+)"/.exec(html)?.[1] ?? '';
    await agent.post('/admin/dashboard/layout', {
      csrf_token: token,
      action: 'collapse',
      widget: '@test/plugin-folded:visits',
    });

    const card = cardOf(await page(agent), '@test/plugin-folded:visits');

    assert.equal(widgetUrlIn(card), undefined);
    assert.doesNotMatch(card, /skeleton/);
    assert.equal(calls, 0);
  });
});
