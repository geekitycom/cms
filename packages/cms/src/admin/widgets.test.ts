/**
 * The widget board (decision-59, TASK-444): how the dashboard loads its
 * widgets, reuses their results and survives one that fails. Driven through
 * the board's own API with a clock the test moves; `dashboard-widgets.test.ts`
 * covers what GET /admin draws.
 */
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { pluginRegistryOptions } from '../__testing__/plugin-registry-options.ts';
import { resolveConfig } from '../config.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { PluginBlock } from '../plugin.ts';
import { createPluginRegistry } from '../plugins/registry.ts';
import type { GeekityEnv } from '../web/env.ts';
import { createWidgetBoard, dashboardPeriod, dashboardWidgets } from './widgets.ts';
import type { CoreWidget, WidgetLoad } from './widgets.ts';

const STATS: readonly PluginBlock[] = [{ stats: [{ label: 'Visits', value: 3 }] }];

function widget(
  id: string,
  load: () => readonly PluginBlock[] | Promise<readonly PluginBlock[]>,
  options: {
    refreshSeconds?: number;
    width?: 'full' | 'half';
    owner?: string;
    period?: 7 | 30;
  } = {},
): WidgetLoad {
  return {
    owner: options.owner ?? '@acme/plugin-stats',
    placement: 'activity',
    period: options.period ?? 7,
    widget: {
      id,
      title: `The ${id} widget`,
      width: options.width ?? 'half',
      refreshSeconds: options.refreshSeconds ?? 60,
    },
    load,
  };
}

function clockAt(start: string): { now: () => Date; advance(seconds: number): void } {
  let at = new Date(start).getTime();
  return {
    now: () => new Date(at),
    advance(seconds) {
      at += seconds * 1000;
    },
  };
}

const never = () => new Promise<readonly PluginBlock[]>(() => {});

let warnings: string[];

beforeEach(() => {
  warnings = [];
  mock.method(console, 'warn', (message: string) => warnings.push(message));
});

afterEach(() => mock.restoreAll());

