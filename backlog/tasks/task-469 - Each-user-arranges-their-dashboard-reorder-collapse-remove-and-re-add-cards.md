---
id: TASK-469
title: 'Each user arranges their dashboard: reorder, collapse, remove and re-add cards'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 17:57'
updated_date: '2026-10-21 18:59'
labels:
  - admin
  - dashboard
milestone: m-43
dependencies: []
references:
  - >-
    backlog/decisions/decision-59 -
    Plugins-add-tags-to-public-pages-and-widgets-to-the-dashboard-through-declarative-contributions-the-core-draws.md
  - packages/cms/admin/pages/dashboard/home.njk
  - packages/cms/src/admin/core-widgets.ts
  - packages/cms/src/site/users.ts
ordinal: 403800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The dashboard (GET /admin) draws the stat tiles, then core widgets, then plugin widgets in enabled-plugin order (TASK-444, decision-59). With the M42 core cards and the Umami plugin cards there is a lot on it, and the person using it has no say over what shows or where. Each signed-in user should be able to put the cards in their own order, collapse a card to just its title bar, and remove a card they don't want. A gear (settings) control on the dashboard lists the cards that are removed so the user can add them back. The arrangement belongs to the user, like their admin theme, and is kept on the server so it follows them across browsers. Widgets added later (a new core card, or a newly enabled plugin) still appear for everyone without anyone having to re-add them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each widget card can be moved earlier or later in the dashboard, by drag and drop and by keyboard-reachable move controls; the new order persists across reloads
- [x] #2 Each card can be collapsed to its title bar and expanded again; a collapsed card stays collapsed after reload, and its widget is not loaded while it is collapsed
- [x] #3 Each card can be removed from the dashboard; a removed card no longer draws and its widget is not loaded
- [x] #4 A gear control on the dashboard lists every removed card by title and adds a chosen card back; the control says so when nothing is removed
- [x] #5 The arrangement is stored per user on the server; two users on one site each see their own arrangement, and a user with no saved arrangement sees the current default order
- [x] #6 A widget the saved arrangement doesn't mention (new core widget, newly enabled plugin) draws in its default position; a saved entry for a widget that no longer exists (disabled or removed plugin) is ignored and doesn't break the page
- [x] #7 Without JavaScript the dashboard still draws in the saved arrangement, and the collapse, remove and re-add actions work as plain form posts
- [x] #8 Changes use the admin's CSRF protection and work on a phone-width screen
- [x] #9 Tests cover the saved order, collapse, remove, re-add, per-user separation and unknown or vanished widget ids
- [x] #10 docs describe arranging the dashboard, and docs/plugins.md notes that users can reorder, collapse or remove plugin widgets
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Model: src/site/dashboard-layout.ts holds DashboardLayout {order, collapsed, removed} of widget keys (owner:id), a parser that drops bad entries, arrangeCards(defaultKeys, layout) that puts saved keys first in saved order and slots unmentioned keys after their nearest earlier default neighbour, ignoring vanished keys, and changeLayout(layout, action, key, known) for collapse/expand/remove/restore/earlier/later/order.
2. Store it on the user in data/users.json as dashboardLayout, next to adminTheme: parsed in userFrom, kept by withoutHash, written by setUserDashboardLayout; an empty layout is not written.
3. widgets.ts: each WidgetLoad/LoadedWidget carries its key. GET /admin builds the activity loads, drops removed and collapsed ones before widgetBoard.load, and draws cards in arranged order; collapsed cards draw their title bar only. Alerts (Needs attention) and stat tiles stay fixed.
4. POST /admin/dashboard/layout (behind the guard's CSRF check) takes action + widget (or order list for drag and drop), saves, and 303s back to /admin keeping the period.
5. home.njk: each card has a form with Move earlier/later, Collapse/Expand and Remove buttons (aria-labelled); a gear dropdown (DaisyUI popover) lists removed cards with Add back, or says none are removed. button/dropdown macros get an ariaLabel parameter.
6. static/dashboard.js (plain ES5 like copy.js): adds drag handles, reorders cards on drag and drop, posts the new order with the CSRF token, and updates the move buttons' disabled state.
7. Tests first (dashboard-layout.test.ts unit + dashboard-arrange.test.ts over HTTP): saved order, collapse not loaded, remove not loaded, re-add, two users, unknown/vanished ids, CSRF refusal, no-JS forms.
8. Docs: docs/admin.md dashboard row, docs/plugins.md widgets note. Verify with the full check suite and Playwright on the demo (drag and drop, phone width screenshots).

9. Move buttons post the keys of the cards the page drew (shown), so a move steps past a card whose widget returned no blocks instead of swapping with an invisible one.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Model in packages/cms/src/site/dashboard-layout.ts (order/collapsed/removed of owner:id keys). arrangeCards puts a key the saved order omits after the last of the cards that precede it by default, so a newly enabled plugin's cards land at the end. Saved on the user as dashboardLayout in data/users.json (setUserDashboardLayout); an empty layout drops the field; bad entries are dropped on read like the other preferences.
The GET /admin handler moved from routes.ts to src/admin/dashboard.ts (mountDashboard), which also owns POST /admin/dashboard/layout (actions collapse, expand, remove, restore, earlier, later, order). Collapsed and removed cards are filtered out before widgetBoard.load. LoadedWidget now carries its key.
Only the Activity cards are arrangeable. The stat tiles and the Needs attention alert card (placement alerts) stay fixed: an alert you could remove would hide failures.
home.njk: one form per card with aria-labelled ↑ ↓ −/+ ✕ submit buttons; gear (⚙) DaisyUI popover dropdown lists removed cards with Add back, or says No cards are removed. button.njk and dropdown.njk gained an ariaLabel parameter.
static/dashboard.js (ES5, like copy.js) adds a ⠿ drag handle, reorders on HTML5 drag and drop (diagonal split of the hovered card decides before/after), posts action=order with the card form's CSRF token (redirect: manual), updates the move buttons' disabled state and announces the new position in a status region; a failed post reloads the page.
Existing assertions in dashboard-widgets.test.ts and plugin-umami/test/dashboard.test.ts were adjusted for the new control text and data attribute on the card wrapper.
decision-59 still says there is no per-user reordering yet; it is superseded on that point by this task and may want a note.
Browser check (Playwright + Chromium 1234 against a scratch copy of the demo content, fresh data dir): drag of Fediverse onto Recent interactions gave [followers, fediverse, ...], live region said 'Fediverse moved to position 2 of 5.', order survived reload; keyboard Enter on Move later moved the card; collapse, remove, gear listing and Add back worked; with JavaScript disabled at 375px, expand/remove/gear popover/Add back/collapse all worked; 375px width has 0 px horizontal overflow.

Validation: pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all pass (cms 6555 tests, 0 fail; umami 108, 0 fail). New tests: src/site/dashboard-layout.test.ts (11) and src/admin/dashboard-arrange.test.ts (10). Screenshots in the session scratchpad: 00-desktop-top, 02-desktop-gear, 03-phone, 04-phone-gear, 05-collapsed, 06-after-drag, 07-phone-nojs.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Each signed-in user can now arrange the dashboard's Activity cards: move earlier/later (aria-labelled buttons, plus drag and drop from static/dashboard.js), collapse to the title bar, remove, and add back from a gear dropdown that says when nothing is removed. The arrangement is saved per user in data/users.json as dashboardLayout (order, collapsed, removed of owner:id keys); unmentioned widgets take their default position, vanished ones are ignored, and collapsed or removed widgets are never loaded. Every action is a CSRF-protected form post to POST /admin/dashboard/layout that redirects back to /admin, so it works without JavaScript. The dashboard route moved to src/admin/dashboard.ts. Docs: docs/admin.md 'The dashboard' section and route row, docs/plugins.md note. Verified with the full check suite, new unit and HTTP tests, and Playwright on a scratch demo site (drag and drop with reload, keyboard move, no-JS at 375px, no horizontal overflow).
<!-- SECTION:FINAL_SUMMARY:END -->
