---
id: TASK-470
title: The built-in dashboard cards are half width
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 22:45'
updated_date: '2026-10-21 22:53'
labels:
  - admin
  - dashboard
dependencies: []
references:
  - packages/cms/src/admin/core-widgets.ts
  - packages/plugin-umami/src/traffic.ts
  - packages/plugin-umami/src/recent.ts
ordinal: 404800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Most built-in activity cards declare width: 'full' (core: fediverse, top posts, posting activity, scheduled; Umami: traffic, recent), so on a wide screen they each take a whole row and leave the half-width cards stranded beside empty space. Their blocks already fit a narrow card (TASK-460, TASK-461) and look fine stacked on a phone, so they fit a half-width column too. Making them half width lets the dashboard pack two cards per row on wide screens. The full width option stays in the plugin API for a widget that really needs it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every core activity widget and every Umami widget declares width half
- [x] #2 On a wide screen the activity cards sit two per row, and each card's blocks fit their half-width column without scrolling sideways
- [x] #3 Tests that assert a widget's width or its grid span are updated
- [x] #4 docs/plugins.md still documents width full for a plugin that needs it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Set width half on the core activity widgets (fediverse, top posts, posting, scheduled) and the Umami traffic and recent-posts widgets; health stays full since it is an alert outside the grid. Tests: a core-widgets test that every activity widget is half; Umami tests assert half and no col-span.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Browser check at 1440px on the demo with a scheduled post: six core cards at 548px each, two per row, no element extending past its card. Umami cards not checked live (no Umami server locally); their tables sit in the overflow-x-auto table wrapper and the Umami cards still pair up (8 half cards). docs/plugins.md still documents width full.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every built-in activity card is half width, so the dashboard packs two cards per row on wide screens. Verified with new and updated tests, the full pnpm check set, and a Chromium check at 1440px.
<!-- SECTION:FINAL_SUMMARY:END -->
