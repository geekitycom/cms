/**
 * Dashboard widgets on GET /admin (decision-59, TASK-444): what a plugin's
 * widgets draw, where, and what a failing one does to the rest of the page.
 * `widgets.test.ts` covers the board's timing and reuse.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';

import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PluginWidget } from '../plugin.ts';
import type { Cms } from '../index.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
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
): Promise<{ cms: Cms; agent: Browser; contentDir: string }> {
  const contentDir = await box.dir('geekity-widgets-content-');
  const dataDir = await box.dir('geekity-widgets-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(path.join(contentDir, '_data', 'site.json'), siteJson(enabled), 'utf8');
  const cms = await box.open({ contentDir, dataDir, plugins });
  return { cms, agent: await signedIn(cms), contentDir };
}

async function dashboard(agent: Browser): Promise<string> {
  const response = await agent.get('/admin');
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

    const order = ['At a glance', 'Visits', 'Top pages', 'Referrers'].map((title) =>
      words.indexOf(title),
    );
    assert.ok(
      order.every((at, index) => at >= 0 && (index === 0 || at > (order[index - 1] ?? 0))),
      words,
    );
    assert.match(words, /Visitors 1,234/);
    assert.match(words, /Days follow UTC\./);
    assert.match(words, /Top pages \/about\/ 9/);
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

    assert.match(words, /Broken These stats are unavailable right now\./);
    assert.match(words, /Visits Visitors 1,234/);
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