describe('the widget board', () => {
  it('draws the widgets in the order it is handed them, with their titles and widths', async () => {
    const board = createWidgetBoard({ timeLimitMs: 1000 });
    const clock = clockAt('2026-10-20T12:00:00Z');

    const drawn = await board.load(
      [
        widget('core-first', () => STATS, { owner: 'core', width: 'full' }),
        widget('plugin-second', () => STATS),
      ],
      clock.now,
    );

    assert.deepEqual(
      drawn.map(({ title, width, status }) => ({ title, width, status })),
      [
        { title: 'The core-first widget', width: 'full', status: 'fresh' },
        { title: 'The plugin-second widget', width: 'half', status: 'fresh' },
      ],
    );
    assert.deepEqual(drawn[0]?.blocks, STATS);
  });

  it('draws no card for a widget that returns no blocks', async () => {
    const board = createWidgetBoard({ timeLimitMs: 1000 });
    const drawn = await board.load(
      [widget('quiet', () => []), widget('loud', () => STATS)],
      clockAt('2026-10-20T12:00:00Z').now,
    );
    assert.deepEqual(
      drawn.map((entry) => entry.title),
      ['The loud widget'],
    );
  });

  it('loads every widget at once', async () => {
    const board = createWidgetBoard({ timeLimitMs: 500 });
    let releaseFirst: () => void = () => {};
    const second = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const drawn = await board.load(
      [
        widget('waits', async () => {
          await second;
          return STATS;
        }),
        widget('releases', () => {
          releaseFirst();
          return STATS;
        }),
      ],
      clockAt('2026-10-20T12:00:00Z').now,
    );

    assert.deepEqual(
      drawn.map((entry) => entry.status),
      ['fresh', 'fresh'],
    );
  });

  it('says a widget is unavailable when it throws, runs out of time or returns no list, and draws the rest', async () => {
    const board = createWidgetBoard({ timeLimitMs: 20 });

    const drawn = await board.load(
      [
        widget('throws', () => {
          throw new Error('the API said 500');
        }),
        widget('rejects', () => Promise.reject(new Error('refused'))),
        widget('hangs', never),
        widget('scribbles', () => 'not blocks' as unknown as readonly PluginBlock[]),
        widget('works', () => STATS),
      ],
      clockAt('2026-10-20T12:00:00Z').now,
    );

    assert.deepEqual(
      drawn.map(({ title, status, blocks }) => ({ title, status, blocks: blocks.length })),
      [
        { title: 'The throws widget', status: 'unavailable', blocks: 0 },
        { title: 'The rejects widget', status: 'unavailable', blocks: 0 },
        { title: 'The hangs widget', status: 'unavailable', blocks: 0 },
        { title: 'The scribbles widget', status: 'unavailable', blocks: 0 },
        { title: 'The works widget', status: 'fresh', blocks: 1 },
      ],
    );
    assert.equal(warnings.length, 4, warnings.join('\n'));
    assert.match(warnings[0] ?? '', /@acme\/plugin-stats.*throws.*the API said 500/);
    assert.match(warnings.join('\n'), /hangs.*20 ms/);
    assert.match(warnings.join('\n'), /scribbles.*not a list of blocks/);
  });

  it('reuses a result for its refresh interval, then loads again', async () => {
    const board = createWidgetBoard({ timeLimitMs: 1000 });
    const clock = clockAt('2026-10-20T12:00:00Z');
    let calls = 0;
    const counted = widget(
      'counted',
      () => {
        calls += 1;
        return [{ stats: [{ label: 'Calls', value: calls }] }];
      },
      { refreshSeconds: 300 },
    );

    await board.load([counted], clock.now);
    clock.advance(299);
    const reused = await board.load([counted], clock.now);
    assert.equal(calls, 1);
    assert.deepEqual(reused[0]?.blocks, [{ stats: [{ label: 'Calls', value: 1 }] }]);

    clock.advance(1);
    const reloaded = await board.load([counted], clock.now);
    assert.equal(calls, 2);
    assert.deepEqual(reloaded[0]?.blocks, [{ stats: [{ label: 'Calls', value: 2 }] }]);
  });

  it('keeps one plugin’s widget apart from another’s with the same id', async () => {
    const board = createWidgetBoard({ timeLimitMs: 1000 });
    const now = clockAt('2026-10-20T12:00:00Z').now;
    await board.load([widget('visits', () => STATS, { owner: '@acme/a' })], now);
    const other = await board.load(
      [widget('visits', () => [{ paragraph: ['B'] }], { owner: '@acme/b' })],
      now,
    );
    assert.deepEqual(other[0]?.blocks, [{ paragraph: ['B'] }]);
  });

  it('keeps a widget’s result for one period apart from its result for another (TASK-445)', async () => {
    const board = createWidgetBoard({ timeLimitMs: 1000 });
    const now = clockAt('2026-10-20T12:00:00Z').now;
    await board.load([widget('visits', () => STATS, { period: 7 })], now);
    const month = await board.load(
      [widget('visits', () => [{ paragraph: ['30 days'] }], { period: 30 })],
      now,
    );
    assert.deepEqual(month[0]?.blocks, [{ paragraph: ['30 days'] }]);
  });

  it('draws the last good result marked stale, with when it was loaded, when a later load fails', async () => {
    const board = createWidgetBoard({ timeLimitMs: 20 });
    const clock = clockAt('2026-10-20T12:00:00Z');
    let failing = false;
    let hanging = false;
    const flaky = widget(
      'flaky',
      () => {
        if (hanging) return never();
        if (failing) throw new Error('down');
        return STATS;
      },
      { refreshSeconds: 60 },
    );

    await board.load([flaky], clock.now);
    clock.advance(61);
    failing = true;
    const stale = await board.load([flaky], clock.now);
    assert.equal(stale[0]?.status, 'stale');
    assert.deepEqual(stale[0]?.blocks, STATS);
    assert.equal(stale[0]?.loadedAt?.toISOString(), '2026-10-20T12:00:00.000Z');

    hanging = true;
    const timedOut = await board.load([flaky], clock.now);
    assert.equal(timedOut[0]?.status, 'stale');
    assert.deepEqual(timedOut[0]?.blocks, STATS);
  });

  it('waits on a load already running rather than starting another, and keeps what it brings back late', async () => {
    const board = createWidgetBoard({ timeLimitMs: 20 });
    const clock = clockAt('2026-10-20T12:00:00Z');
    let calls = 0;
    let finish: (blocks: readonly PluginBlock[]) => void = () => {};
    const slow = widget('slow', () => {
      calls += 1;
      return new Promise<readonly PluginBlock[]>((resolve) => {
        finish = resolve;
      });
    });

    assert.equal((await board.load([slow], clock.now))[0]?.status, 'unavailable');
    assert.equal((await board.load([slow], clock.now))[0]?.status, 'unavailable');
    assert.equal(calls, 1);

    finish(STATS);
    await new Promise((resolve) => setImmediate(resolve));
    const late = await board.load([slow], clock.now);
    assert.equal(calls, 1);
    assert.equal(late[0]?.status, 'fresh');
    assert.deepEqual(late[0]?.blocks, STATS);
  });
});

