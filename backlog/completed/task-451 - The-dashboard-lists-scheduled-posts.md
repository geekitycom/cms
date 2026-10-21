---
id: TASK-451
title: The dashboard lists scheduled posts
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-21 01:05'
labels:
  - dashboard
  - content
milestone: m-41
dependencies:
  - TASK-444
references:
  - packages/cms/src/content/schedule.ts
priority: medium
ordinal: 388800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post with a future date is scheduled. List the next ones to publish so the owner sees what is queued.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The widget lists the next five scheduled posts with their publish time in the site time zone, each linking to the editor
- [x] #2 With nothing scheduled, the widget draws nothing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Content index: add CatalogReader.listScheduledPosts(limit) — posts not drafts, not trashed, dated after the index clock (SCHEDULED_CLAUSE), soonest first; store test.
2. Move the interactions widget's short day-and-time helper into admin/formatting.ts as formatShortTime and use it from both widgets.
3. New core widget admin/widget-scheduled.ts (id scheduled-posts, title Scheduled posts, full width, no placement): table of the next five with title linking to documentEditorPath(POST_SCREENS, …) and the publish time in the site time zone; [] when nothing is scheduled. Add to CORE_WIDGETS last, after posting activity.
4. Tests first in admin/widget-scheduled.test.ts for AC #1 (five soonest, order, time zone, editor links, drafts/trash/past/pages left out) and AC #2 (no card).
5. docs/admin.md /admin row; run full checks and screenshots at 1280 and 390 px.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New content index query CatalogReader.listScheduledPosts(limit) (content/sqlite/catalog.ts): posts that are not drafts and not trashed with date_sort after the index clock (SCHEDULED_CLAUSE), soonest first, LIMIT bound. Unlisted scheduled posts are included, since the owner still publishes them.
Widget admin/widget-scheduled.ts (id scheduled-posts, title Scheduled posts, full width, refresh 60 s, no placement): a table Post | Publishes, the title from postLabel linking to documentEditorPath(POST_SCREENS, post), the time from formatShortTime in the site time zone; [] when nothing is waiting, so no card. It ignores the 7/30 period. Added last in CORE_WIDGETS, after Posting activity, full width so the half+half row of Followers and Recent interactions stays paired.
Posts only: the scheduling rule applies to any dated document, but pages are undated in practice and the criterion says posts.
The interactions widget's short day-and-time helper moved to admin/formatting.ts as formatShortTime and both widgets use it. It prints no year, so a post scheduled more than a year ahead reads like one this year.
Validation: pnpm build, pnpm test (cms 6479 pass, 0 fail), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Headless Chromium screenshots of a seeded site (7 posts, 6 scheduled) at 1280 and 390 px, light and dark: the card lists the five soonest in America/Chicago time with editor links, no horizontal scroll (scrollWidth 1265 / 390).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a Scheduled posts dashboard widget listing the next five posts waiting for their date, soonest first, with the publish time in the site time zone and a link to each post's editor; it draws no card when nothing is scheduled. Backed by a new CatalogReader.listScheduledPosts(limit) query; the short time formatter is now shared in admin/formatting.ts. Verified by widget-scheduled.test.ts (AC #1 order, time zone, links, drafts/trash/pages/past excluded; AC #2 no card), a store test for the query, the full build/test/typecheck/lint/format run, and screenshots at 1280 and 390 px.
<!-- SECTION:FINAL_SUMMARY:END -->
