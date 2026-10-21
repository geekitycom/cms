---
id: TASK-444
title: Plugins and the core add widgets to the dashboard
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-20 22:49'
labels:
  - plugins
  - admin
  - dashboard
milestone: m-41
dependencies:
  - TASK-441
  - TASK-442
references:
  - >-
    backlog/decisions/decision-59 -
    Plugins-add-tags-to-public-pages-and-widgets-to-the-dashboard-through-declarative-contributions-the-core-draws.md
  - packages/cms/src/plugin.ts
  - packages/cms/src/plugins/registry.ts
priority: medium
ordinal: 381800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per decision-59, a widget has an id, a title, a width (full or half), a refresh interval and a load() that returns the declarative blocks. The core own cards in this milestone register through the same path. The dashboard draws the stat tiles, then core widgets, then plugin widgets in enabled-plugin order. Loads run in parallel under a time limit; the last good result is kept in memory for the refresh interval; a failure shows that result marked stale, or an unavailable message, and is logged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A plugin declares widgets in register and they draw on GET /admin below the core widgets, in enabled-plugin order
- [x] #2 Widgets load in parallel; a widget that runs past the time limit or throws shows unavailable (or its last good result marked stale) and the rest of the dashboard draws
- [x] #3 A widget result is reused for its refresh interval instead of loading on every dashboard request
- [x] #4 A disabled plugin widgets disappear without a restart, in line with plugin reload
- [x] #5 Full and half widths lay out in a responsive grid that stacks on narrow screens
- [x] #6 docs/plugins.md documents widgets, the block types and the failure behaviour, with an example plugin widget
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. plugin.ts: rename the block union to PluginBlock (PluginScreenBlock stays as an alias), add PluginWidget {id, title, width full|half, refreshSeconds, load(context)} and PluginWidgetContext {site, timezone}, and host.widget(widget). No HOST_API_VERSION bump (version 3 is unreleased).
2. registry.ts: widgets on PluginContributions and NOTHING_DECLARED; host.widget behind declaring(), refusing a bad id, a duplicate id, a width other than full/half and a refresh that is not a number of zero or more. registry.test.ts host-keys list gains widget.
3. src/admin/dashboard/widgets.ts: CoreWidget (same shape, load gets the request variables), a widget board created once per admin mount that loads every widget in parallel under a time limit, reuses a good result for its refresh interval, shares a load already in flight, keeps the last good result and draws it marked stale (or unavailable) when a load throws, returns something that is not an array, or runs out of time, logging each failure. A widget whose load returns no blocks draws no card. src/admin/dashboard/core-widgets.ts holds CORE_WIDGETS (empty until TASK-445).
4. GET /admin: core widgets, then each active plugin's widgets in [...activePlugins] order, so a disabled plugin's widgets go with no restart. home.njk draws them after the stat tiles in a container-query grid: half widths two across on a wide main area, full widths across both columns, one column when narrow.
5. Tests first: registry validation, board unit tests (order, parallel, timeout, throw, stale, refresh reuse, in-flight sharing, empty), HTTP tests on GET /admin (plugin widgets in enabled order, throwing widget, disable without restart).
6. docs/plugins.md: widgets section with example, failure behaviour, register list, version 3 sentence; docs/admin.md dashboard line if it describes the cards.
7. Verify with the full check suite, curl /admin on a running demo, and Playwright screenshots at desktop and phone widths.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: PluginBlock (PluginScreenBlock kept as an alias), PluginWidget/PluginWidgetContext and host.widget in src/plugin.ts; widgets on PluginContributions in src/plugins/registry.ts (id, duplicate, width and refreshSeconds checks fail register); src/admin/widgets.ts (CoreWidget, createWidgetBoard, dashboardWidgets, WIDGET_TIME_LIMIT_MS = 3000); src/admin/core-widgets.ts (CORE_WIDGETS, empty until TASK-445); GET /admin loads the board and home.njk draws a container-query grid after the stat tiles. HOST_API_VERSION stays 3.
Decisions: the last good result is kept for the life of the process and drawn as fresh within refreshSeconds, stale after a failed load; a load already running is shared, and a result that arrives after the time limit is kept; a load that returns an empty array draws no card (TASK-450 needs this); a load that returns a non-array counts as a failure. Core widgets' load gets the request variables (c.var), plugin widgets get {site, timezone}.
Validation: pnpm build && pnpm test (cms 6408 pass, all packages 0 fail), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. New tests: src/admin/widgets.test.ts (board: order, empty, parallel, throw/reject/timeout/non-array, refresh reuse, stale, in-flight sharing; dashboardWidgets core-first order and disabled plugin), src/admin/dashboard-widgets.test.ts (GET /admin: order below the tiles, throwing widget, reuse across requests, enable/disable via site.json without restart), registry.test.ts (widget validation, host keys). Ran a scratch site with a four-widget plugin on :4417: curl /admin with a session returned 200 with the widget text, anonymous got 302 to login, the server log carried the two failure warnings. Headless Chromium at 1280px: Visits (full) 960px wide, Top pages and Referrers side by side at 468px, Countries below; at 390px every card 358px wide in one column, document scrollWidth equal to viewport. Referrers drew the Stale badge on the second request, Countries said unavailable.
Seen, out of scope: on a phone the stats block of TASK-442 scrolls sideways inside its card when two stats with change lines are side by side.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Plugins declare dashboard widgets with host.widget({id, title, width, refreshSeconds, load}); the core declares its own in CORE_WIDGETS (src/admin/core-widgets.ts). GET /admin draws the stat tiles, then core widgets, then each running plugin's widgets in plugin run order, in a grid where half widgets pair up on a wide main area and everything stacks on a narrow one. The widget board loads all widgets in parallel under a 3 s limit, reuses a good result for refreshSeconds, shares in-flight loads, and on a throw, timeout or bad result logs a warning and draws the last good result with a Stale badge or an unavailable message. Disabled plugins' widgets go on the next request. docs/plugins.md documents widgets, blocks and failure behaviour with an example. Verified with new unit and HTTP tests, the full build/test/typecheck/lint/format suite, curl on a running site, and headless Chromium at 1280 and 390 px.
<!-- SECTION:FINAL_SUMMARY:END -->
