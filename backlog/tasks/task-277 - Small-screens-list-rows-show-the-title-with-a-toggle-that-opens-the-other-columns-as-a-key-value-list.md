---
id: TASK-277
title: >-
  Small screens: list rows show the title with a toggle that opens the other
  columns as a key-value list
status: To Do
assignee: []
created_date: '2026-10-05 10:14'
labels:
  - admin
  - daisyui
dependencies:
  - TASK-276
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: enhancement
ordinal: 236800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a phone the list screens scroll their table sideways inside its card, so Author, Tags, Categories, Date and Status are off screen and the reader pans to find them. The owner asked for the WordPress-style answer instead: below the breakpoint where the table no longer fits, each row shows only its first column (the title, with the row actions TASK-276 put under it) and a toggle arrow at the right edge; opening the toggle reveals the other columns under the title as a vertical key-value list, the column heading as the key and the cell as the value. At desktop width the table is unchanged. The toggle works with no JavaScript (a checkbox and label or an equivalent the admin already uses), has an accessible name that says which row it opens, and its state is exposed to assistive tech. The mechanism lives in the table macro or a convention its callers follow, so other list screens can adopt it; this task applies it to Posts and Pages.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On Posts and Pages below the lg breakpoint each row shows the title cell and a toggle at the right edge and no other column; the table does not scroll sideways and the page has no horizontal overflow at 390 wide
- [ ] #2 Opening a row's toggle shows every other column of that row under the title as a key-value list whose keys are the column headings and whose values are the cells, including the status badge; closing it hides them again; rows open and close independently
- [ ] #3 At 1280 wide the table is drawn exactly as before this task, with every column and no toggle
- [ ] #4 The toggle needs no JavaScript, carries an accessible name that names the row, exposes open or closed state, is reachable by Tab in order after the row's actions, and keyboard.test.ts passes
- [ ] #5 posts.test.ts, pages.test.ts and list-screens.test.ts pass; the mechanism is documented in doc-5 so another list screen can adopt it
- [ ] #6 Checked in headless Chrome at 390 and 1280 in a light and a dark theme, closed and open, with screenshots linked from the task
<!-- AC:END -->
