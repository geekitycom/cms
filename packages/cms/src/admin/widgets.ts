import { Temporal } from '@js-temporal/polyfill';

import { calendarDayIn } from '../content/time.ts';
import type { DashboardPeriod, PluginBlock, PluginWidget } from '../plugin.ts';
import { pluginSite } from '../plugins/site.ts';
import type { Clock } from '../util/clock.ts';
import { messageOf } from '../util/errors.ts';
import type { GeekityEnv } from '../web/env.ts';

export const WIDGET_TIME_LIMIT_MS = 3000;

export const DASHBOARD_PERIODS: readonly DashboardPeriod[] = [7, 30];

export function dashboardPeriod(query: string | undefined): DashboardPeriod {
  return DASHBOARD_PERIODS.find((days) => String(days) === query) ?? 7;
}

export function daysEndingToday(vars: Readonly<GeekityEnv['Variables']>, count: number): string[] {
  const today = calendarDayIn(vars.config.now(), vars.siteAtRequestStart.timezone);
  if (today === undefined) throw new Error('The clock does not read as a date.');
  const first = Temporal.PlainDate.from(today).subtract({ days: count - 1 });
  return Array.from({ length: count }, (_, index) => first.add({ days: index }).toString());
}

export interface CoreWidget extends Omit<PluginWidget, 'load'> {
  readonly placement?: WidgetPlacement;
  load(
    context: Readonly<GeekityEnv['Variables']>,
    period: DashboardPeriod,
  ): readonly PluginBlock[] | Promise<readonly PluginBlock[]>;
}

export type WidgetPlacement = 'alerts' | 'activity';

export interface WidgetLoad {
  readonly owner: string;
  readonly widget: Omit<PluginWidget, 'load'>;
  readonly placement: WidgetPlacement;
  readonly period: DashboardPeriod;
  load(signal: AbortSignal): readonly PluginBlock[] | Promise<readonly PluginBlock[]>;
}

export interface LoadedWidget {
  readonly title: string;
  readonly width: PluginWidget['width'];
  readonly placement: WidgetPlacement;
  readonly status: 'fresh' | 'stale' | 'unavailable';
  readonly blocks: readonly PluginBlock[];
  readonly loadedAt: Date | undefined;
}

export interface WidgetBoard {
  load(widgets: readonly WidgetLoad[], now: Clock): Promise<LoadedWidget[]>;
}

interface Result {
  readonly blocks: readonly PluginBlock[];
  readonly loadedAt: Date;
}

export function createWidgetBoard(options: { timeLimitMs: number }): WidgetBoard {
  const { timeLimitMs } = options;
  const kept = new Map<string, Result>();
  const running = new Map<string, Promise<Result>>();

  function started(key: string, entry: WidgetLoad, now: Clock): Promise<Result> {
    const already = running.get(key);
    if (already !== undefined) return already;
    const signal = AbortSignal.timeout(timeLimitMs);
    const loading = Promise.resolve()
      .then(() => entry.load(signal))
      .then((blocks: unknown) => {
        if (!Array.isArray(blocks)) {
          throw new Error('It returned something that is not a list of blocks.');
        }
        const result = { blocks: blocks as readonly PluginBlock[], loadedAt: now() };
        kept.set(key, result);
        return result;
      })
      .finally(() => running.delete(key));
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
      placement: entry.placement,
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
      placement: widget.placement ?? 'activity',
      period,
      load: () => widget.load(vars, period),
    })),
    ...[...vars.activePlugins].flatMap((name) =>
      (vars.plugins.find(name)?.widgets ?? []).map((widget) => ({
        owner: name,
        widget,
        placement: 'activity' as const,
        period,
        load: (signal: AbortSignal) => widget.load({ ...context, signal }),
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
