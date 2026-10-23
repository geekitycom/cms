import { Temporal } from '@js-temporal/polyfill';

import { calendarDayIn } from '../content/time.ts';
import type { DashboardPeriod, PluginBlock, PluginWidget } from '../plugin.ts';
import { pluginSite } from '../plugins/site.ts';
import { findUserById } from '../site/users.ts';
import type { User } from '../site/users.ts';
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
  /**
   * Makes the card the signed-in user's own: it is on the dashboard only for
   * a user this returns true for, and its result is kept for each user apart.
   */
  readonly forUser?: (user: User) => boolean;
  load(
    context: Readonly<GeekityEnv['Variables']>,
    period: DashboardPeriod,
    user: User | undefined,
  ): readonly PluginBlock[] | Promise<readonly PluginBlock[]>;
}

export type WidgetPlacement = 'alerts' | 'activity';

export function widgetKey(owner: string, id: string): string {
  return `${owner}:${id}`;
}

export interface WidgetLoad {
  readonly owner: string;
  readonly widget: Omit<PluginWidget, 'load'>;
  readonly placement: WidgetPlacement;
  readonly period: DashboardPeriod;
  /** The user whose own card this is, for a card that differs from user to user. */
  readonly viewer?: number;
  load(signal: AbortSignal): readonly PluginBlock[] | Promise<readonly PluginBlock[]>;
}

export interface LoadedWidget {
  readonly key: string;
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
    const key = [entry.owner, widget.id, entry.period, entry.viewer ?? ''].join('\u0000');
    const last = kept.get(key);
    const drawn = (status: LoadedWidget['status'], result: Result | undefined): LoadedWidget => ({
      key: widgetKey(entry.owner, widget.id),
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
  const userId = vars.session?.userId;
  const user = userId == null ? undefined : findUserById(vars.config.dataDir, userId);
  return [
    ...core.flatMap((widget) => {
      if (widget.forUser !== undefined && (user === undefined || !widget.forUser(user))) {
        return [];
      }
      return [
        {
          owner: 'core',
          widget,
          placement: widget.placement ?? 'activity',
          period,
          ...(widget.forUser === undefined || user === undefined ? {} : { viewer: user.id }),
          load: () => widget.load(vars, period, user),
        },
      ];
    }),
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
