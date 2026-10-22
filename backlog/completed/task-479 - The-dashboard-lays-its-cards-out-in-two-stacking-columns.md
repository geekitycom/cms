---
id: TASK-479
title: The dashboard lays its cards out in two stacking columns
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 11:50'
updated_date: '2026-10-22 12:04'
labels:
  - admin
  - dashboard
dependencies: []
references:
  - packages/cms/src/site/dashboard-layout.ts
  - packages/cms/src/admin/dashboard.ts
  - packages/cms/admin/pages/dashboard/home.njk
  - packages/cms/admin/static/dashboard.js
ordinal: 404800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The dashboard grid (TASK-444, TASK-469, TASK-470) draws cards in rows of two, so a short card beside a tall one leaves a gap under it until the next row. Instead the dashboard should be two columns, each an ordered stack of cards, so a card sits directly under the one above it in its column. Each user's arrangement (TASK-469, stored per user as dashboardLayout) becomes a position in a column: which column a card is in and its place in that column. Reorder, collapse, remove and re-add keep working; moving gains a way to send a card to the other column, by button and by drag and drop. Widget width no longer decides the layout: every card sits in a column; plugins may still declare width so none break, and docs/plugins.md says it no longer changes the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On a wide screen the dashboard draws two columns that stack independently: a card's top sits under the card above it in the same column, with no row gaps
- [x] #2 With no saved arrangement, cards fill the columns in the default order, alternating left and right
- [x] #3 A card can move up or down within its column and to the other column, by buttons that work without JavaScript and by drag and drop (including dropping into an empty column); the arrangement persists across reloads
- [x] #4 A widget the saved arrangement doesn't mention goes at the end of the column with fewer cards; saved ids for widgets that no longer exist are ignored
- [x] #5 An arrangement saved before this change (a single order) is read as columns, alternating in that order, so nobody loses their order
- [x] #6 Collapse, remove and re-add keep working; a re-added card returns to the column it was in, or the shorter column
- [x] #7 On a narrow screen the columns become one: the left column's cards, then the right column's; no horizontal scroll at phone width
- [x] #8 Tests cover column placement, moves within and across columns, defaults, new and vanished widgets and the old layout format; docs/admin.md and docs/plugins.md describe the columns and that width no longer changes the layout
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Model (src/site/dashboard-layout.ts): DashboardLayout becomes {columns: [left, right], collapsed, removed}. arrangeColumns(defaults, layout) keeps saved keys in their column and order, drops vanished keys, and appends each unmentioned key to the column with fewer non-removed cards (ties go left), so no saved layout alternates left/right in default order.
2. Read-time migration: dashboardLayout() reads an old {order} as columns alternating in that order; the next save writes columns.
3. changeLayout materialises the arranged columns before every change, so collapse/remove/restore never reshuffle and a removed card keeps its column for Add back. Actions: earlier/later step past drawn neighbours in the card's own column (shown list); left/right move the card to the other column at the same drawn position (or the end); order takes left and right lists from drag and drop, keeping undrawn keys at the end of their old column.
4. src/admin/dashboard.ts: build two columns of cards, first/last per column, shown = every drawn key, column side for the ←/→ button.
5. home.njk: a two-column grid (one column below @3xl) of two flex stacks, data-dashboard-column; each card form gets ← or → (aria-labelled, the other hidden). Width no longer affects layout.
6. static/dashboard.js: drag across columns (drop on a card by vertical midpoint, or into a column's empty space/empty column to append), post action=order with left/right, update ↑↓ disabled state and swap the ←/→ button.
7. Tests first: unit tests for placement, moves, defaults, new/vanished widgets, old format; HTTP tests in dashboard-arrange.test.ts.
8. Docs: docs/admin.md dashboard section, docs/plugins.md width row and note; note on decision-59 only if needed. Verify full check suite and Playwright at 1440px and 375px, drag across columns, no-JS buttons.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Model: DashboardLayout is now {columns: [left, right], collapsed, removed} (src/site/dashboard-layout.ts). arrangeColumns appends each key no column mentions to the column with fewer non-removed cards (ties left), so with nothing saved the default order alternates. changeLayout saves the arranged columns before every change, so collapse/remove/restore never move other cards and a removed card keeps its column for Add back. New actions left/right move a card to the other column at the same place among drawn cards (or the end); earlier/later stay within the card's column and still step past only the cards in shown. action=order now takes left and right lists; a key drag and drop did not send (removed, or drew nothing) stays at the end of its old column. A saved {order} is read as columns alternating in that order and rewritten as columns on the next change.
Template: a grid of two flex stacks (data-dashboard-column left/right, one column below @3xl, min-h-24 on wide so an empty column is a drop target); width no longer adds col-span. Each card form has ← and → (aria-labelled, the one pointing at the card's own column hidden). dashboard.js drops by vertical midpoint on a card, or appends when over a column's empty space; after a save it updates ↑↓ disabled and swaps ←/→, and the live region names the column.
Stat tiles and the Needs attention card are untouched. dashboard-widgets.test.ts and plugin-umami/test/dashboard.test.ts asserted row order and pairing; they now assert the new buttons and the declared order within each column. decision-59 still says there is no per-user reordering (already stale since TASK-469); left as is.
Browser check (Playwright, Chromium 1234, scratch demo copy, fresh data dir): 1440px default columns [fediverse, recent, posting] / [followers, top-posts], gaps between cards in each column 24px (the gap-6), no row gaps. Drag of Fediverse into the empty space under the right column put it last there; live region 'Fediverse moved to position 3 of 3 in the right column.'; its → hidden, ← shown, ↓ disabled; survived reload. Drag of a right card above the left top card worked and survived reload. ← emptied the right column (box 548x1719), then a drag into the empty column worked and survived reload. 375px: one column, left cards then right, 0px horizontal overflow. JavaScript off at 375px: no drag handles; →, ↓, ←, remove and Add back all worked as form posts. Screenshots: /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/6a060831-b4e0-52c3-bff4-8be06572e5ab/scratchpad/479-01-wide.png, 479-02-wide-empty-right.png, 479-03-wide-after-moves.png, 479-04-phone.png, 479-05-phone-nojs.png, 479-06-wide-nojs.png.
Validation: pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all pass (cms 6617 tests, umami 108, 0 failures).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The dashboard's activity cards now sit in two columns that stack independently, so a short card no longer leaves a gap under it. Each user's dashboardLayout holds columns (left and right lists of card keys) plus collapsed and removed; with nothing saved the default order alternates left and right, a new widget goes to the end of the column with fewer cards, vanished keys are ignored, and an old single order is read as alternating columns and rewritten on the next save. Cards move up and down their column (↑ ↓, stepping past only drawn cards) and to the other column (← / →, plain form posts), and by drag and drop across columns, including into an empty column. Collapse, remove and Add back keep working, and a re-added card returns to its column. Widget width is still accepted but no longer changes the layout; docs/admin.md and docs/plugins.md say so. Verified with new unit and HTTP tests, the full check suite, and Playwright at 1440px and 375px with and without JavaScript.
<!-- SECTION:FINAL_SUMMARY:END -->