describe('the dashboard’s widgets', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'geekity-widgets-'));
  after(() => rmSync(dataDir, { recursive: true, force: true }));

  function stats(name: string, ids: readonly string[]) {
    return definePlugin({
      name,
      version: '1.0.0',
      label: name,
      description: 'Stats.',
      hostApi: HOST_API_VERSION,
      register(host) {
        for (const id of ids) {
          host.widget({
            id,
            title: id,
            width: 'half',
            refreshSeconds: 60,
            load: ({ timezone, period }) => [
              { paragraph: [`${id} in ${timezone} over ${String(period)}`] },
            ],
          });
        }
      },
    });
  }

  it('puts the core’s widgets first, then each running plugin’s in the order the plugins run, and hands each its context', async () => {
    const registry = createPluginRegistry(
      [stats('@acme/plugin-b', ['b-one', 'b-two']), stats('@acme/plugin-a', ['a-one'])].map(
        (plugin) => ({ plugin, source: 'site config' }),
      ),
      pluginRegistryOptions(dataDir),
    );
    const core: CoreWidget = {
      id: 'core-only',
      title: 'core-only',
      width: 'full',
      refreshSeconds: 60,
      load: (vars, period) => [
        { paragraph: [`core in ${vars.siteAtRequestStart.timezone} over ${String(period)}`] },
      ],
    };
    const vars = {
      plugins: registry,
      activePlugins: registry.active(new Set(['@acme/plugin-a', '@acme/plugin-b'])),
      siteAtRequestStart: { timezone: 'Europe/London' },
      config: resolveConfig({ contentDir: dataDir, dataDir }, { env: {}, cwd: dataDir }),
    } as unknown as GeekityEnv['Variables'];

    const loads = dashboardWidgets(vars, [core], 30);
    const drawn = await createWidgetBoard({ timeLimitMs: 1000 }).load(loads, () => new Date());

    assert.deepEqual(
      loads.map((entry) => `${entry.owner} ${entry.widget.id}`),
      ['core core-only', '@acme/plugin-b b-one', '@acme/plugin-b b-two', '@acme/plugin-a a-one'],
    );
    assert.deepEqual(
      drawn.map((entry) => entry.blocks),
      [
        [{ paragraph: ['core in Europe/London over 30'] }],
        [{ paragraph: ['b-one in Europe/London over 30'] }],
        [{ paragraph: ['b-two in Europe/London over 30'] }],
        [{ paragraph: ['a-one in Europe/London over 30'] }],
      ],
    );

    const onlyA = { ...vars, activePlugins: registry.active(new Set(['@acme/plugin-a'])) };
    assert.deepEqual(
      dashboardWidgets(onlyA, [core], 7).map((entry) => entry.widget.id),
      ['core-only', 'a-one'],
    );
  });

  it('places a core widget that asks for it among the alerts, and every other widget under Activity', async () => {
    const registry = createPluginRegistry(
      [{ plugin: stats('@acme/plugin-a', ['a-one']), source: 'site config' }],
      pluginRegistryOptions(dataDir),
    );
    const widget = (id: string): CoreWidget => ({
      id,
      title: id,
      width: 'full',
      refreshSeconds: 60,
      load: () => [{ paragraph: [id] }],
    });
    const vars = {
      plugins: registry,
      activePlugins: registry.active(new Set(['@acme/plugin-a'])),
      siteAtRequestStart: { timezone: 'UTC' },
      config: resolveConfig({ contentDir: dataDir, dataDir }, { env: {}, cwd: dataDir }),
    } as unknown as GeekityEnv['Variables'];

    const drawn = await createWidgetBoard({ timeLimitMs: 1000 }).load(
      dashboardWidgets(vars, [{ ...widget('alert'), placement: 'alerts' }, widget('plain')], 7),
      () => new Date(),
    );

    assert.deepEqual(
      drawn.map((entry) => `${entry.title} ${entry.placement}`),
      ['alert alerts', 'plain activity', 'a-one activity'],
    );
  });
});

describe('the dashboard’s period (TASK-445)', () => {
  it('is 30 days when the query asks for 30, and 7 days for anything else', () => {
    assert.equal(dashboardPeriod('30'), 30);
    assert.equal(dashboardPeriod('7'), 7);
    assert.equal(dashboardPeriod(undefined), 7);
    assert.equal(dashboardPeriod('90'), 7);
    assert.equal(dashboardPeriod('30abc'), 7);
  });
});
