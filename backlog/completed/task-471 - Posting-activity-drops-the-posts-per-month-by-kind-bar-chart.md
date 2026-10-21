---
id: TASK-471
title: Posting activity drops the posts-per-month-by-kind bar chart
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 22:45'
updated_date: '2026-10-21 22:49'
labels:
  - admin
  - dashboard
dependencies: []
references:
  - packages/cms/src/admin/widget-posting.ts
ordinal: 405800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Posting activity dashboard card draws a 52-week posts-per-day calendar and then a bar chart of posts per month by kind. The bar chart adds height without adding much, so the card should show only the calendar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Posting activity card draws the posts-per-day calendar and no bar chart
- [x] #2 Code that only fed the bar chart (kinds per month, kind labels) is removed
- [x] #3 Tests and any docs that describe the bar chart are updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Remove the bars block and the kind/month counting from widget-posting.ts; replace the bar-chart tests with one asserting the card has the calendar and no Posts per month chart; update docs/admin.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed KINDS, kindOf, the per-month counts and the bars block; the widget only reads posts since 52 weeks ago now. The kind-split tests went with the chart; a new test fails on the old code and passes on the new.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Posting activity now draws only the 52-week posts-per-day calendar. Verified with the widget's tests (the new no-bar-chart test failed before the change) and the full pnpm check set.
<!-- SECTION:FINAL_SUMMARY:END -->
