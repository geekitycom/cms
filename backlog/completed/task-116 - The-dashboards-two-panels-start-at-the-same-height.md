---
id: TASK-116
title: The dashboard's two panels start at the same height
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 19:10'
updated_date: '2026-09-20 19:11'
labels:
  - admin
  - web
dependencies: []
references:
  - packages/cms/admin/static/admin.css
  - packages/cms/admin/pages/dashboard/home.njk
  - packages/cms/admin/pages/federation/followers.njk
  - packages/cms/src/admin/styles.test.ts
type: bug
ordinal: 140800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On the dashboard, Recent posts starts lower than At a glance, so the two boxes look misaligned even though they are side by side in one grid row.

`admin.css:700` says:

    .admin-panel + .admin-panel { margin-top: 1.5rem; }

That is for the Followers screen, where panels stack in normal flow and need space between them. On the dashboard the two panels are siblings inside `.admin-panels`, a grid that already has `gap: 1rem` and `align-items: start` — so the adjacent-sibling rule also matches there and pushes the second panel down inside its own grid cell, by an amount that has nothing to do with the layout it is in.

A panel in the grid needs no margin of its own: the grid's gap is the space between them, in both directions, and it already applies when the row wraps to one column on a narrow screen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Both dashboard panels' boxes start at the same height, proven by a test
- [x] #2 Panels that stack in normal flow, as on the Followers screen, still have space between them, proven by a test
- [x] #3 The panels are still spaced when the dashboard grid wraps to one column
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
One selector changed. `.admin-panel + .admin-panel` became `:not(.admin-panels) > .admin-panel + .admin-panel`, so the rule reaches the panels that stack in normal flow — the Followers screen's five — and not the two the dashboard grid is laying out. The grid's own `gap: 1rem` is the space between its cells in both directions, so a row that wraps to one column on a narrow screen is spaced by the same rule that spaces the columns.

The test asserts there is exactly one rule giving a stacked panel a margin and that its selector excludes the grid, rather than asserting the selector's text, so a later rewrite that keeps the meaning does not fail it. Checked red before the change and green after: with the `:not()` removed the test fails on the selector assertion.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Recent posts started lower than At a glance because an unscoped adjacent-sibling rule written for the Followers screen's stacked panels also matched the dashboard's two, pushing the second down inside its own grid cell on top of the grid's gap. The rule now names the panels it is for.
<!-- SECTION:FINAL_SUMMARY:END -->
