import type { Context, Hono } from 'hono';

import type { DashboardPeriod } from '../plugin.ts';
import type { GeekityEnv } from '../web/env.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import {
  arrangeColumns,
  changeLayout,
  EMPTY_LAYOUT,
  LAYOUT_ACTIONS,
} from '../site/dashboard-layout.ts';
import type { DashboardLayout, LayoutChange } from '../site/dashboard-layout.ts';
import { findUserById, setUserDashboardLayout } from '../site/users.ts';
import type { Clock } from '../util/clock.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { COMMENTS_PATH, pendingComments } from './comments.ts';
import { CORE_WIDGETS } from './core-widgets.ts';
import type { AdminRender } from './documents.ts';
import { FEDERATION_PATH } from './federation.ts';
import { formatInTimezone } from './formatting.ts';
import { MESSAGES_PATH, unreadMessages } from './messages.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import {
  createWidgetBoard,
  DASHBOARD_PERIODS,
  dashboardPeriod,
  dashboardWidgets,
  PAGE_WAIT_MS,
  WIDGET_TIME_LIMIT_MS,
  widgetKey,
} from './widgets.ts';
import type { LoadedWidget, WidgetBoard, WidgetLoad } from './widgets.ts';

export const DASHBOARD_LAYOUT_PATH = `${ADMIN_PREFIX}/dashboard/layout`;
export const DASHBOARD_WIDGET_PATH = `${ADMIN_PREFIX}/dashboard/widget`;

/**
 * The dashboard: the stat tiles, the alert cards, and the activity cards in
 * the two columns the signed-in user arranged them in. Collapsed and removed
 * cards are never handed to the widget board, so their widgets do not load.
 *
 * The page answers with what the board already holds and leaves the rest to
 * the browser, which asks {@link DASHBOARD_WIDGET_PATH} for each widget still
 * to load: a widget that calls an outside API must not hold up the redirect
 * after signing in. `?wait` draws the page the old way, every widget loaded
 * first, for a browser without JavaScript.
 */
export function mountDashboard(app: Hono<GeekityEnv>, options: { render: AdminRender }): void {
  const { render } = options;
  const widgetBoard = createWidgetBoard({ timeLimitMs: WIDGET_TIME_LIMIT_MS });

  app.get(ADMIN_PREFIX, async (c) => {
    const timezone = c.var.siteAtRequestStart.timezone;
    const period = dashboardPeriod(c.req.query('period'));
    const wait = c.req.query('wait') !== undefined;
    const layout = layoutOf(c);
    const all = dashboardWidgets(c.var, CORE_WIDGETS, period);
    const activity = all.filter((entry) => entry.placement === 'activity');
    const byKey = new Map(activity.map((entry) => [keyOf(entry), entry]));
    const columns = arrangeColumns([...byKey.keys()], layout);
    const arranged = [...columns[0], ...columns[1]];
    const shown = arranged.filter((key) => !layout.removed.includes(key));
    const loading = all.filter(
      (entry) =>
        entry.placement === 'alerts' ||
        (shown.includes(keyOf(entry)) && !layout.collapsed.includes(keyOf(entry))),
    );
    const slots = wait
      ? await waitedSlots(widgetBoard, loading, c.var.config.now)
      : keptSlots(widgetBoard, loading, c.var.config.now);

    const drawn = drawnIn(timezone);
    const slotView = (entry: WidgetLoad, slot: WidgetSlot) => ({
      key: keyOf(entry),
      title: entry.widget.title,
      ...(slot.widget === undefined ? {} : drawn(slot.widget)),
      loading: slot.widget === undefined,
      loadUrl: slot.fetchInBrowser ? widgetUrl(keyOf(entry), period) : undefined,
    });
    const cardsIn = (column: readonly string[]) =>
      column.flatMap((key) => {
        if (layout.removed.includes(key)) return [];
        const entry = byKey.get(key) as WidgetLoad;
        if (layout.collapsed.includes(key)) {
          return [{ key, title: entry.widget.title, collapsed: true }];
        }
        const slot = slots.get(key);
        return slot === undefined ? [] : [{ ...slotView(entry, slot), collapsed: false }];
      });
    const left = cardsIn(columns[0]);
    const right = cardsIn(columns[1]);
    const drawnKeys = [...left, ...right].map((card) => card.key);

    return render(c, ADMIN_TEMPLATES.dashboard, {
      section: 'dashboard',
      child: 'home',
      periods: DASHBOARD_PERIODS.map((days) => ({
        label: `${String(days)} days`,
        url: dashboardUrl(days, wait),
        current: days === period,
      })),
      period: period === 7 ? '' : String(period),
      wait,
      waitUrl: [...slots.values()].some((slot) => slot.fetchInBrowser)
        ? dashboardUrl(period, true)
        : undefined,
      counts: c.var.store.counts(),
      // The one number on the dashboard that is not about the content
      // directory: it is what says whether publishing is reaching anybody.
      followers: c.var.admin.countFollowers(),
      federationUrl: FEDERATION_PATH,
      // The other number that is not about the content directory: with no
      // email in this milestone, the dashboard is how a moderator finds out
      // that somebody is waiting.
      pendingComments: pendingComments(c.var.admin),
      commentsUrl: COMMENTS_PATH,
      // And what the contact form has left waiting, which is the same kind of
      // number for the same reason.
      unreadMessages: unreadMessages(c.var.config.dataDir),
      messagesUrl: MESSAGES_PATH,
      alerts: loading.flatMap((entry) => {
        const slot = entry.placement === 'alerts' ? slots.get(keyOf(entry)) : undefined;
        return slot === undefined ? [] : [slotView(entry, slot)];
      }),
      arrangeable: byKey.size > 0,
      columns: [
        { side: 'left', cards: positionedInColumn(left, 'left', drawnKeys) },
        { side: 'right', cards: positionedInColumn(right, 'right', drawnKeys) },
      ],
      removed: arranged
        .filter((key) => layout.removed.includes(key))
        .map((key) => ({ key, title: (byKey.get(key) as WidgetLoad).widget.title })),
      layoutUrl: DASHBOARD_LAYOUT_PATH,
    });
  });

  app.post(DASHBOARD_LAYOUT_PATH, async (c) => {
    const body = await c.req.parseBody({ all: true });
    const back = dashboardUrl(
      dashboardPeriod(stringOrEmpty(body['period'])),
      body['wait'] !== undefined,
    );
    const userId = c.var.session?.userId;
    if (userId == null) return c.redirect(back, 303);

    const change = layoutChange(body);
    if (change !== undefined) {
      const keys = dashboardWidgets(c.var, CORE_WIDGETS, 7)
        .filter((entry) => entry.placement === 'activity')
        .map(keyOf);
      await setUserDashboardLayout({
        dataDir: c.var.config.dataDir,
        userId,
        layout: changeLayout(layoutOf(c), change, keys),
      });
    }
    return c.redirect(back, 303);
  });

  app.get(DASHBOARD_WIDGET_PATH, async (c) => {
    const period = dashboardPeriod(c.req.query('period'));
    const key = c.req.query('key');
    const entry = dashboardWidgets(c.var, CORE_WIDGETS, period).find((each) => keyOf(each) === key);
    if (entry === undefined) return c.notFound();
    const [widget] = await widgetBoard.load([entry], c.var.config.now);
    if (widget === undefined) return c.body(null, 204);
    return render(c, ADMIN_TEMPLATES.dashboardWidget, {
      widget: drawnIn(c.var.siteAtRequestStart.timezone)(widget),
    });
  });
}

