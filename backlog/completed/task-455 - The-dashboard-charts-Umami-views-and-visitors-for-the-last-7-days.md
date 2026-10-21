---
id: TASK-455
title: The dashboard charts Umami views and visitors for the last 7 days
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
updated_date: '2026-10-21 03:55'
labels:
  - plugins
  - umami
  - dashboard
milestone: m-42
dependencies:
  - TASK-454
  - TASK-444
priority: medium
ordinal: 392800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The main Umami widget: views and visitors per day over the last 7 days, and headline stats (visitors, views, bounce rate, average visit time) with the change from the previous 7 days.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A full-width widget draws views and visitors per day for the last 7 days as two series, with days in the site time zone
- [x] #2 Visitors, views, bounce rate and average visit time show with the change from the previous 7 days
- [x] #3 With Umami unreachable, the widget shows its last good result marked stale, or unavailable, and the dashboard still draws
- [x] #4 The widget is absent while the plugin settings are incomplete
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core: optional stats format ('number' | 'percent' 0-100 | 'duration' seconds) in plugin.ts PluginBlock and src/admin/blocks.ts; the change text formats previous the same way. Tests in blocks.test.ts; docs/plugins.md Blocks row. No HOST_API_VERSION bump.
2. Plugin: src/traffic.ts, a widget 'traffic' (full width, refresh 300 s, 'Umami: views and visitors') built from the shared client. load({timezone, period}) returns [] when client.configured() is false; otherwise reads stats and pageviews for the period's days in the site time zone (midnight of the first day to the end of today), fills missing days with 0, and returns a stats block (Visitors, Views, Bounce rate = bounces/visits percent better down, Average visit time = totaltime/visits duration) with previous from Umami's comparison, then a timeSeries with Views and Visitors (pageviews.sessions). Failures throw.
3. Unit tests of the widget with a fixed clock against the fake Umami (days, range, timezone sent, zero fill, stats, 30-day period, unconfigured -> []).
4. Site tests through GET /admin: card drawn full width; absent while settings incomplete; Umami down -> Unavailable then Stale with the last good result while the rest of the dashboard draws.
5. Register in index.ts; update descriptions (docs/plugins.md table, README.md, package.json, plugin README, plugin description).
6. Full checks plus headless Chromium screenshots of /admin at 1280 and 390 px against the fake Umami.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Period: the widget follows context.period. 'Last 7 days' in the ACs is the default 7-day view; with ?period=30 it covers 30 days, compared with the 30 before. The range runs from midnight of the first day in the site time zone to the last millisecond of today, so Umami's comparison (same length just before) covers whole days.
Definitions follow Umami's own dashboard (WebsiteMetricsBar): bounce rate = min(bounces, visits) / visits, as a percent, better: down; average visit time = totaltime / visits in seconds; both 0 with no visits. Visitors = Umami's unique visitors: the stats 'visitors' total and the pageviews endpoint's per-day 'sessions' series, which Umami's own chart labels Visitors. Visits are not shown.
Core change inside this task: optional stats format 'number' | 'percent' (value 0-100, 41.5 is 41.5%) | 'duration' (seconds; drawn 42s, 1m 30s, 3h 5m) in plugin.ts PluginBlock and src/admin/blocks.ts; the change text writes previous in the same format; unknown format draws No data to show. blocks.njk needed no change (it prints the drawn string). No HOST_API_VERSION bump. Documented in docs/plugins.md Blocks.
Widget: src/traffic.ts, id traffic, full width, refreshSeconds 300, title 'Umami: views and visitors'. Returns [] while client.configured() is false; Umami errors propagate so the core shows Stale/unavailable. Missing days count 0. Time-zone midnight computed with Intl (no Temporal dep in the plugin); DST covered by tests.
Proof: no live Umami is available; the fake Umami on loopback (test/fake-umami.ts) is the proof. test/traffic.test.ts (widget with a fixed clock) and test/dashboard.test.ts (GET /admin through host.fetch, including Umami closed after a good load -> Stale with the last figures, Umami never answering -> unavailable, both with At a glance still drawn). test/site.ts gained timezone and now options.
Validation: pnpm build, pnpm test (cms 6509, plugin-umami 59, others all pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all exit 0. Headless Chromium screenshots of /admin at 1280 and 390 px against the fake: card spans the row at 1280, stats wrap to one column at 390, chart shows the zero-filled day.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the Umami 'views and visitors' dashboard widget (full width, follows the dashboard's 7/30-day period in the site time zone): visitors, views, bounce rate and average visit time with the change from the previous period, and a two-series chart of views and visitors per day with missing days as 0. It is absent while the settings are incomplete and throws on Umami failure so the core shows Stale or unavailable. Core gained an optional stats format (number, percent 0-100, duration in seconds) so the rates read properly. Verified against the fake Umami (no live Umami available) with unit and GET /admin tests, the full build/test/typecheck/lint/format run, and headless Chromium screenshots at 1280 and 390 px.
<!-- SECTION:FINAL_SUMMARY:END -->
