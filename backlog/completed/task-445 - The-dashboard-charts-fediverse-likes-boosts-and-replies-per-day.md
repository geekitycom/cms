---
id: TASK-445
title: 'The dashboard charts fediverse likes, boosts and replies per day'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-20 23:15'
labels:
  - dashboard
  - federation
milestone: m-41
dependencies:
  - TASK-444
references:
  - packages/cms/src/store/schema.ts
priority: medium
ordinal: 382800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The ap_inbox table logs incoming Like, Announce and replies with received_at. A core widget charts them per day over the last 7 days, with a 30-day option, so the owner sees how posts land on the fediverse.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A core widget draws likes, boosts and replies per day as named series for the last 7 days, and for 30 days when chosen
- [x] #2 An Undo of a like or boost removes it from the count, and duplicate deliveries of one activity count once
- [x] #3 Days with no activity show as zero, and days follow the site time zone
- [x] #4 Totals for the period show as stats with the change from the previous period
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Dashboard period: widgets.ts gains DASHBOARD_PERIODS (7, 30), DashboardPeriod and dashboardPeriod(query) (7 unless the query says 30). GET /admin reads ?period=, hands it to dashboardWidgets(vars, core, period); plugin widgets get {site, timezone, period}, core widgets load(vars, period); the board keys its kept result by owner, id and period. home.njk draws a 7 days / 30 days link pair (no JS) above the widgets. PluginWidgetContext gains period; docs/plugins.md says so. No HOST_API_VERSION bump.
2. Store: InboxStore.listInteractionsSince(since) returns each like, boost and reply received since an instant once (a like or boost per actor and object, a reply per note id, earliest arrival), leaving out a like or boost its actor Undid and a reply its actor Deleted. One SQL statement in store/inbox.ts.
3. Core widget src/admin/widget-fediverse.ts (id fediverse-activity, full width): days of the period in the site time zone ending today, reads interactions since the start of the previous period, buckets by calendarDayIn(receivedAt, timezone), draws stats Likes/Boosts/Replies with previous-period totals and a timeSeries with three named series, zero on empty days. Added to CORE_WIDGETS.
4. Tests first: store tests for undo, delete, duplicates, since; widget HTTP tests on GET /admin for 7 and 30 days, fallback to 7, zero days, time-zone day edge, stats with previous; board test that the period is part of the cache key.
5. Verify with the full suite, curl and a headless Chromium screenshot of /admin on a running site with seeded inbox rows.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: dashboard-wide period. DashboardPeriod (7 | 30) in src/plugin.ts; PluginWidgetContext gains `period`; src/admin/widgets.ts has DASHBOARD_PERIODS and dashboardPeriod(query) (7 unless the query is exactly `30`); CoreWidget.load(vars, period); WidgetLoad carries `period` and the board keys kept results by owner, id and period. GET /admin reads ?period= and home.njk draws an "Activity" heading with a 7 days / 30 days tabs nav (plain links, aria-current="page") above the widget grid. HOST_API_VERSION stays 3.
Store: InboxStore.listInteractionsSince(since) in src/store/inbox.ts (one SQL statement) returns {kind: like|boost|reply, receivedAt} oldest first: one like/boost per (type, actor, object) and one reply per note id at its earliest arrival; a like/boost undone by its own actor (Undo whose object is the activity id) and a reply deleted by its own actor (Delete whose object is the note id) are left out. Redelivery with the same activity id is already one row (unique index).
Widget: src/admin/widget-fediverse.ts (FEDIVERSE_WIDGET, id fediverse-activity, full, refresh 300 s), registered in CORE_WIDGETS. It reads interactions since midnight (site time zone) of the first day of the previous period, buckets by calendarDayIn(receivedAt, timezone) (received_at is a UTC ISO instant), and draws stats Likes/Boosts/Replies with previous-period totals and a timeSeries with three named series, every day present (zero when empty).
Decision: replies counted from ap_inbox only. comments rows with source activitypub are imports from before the site ran Geekity (store/comments.ts), so counting them would double count a reply also delivered here and date imports by their old publish times.
Tests: store/admin-store.test.ts (since, undo/delete by own actor only, redelivery and duplicate like once, reply once per note); admin/widgets.test.ts (period keys the cache, period reaches core and plugin loads, dashboardPeriod fallback); admin/widget-fediverse.test.ts (GET /admin: 7-day rows in America/Chicago incl. a 23:00 local like that is next day in UTC, zero days, totals with change, ?period=30, ?period=90 falls back to 7, tabs links, empty site all zeros). dashboard.test.ts helpers scoped to the At a glance section and to tables outside a chart's numbers.
Validation: pnpm build && pnpm test (cms 6420 pass, all packages 0 fail) && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all pass. Scratch site on :4445 with 199 seeded inbox log lines over 60 days in America/Chicago: curl /admin showed Likes 11 (from 10), Boosts 2 (from 6), Replies 5 (from 4); ?period=30 showed 50/63, 22/28, 18/17; ?period=abc fell back to 7. An independent Python bucketing of the log in America/Chicago gave the same numbers. Headless Chromium at 1280 px (7 and 30 days) and 390 px: chart, legend, stats and numbers table drawn, the current period tab marked, scrollWidth equal to the viewport. Server stopped by PID.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The dashboard has a period: 7 days by default, 30 via /admin?period=30 (tabs above the widgets, no JS), passed to core widgets as load(vars, period) and to plugin widgets as context.period, with results cached per widget and period; docs/plugins.md and docs/admin.md say so. A new core Fediverse widget charts likes, boosts and replies per day over the period in the site time zone, with each total against the previous period, from a new AdminStore query (listInteractionsSince) that drops undone likes/boosts and deleted replies and counts redeliveries and duplicate notes once. Verified with new store, board and GET /admin tests, the full build/test/typecheck/lint/format suite, curl against a seeded scratch site cross-checked by an independent count, and headless Chromium at 1280 and 390 px.
<!-- SECTION:FINAL_SUMMARY:END -->
