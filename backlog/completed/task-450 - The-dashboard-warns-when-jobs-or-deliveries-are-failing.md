---
id: TASK-450
title: The dashboard warns when jobs or deliveries are failing
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-21 00:56'
labels:
  - dashboard
  - federation
  - jobs
milestone: m-41
dependencies:
  - TASK-444
priority: medium
ordinal: 387800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Problems are now only visible on separate pages. A health widget appears only when something needs attention: failed or stuck jobs, failed federation deliveries, and failed outgoing webmentions, each with a count and a link.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With nothing failing, the widget draws nothing at all
- [x] #2 Failed jobs, jobs running longer than expected, failed federation deliveries and failed outgoing webmentions in the last 7 days each show with a count and a link to where they are handled
- [x] #3 Retried and later successful deliveries do not count as failures
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data: add JobQueue.list(states) (reconciles first when started, like latest) so the dashboard can read every recorded job; add AdminStore counts countFailedDeliveriesSince(since) on ap_deliveries and countFailedWebmentionsSince(since) on webmentions_sent (both upsert per pair, so a later successful retry or resend replaces the failed row); add countRetryingDeliveries(dataDir, since) in store/queue-database.ts: outbox messages in data/queue.sqlite with attempt >= 1 (Fedify failed them at least once and is retrying; a retry that succeeds leaves the queue).
2. Widget packages/cms/src/admin/widget-health.ts (id health, full width, refresh 60 s, not period-bound): over the last 7 days, per job name the failed or interrupted runs newer than its last finished run; jobs running for over an hour (no timeout notion exists in decision-54, so an hour is the threshold); recorded failed federation deliveries; deliveries Fedify is retrying; failed webmentions. One table (Problem link, Count). Returns [] when all are zero. Links: strip-metadata -> Maintenance #strip-metadata, resend -> Federation #resend, site-export -> Export, any other job -> Maintenance; deliveries and webmentions -> Federation #delivery (new id on the Delivery section).
3. Placement: CoreWidget gains optional placement 'alerts'; LoadedWidget carries it; the dashboard route splits alerts from activity widgets and home.njk draws alerts between At a glance and the Activity heading, in a warning-bordered card (new card tone modifier). Plugin widgets always go in Activity; plugin API unchanged.
4. Tests first (tdd): widget-health.test.ts for AC 1-3 through GET /admin; queue test for list.
5. Verify: pnpm build/test/test:11ty/typecheck/lint/format:check; headless Chromium screenshots at 1280 and 390 px with and without failures.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built a core widget, packages/cms/src/admin/widget-health.ts (id health, title Needs attention, full, refresh 60 s). Its load returns [] when nothing counts, so no card is drawn.

Data sources:
- Jobs: new JobQueue.list(states). Like latest, it reconciles first when the queue is started, so a job a dead worker left reads as queued again, not as stuck. For each job name, it counts the failed and interrupted runs of the last 7 days that are newer than that name's last finished run, so a later run that goes through clears them. Decision-54 has no timeout or stale notion, so 'running longer than expected' is a running job whose startedAt is over an hour old (LONG_RUNNING_MS).
- Federation: AdminStore.countFailedDeliveriesSince(since) on ap_deliveries. The row upserts per (activity, actor), so a resend that reaches the follower replaces the failure. With the default durable queue, Fedify's own retries never write back to ap_deliveries, so countRetryingDeliveries(dataDir, since) in store/queue-database.ts also counts outbox messages in data/queue.sqlite whose attempt is 1 or more (Fedify failed them at least once and is retrying). A retry that succeeds takes the message out of the queue, so it stops counting.
- Webmentions: AdminStore.countFailedWebmentionsSince(since) on webmentions_sent, which also upserts per (slug, target).

Links: strip-metadata goes to /admin/tools/maintenance#strip-metadata, resend to /admin/federation#resend (RESEND_PANEL is now exported), site.export to /admin/tools/export, and any other job name to Maintenance. Deliveries and webmentions go to /admin/federation#delivery, a new id on the Delivery section, which lists failed deliveries and webmentions per post with the Resend buttons.

Placement: CoreWidget has an optional placement 'alerts'. WidgetLoad and LoadedWidget carry the placement (plugin widgets are always 'activity', and the plugin API is unchanged). The route splits the board's result into alerts and widgets, and home.njk draws alerts between At a glance and the Activity heading. Decision-59 says the stat tiles stay at the top, and the card is not bound to a period, so it sits outside the 7/30 tabs. The card component has a new tone modifier: warning gives border-2 border-warning. The widget returns only declarative blocks: one table of link cells and counts. HEALTH_WIDGET is first in CORE_WIDGETS.

Docs: docs/admin.md /admin row.

Validation: pnpm build, test (cms 6476 pass), test:11ty, typecheck, lint and format:check all pass. A mutation check (dropping the later-success rule) fails the AC #3 test. Headless Chromium screenshots of two seeded servers at 1280 and 390 px in light and dark show the card above Activity with all six rows, and no card on the clean site. Neither layout scrolls horizontally.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a Needs attention card to the dashboard. It counts failed and interrupted jobs (failures since each job's last successful run), jobs running for over an hour, failed federation deliveries, deliveries Fedify is retrying in data/queue.sqlite, and failed webmentions, all over the last 7 days. Each row links to the screen where that problem is handled, and the card is drawn only when one count is above zero. It sits between the stat tiles and the Activity heading through a new core-only widget placement. Verified by widget-health.test.ts (AC 1-3 through GET /admin), new queue and widget-board tests, the full build/test/typecheck/lint/format suite, and Chromium screenshots at 1280 and 390 px with and without failures.
<!-- SECTION:FINAL_SUMMARY:END -->
