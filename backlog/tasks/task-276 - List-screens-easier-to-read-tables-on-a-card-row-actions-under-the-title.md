---
id: TASK-276
title: 'List screens easier to read: tables on a card, row actions under the title'
status: To Do
assignee: []
created_date: '2026-10-05 09:48'
labels:
  - admin
  - daisyui
dependencies: []
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: enhancement
ordinal: 235800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After M30 the list screens (Posts, Pages and the other tables) draw their rows straight on the shell's base-200 page background, and Posts and Pages put Edit, Move to trash (or Restore) and View in an Actions column at the far right of a wide table. The owner finds that hard to read and to navigate: the eye has no surface to rest on, and the action for a row is a long way from its title. Draw every table on a base-100 card surface through the table macro, so the change lands once for every list screen, and on Posts and Pages drop the Actions column in favour of WordPress-style row actions under the title, shown when the row is hovered or holds keyboard focus and always shown where there is no hover (a touch or narrow viewport), so a keyboard or phone user loses nothing. The actions stay real links and forms with the same names and values.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every table drawn through the table macro sits on a base-100 surface with padding and a shadow or border, not on the page's base-200 background; a table already inside a card (the dashboard's Recent posts) is not double-wrapped
- [ ] #2 On Posts and Pages the Actions column is gone; Edit, Move to trash or Restore, and View are drawn under the title in the first cell, revealed on the row's hover and on focus within the row, and always visible on a viewport without hover; posts.test.ts and pages.test.ts pass with the same action names and values
- [ ] #3 Keyboard: Tab reaches each row's actions in order after its title, the reveal happens on focus, and keyboard.test.ts passes; the table keeps its caption
- [ ] #4 Checked in headless Chrome at 390 and 1280 wide in a light and a dark theme: the card reads against the page, the actions appear on hover at 1280 and are always visible at 390, no horizontal overflow, and the screenshots are linked from the task
- [ ] #5 doc-5 says how a list screen is drawn: the card surface and the row actions
<!-- AC:END -->
