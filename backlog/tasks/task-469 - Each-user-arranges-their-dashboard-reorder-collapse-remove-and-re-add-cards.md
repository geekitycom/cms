---
id: TASK-469
title: 'Each user arranges their dashboard: reorder, collapse, remove and re-add cards'
status: To Do
assignee: []
created_date: '2026-10-21 17:57'
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
- [ ] #1 Each widget card can be moved earlier or later in the dashboard, by drag and drop and by keyboard-reachable move controls; the new order persists across reloads
- [ ] #2 Each card can be collapsed to its title bar and expanded again; a collapsed card stays collapsed after reload, and its widget is not loaded while it is collapsed
- [ ] #3 Each card can be removed from the dashboard; a removed card no longer draws and its widget is not loaded
- [ ] #4 A gear control on the dashboard lists every removed card by title and adds a chosen card back; the control says so when nothing is removed
- [ ] #5 The arrangement is stored per user on the server; two users on one site each see their own arrangement, and a user with no saved arrangement sees the current default order
- [ ] #6 A widget the saved arrangement doesn't mention (new core widget, newly enabled plugin) draws in its default position; a saved entry for a widget that no longer exists (disabled or removed plugin) is ignored and doesn't break the page
- [ ] #7 Without JavaScript the dashboard still draws in the saved arrangement, and the collapse, remove and re-add actions work as plain form posts
- [ ] #8 Changes use the admin's CSRF protection and work on a phone-width screen
- [ ] #9 Tests cover the saved order, collapse, remove, re-add, per-user separation and unknown or vanished widget ids
- [ ] #10 docs describe arranging the dashboard, and docs/plugins.md notes that users can reorder, collapse or remove plugin widgets
<!-- AC:END -->