interface WidgetSlot {
  readonly widget: LoadedWidget | undefined;
  readonly fetchInBrowser: boolean;
}

async function waitedSlots(
  board: WidgetBoard,
  entries: readonly WidgetLoad[],
  now: Clock,
): Promise<Map<string, WidgetSlot>> {
  const loaded = await board.load(entries, now, PAGE_WAIT_MS);
  return new Map(loaded.map((widget) => [widget.key, { widget, fetchInBrowser: false }]));
}

function keptSlots(
  board: WidgetBoard,
  entries: readonly WidgetLoad[],
  now: Clock,
): Map<string, WidgetSlot> {
  return new Map(
    entries.flatMap((entry): [string, WidgetSlot][] => {
      const kept = board.kept(entry, now);
      const widget = kept !== undefined && kept.widget.blocks.length > 0 ? kept.widget : undefined;
      const fetchInBrowser = kept === undefined || kept.due;
      return !fetchInBrowser && widget === undefined
        ? []
        : [[keyOf(entry), { widget, fetchInBrowser }]];
    }),
  );
}

function drawnIn(timezone: string) {
  return (widget: LoadedWidget) => ({
    ...widget,
    loadedAt:
      widget.loadedAt === undefined
        ? undefined
        : formatInTimezone(widget.loadedAt.toISOString(), timezone),
  });
}

function widgetUrl(key: string, period: DashboardPeriod): string {
  return `${DASHBOARD_WIDGET_PATH}?${new URLSearchParams({ key, period: String(period) }).toString()}`;
}

function positionedInColumn<Card extends { key: string }>(
  cards: readonly Card[],
  side: 'left' | 'right',
  shown: readonly string[],
) {
  return cards.map((card, index) => ({
    shown,
    ...card,
    side,
    first: index === 0,
    last: index === cards.length - 1,
  }));
}

function keyOf(entry: WidgetLoad): string {
  return widgetKey(entry.owner, entry.widget.id);
}

function dashboardUrl(days: DashboardPeriod, wait: boolean): string {
  const query = new URLSearchParams();
  if (days !== 7) query.set('period', String(days));
  if (wait) query.set('wait', '1');
  return query.size === 0 ? ADMIN_PREFIX : `${ADMIN_PREFIX}?${query.toString()}`;
}

function layoutOf(c: Context<GeekityEnv>): DashboardLayout {
  const userId = c.var.session?.userId;
  if (userId == null) return EMPTY_LAYOUT;
  return findUserById(c.var.config.dataDir, userId)?.dashboardLayout ?? EMPTY_LAYOUT;
}

function layoutChange(body: Record<string, unknown>): LayoutChange | undefined {
  const action = LAYOUT_ACTIONS.find((each) => each === stringOrEmpty(body['action']));
  if (action === undefined) return undefined;
  if (action === 'order') return { action, columns: [listOf(body['left']), listOf(body['right'])] };
  const key = stringOrEmpty(body['widget']);
  if (action === 'earlier' || action === 'later' || action === 'left' || action === 'right') {
    const cardsOnPage = listOf(body['shown']);
    return cardsOnPage.length === 0 ? { action, key } : { action, key, cardsOnPage };
  }
  return { action, key };
}

function listOf(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter(
    (key): key is string => typeof key === 'string',
  );
}
