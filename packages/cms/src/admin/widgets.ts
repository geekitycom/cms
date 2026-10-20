/**
 * Dashboard widgets (decision-59): the cards under the stat tiles on
 * `/admin`. The core's own widgets and the plugins' go through one board,
 * which loads them all at once under a time limit, reuses a good result for
 * the widget's refresh interval, and keeps the last good result to draw
 * marked stale when a later load fails.
 */

import type { DashboardPeriod, PluginBlock, PluginWidget } from '../plugin.ts';
import { pluginSite } from '../plugins/site.ts';
import type { Clock } from '../util/clock.ts';
import { messageOf } from '../util/errors.ts';
import type { GeekityEnv } from '../web/env.ts';

/** How long the dashboard waits for one widget before it draws without it. */
export const WIDGET_TIME_LIMIT_MS = 3000;

/** The periods the dashboard offers, the default first. */
export const DASHBOARD_PERIODS: readonly DashboardPeriod[] = [7, 30];

/**
 * The days the dashboard covers, from its `period` query: one of
 * {@link DASHBOARD_PERIODS}, and the default for anything else.
 */
export function dashboardPeriod(query: string | undefined): DashboardPeriod {
  return DASHBOARD_PERIODS.find((days) => String(days) === query) ?? 7;
}

/**
 * A widget the core draws before every plugin's. Its `load` is handed the
 * request's variables (the store, the admin store, the config, the site
 * settings with `siteAtRequestStart.timezone`, and the rest) and the
 * dashboard's period.
 */
export interface CoreWidget extends Omit<PluginWidget, 'load'> {
  load(
    context: Readonly<GeekityEnv['Variables']>,
    period: DashboardPeriod,
  ): readonly PluginBlock[] | Promise<readonly PluginBlock[]>;
}

/** One widget to load: who declared it, what it is, and its load with its context bound. */
export interface WidgetLoad {
  /** `core`, or the package name of the plugin that declared it. */
  readonly owner: string;
  readonly widget: Omit<PluginWidget, 'load'>;
  /** The period it is loaded for, which its kept result is kept by. */
  readonly period: DashboardPeriod;
  load(): readonly PluginBlock[] | Promise<readonly PluginBlock[]>;
}

/** A widget as the dashboard draws it. */
export interface LoadedWidget {
  readonly title: string;
  readonly width: PluginWidget['width'];
  /**
   * `fresh` is a result from within its refresh interval, `stale` the last
   * good result after a load failed, `unavailable` a failed load with no
   * earlier result, drawn with no blocks.
   */
  readonly status: 'fresh' | 'stale' | 'unavailable';
  readonly blocks: readonly PluginBlock[];
  /** When the blocks were loaded, `undefined` when unavailable. */
  readonly loadedAt: Date | undefined;
}

export interface WidgetBoard {
  /**
   * Load every widget at once and answer them in the order given, leaving
   * out each whose result holds no blocks. Never rejects.
   */
  load(widgets: readonly WidgetLoad[], now: Clock): Promise<LoadedWidget[]>;
}

interface Result {
  readonly blocks: readonly PluginBlock[];
  readonly loadedAt: Date;
}

/**
 * The board one admin mount keeps for its life. Results are in memory only,
 * so a restart loads every widget again.
 */
export function createWidgetBoard(options: { timeLimitMs: number }): WidgetBoard {
  const { timeLimitMs } = options;
  const kept = new Map<string, Result>();
  const running = new Map<string, Promise<Result>>();

  function started(key: string, entry: WidgetLoad, now: Clock): Promise<Result> {
    const already = running.get(key);
    if (already !== undefined) return already;
    const loading = Promise.resolve()
      .then(() => entry.load())
      .then((blocks: unknown) => {
        if (!Array.isArray(blocks)) {
          throw new Error('It returned something that is not a list of blocks.');
        }
        const result = { blocks: blocks as readonly PluginBlock[], loadedAt: now() };
        kept.set(key, result);
        return result;
      })
      .finally(() => running.delete(key));
    // A load that outlives its time limit has been logged as late already.
    loading.catch(() => {});
    running.set(key, loading);
    return loading;
  }

  async function loadOne(entry: WidgetLoad, now: Clock): Promise<LoadedWidget> {
    const { widget } = entry;
    const key = `${entry.owner}\u0000${widget.id}\u0000${String(entry.period)}`;
    const last = kept.get(key);
    const drawn = (status: LoadedWidget['status'], result: Result | undefined): LoadedWidget => ({
      title: widget.title,
      width: widget.width,
      status,
      blocks: result?.blocks ?? [],
      loadedAt: result?.loadedAt,
    });

    if (
      last !== undefined &&
      now().getTime() - last.loadedAt.getTime() < widget.refreshSeconds * 1000
    ) {
      return drawn('fresh', last);
    }
    try {
      return drawn('fresh', await withinTimeLimit(started(key, entry, now), timeLimitMs));
    } catch (error) {
      console.warn(`The ${entry.owner} widget ${widget.id} did not load: ${messageOf(error)}`);
      return last === undefined ? drawn('unavailable', undefined) : drawn('stale', last);
    }
  }

  return {
    async load(widgets, now) {
      const loaded = await Promise.all(widgets.map((entry) => loadOne(entry, now)));
      return loaded.filter((entry) => entry.status === 'unavailable' || entry.blocks.length > 0);
    },
  };
}

/**
 * The widgets GET /admin draws: the core's, then each running plugin's in the
 * order the plugins run, so a plugin's widgets go when it is disabled.
 */
export function dashboardWidgets(
  vars: Readonly<GeekityEnv['Variables']>,
  core: readonly CoreWidget[],
  period: DashboardPeriod,
): WidgetLoad[] {
  const context = {
    site: pluginSite({ admin: vars.admin, config: vars.config }),
    timezone: vars.siteAtRequestStart.timezone,
    period,
  };
  return [
    ...core.map((widget) => ({
      owner: 'core',
      widget,
      period,
      load: () => widget.load(vars, period),
    })),
    ...[...vars.activePlugins].flatMap((name) =>
      (vars.plugins.find(name)?.widgets ?? []).map((widget) => ({
        owner: name,
        widget,
        period,
        load: () => widget.load(context),
      })),
    ),
  ];
}

function withinTimeLimit<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`It took longer than ${String(ms)} ms.`));
    }, ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
