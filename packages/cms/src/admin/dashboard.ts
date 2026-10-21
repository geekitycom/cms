import type { Context, Hono } from 'hono';

import type { DashboardPeriod } from '../plugin.ts';
import type { GeekityEnv } from '../web/env.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import {
  arrangeCards,
  changeLayout,
  EMPTY_LAYOUT,
  LAYOUT_ACTIONS,
} from '../site/dashboard-layout.ts';
import type { DashboardLayout, LayoutChange } from '../site/dashboard-layout.ts';
import { findUserById, setUserDashboardLayout } from '../site/users.ts';
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
  WIDGET_TIME_LIMIT_MS,
  widgetKey,
} from './widgets.ts';
import type { LoadedWidget, WidgetLoad } from './widgets.ts';

export const DASHBOARD_LAYOUT_PATH = `${ADMIN_PREFIX}/dashboard/layout`;

/**
 * The dashboard: the stat tiles, the alert cards, and the activity cards in
 * the order the signed-in user arranged them. Collapsed and removed cards are
 * never handed to the widget board, so their widgets do not load.
 */
export function mountDashboard(app: Hono<GeekityEnv>, options: { render: AdminRender }): void {
  const { render } = options;
  const widgetBoard = createWidgetBoard({ timeLimitMs: WIDGET_TIME_LIMIT_MS });

  app.get(ADMIN_PREFIX, async (c) => {
    const timezone = c.var.siteAtRequestStart.timezone;
    const period = dashboardPeriod(c.req.query('period'));
    const layout = layoutOf(c);
    const all = dashboardWidgets(c.var, CORE_WIDGETS, period);
    const activity = all.filter((entry) => entry.placement === 'activity');
    const byKey = new Map(activity.map((entry) => [keyOf(entry), entry]));
    const arranged = arrangeCards([...byKey.keys()], layout);
    const shown = arranged.filter((key) => !layout.removed.includes(key));
    const loading = all.filter(
      (entry) =>
        entry.placement === 'alerts' ||
        (shown.includes(keyOf(entry)) && !layout.collapsed.includes(keyOf(entry))),
    );
    const loaded = new Map(
      (await widgetBoard.load(loading, c.var.config.now)).map((widget) => [widget.key, widget]),
    );

    const drawn = (widget: LoadedWidget) => ({
      ...widget,
      loadedAt:
        widget.loadedAt === undefined
          ? undefined
          : formatInTimezone(widget.loadedAt.toISOString(), timezone),
    });
    const cards = shown.flatMap((key) => {
      const { widget } = byKey.get(key) as WidgetLoad;
      if (layout.collapsed.includes(key)) {
        return [{ key, title: widget.title, width: widget.width, collapsed: true }];
      }
      const result = loaded.get(key);
      return result === undefined ? [] : [{ ...drawn(result), collapsed: false }];
    });
    const placed = positionedAmongDrawn(cards);

    return render(c, ADMIN_TEMPLATES.dashboard, {
      section: 'dashboard',
      child: 'home',
      periods: DASHBOARD_PERIODS.map((days) => ({
        label: `${String(days)} days`,
        url: periodUrl(days),
        current: days === period,
      })),
      period: period === 7 ? '' : String(period),
      counts: c.var.store.counts(),
      // The one number on the dashboard that is not about the content
      // directory: it is what says whether publishing is reaching anybody.
      followers: c.var.admin.countFollowers(),
      federationUrl: FEDERATION_PATH,
      // The other number that is not about the content directory: with no
      // email in this milestone, the dashboard is how a moderator finds out
      // that somebody is waiting (TASK-50).
      pendingComments: pendingComments(c.var.admin),
      commentsUrl: COMMENTS_PATH,
      // And what the contact form has left waiting, which is the same kind of
      // number for the same reason (TASK-56).
      unreadMessages: unreadMessages(c.var.config.dataDir),
      messagesUrl: MESSAGES_PATH,
      alerts: [...loaded.values()].filter((widget) => widget.placement === 'alerts').map(drawn),
      arrangeable: byKey.size > 0,
      widgets: placed,
      removed: arranged
        .filter((key) => layout.removed.includes(key))
        .map((key) => ({ key, title: (byKey.get(key) as WidgetLoad).widget.title })),
      layoutUrl: DASHBOARD_LAYOUT_PATH,
    });
  });

  app.post(DASHBOARD_LAYOUT_PATH, async (c) => {
    const body = await c.req.parseBody({ all: true });
    const back = periodUrl(dashboardPeriod(stringOrEmpty(body['period'])));
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
}

function positionedAmongDrawn<Card extends { key: string }>(cards: readonly Card[]) {
  const drawnKeys = cards.map((card) => card.key);
  return cards.map((card, index) => ({
    shown: drawnKeys,
    ...card,
    first: index === 0,
    last: index === cards.length - 1,
  }));
}

function keyOf(entry: WidgetLoad): string {
  return widgetKey(entry.owner, entry.widget.id);
}

function periodUrl(days: DashboardPeriod): string {
  return days === 7 ? ADMIN_PREFIX : `${ADMIN_PREFIX}?period=${String(days)}`;
}

function layoutOf(c: Context<GeekityEnv>): DashboardLayout {
  const userId = c.var.session?.userId;
  if (userId == null) return EMPTY_LAYOUT;
  return findUserById(c.var.config.dataDir, userId)?.dashboardLayout ?? EMPTY_LAYOUT;
}

function layoutChange(body: Record<string, unknown>): LayoutChange | undefined {
  const action = LAYOUT_ACTIONS.find((each) => each === stringOrEmpty(body['action']));
  if (action === undefined) return undefined;
  if (action === 'order') return { action, keys: listOf(body['order']) };
  const key = stringOrEmpty(body['widget']);
  if (action === 'earlier' || action === 'later') {
    const shown = listOf(body['shown']);
    return shown.length === 0 ? { action, key } : { action, key, shown };
  }
  return { action, key };
}

function listOf(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter(
    (key): key is string => typeof key === 'string',
  );
}
