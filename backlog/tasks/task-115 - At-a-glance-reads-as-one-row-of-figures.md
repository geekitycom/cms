---
id: TASK-115
title: At a glance reads as one row of figures
status: To Do
assignee: []
created_date: '2026-09-20 18:29'
labels:
  - admin
  - web
dependencies: []
references:
  - packages/cms/admin/static/admin.css
  - packages/cms/admin/pages/dashboard/home.njk
type: bug
ordinal: 139800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The dashboard's At a glance panel puts its six counts at six different heights, with some labels broken across two lines, so it reads as a scatter rather than as a row.

Two causes, both in `.admin-counts` (admin.css:250):

    .admin-counts { display: flex; gap: 1.5rem; }
    .admin-counts div { display: flex; flex-direction: column-reverse; }

The container leaves `align-items` at `stretch`, so every cell is as tall as the tallest, and `column-reverse` packs a cell's content from the bottom. A cell whose label fits on one line therefore sits low, and one whose label wraps sits high: 'Published posts' wraps and its 2 is at the top of the row, while 'Drafts' does not and its 0 is halfway down.

The labels wrap because a cell is sized by its content with nothing to stop 'Published posts' or 'Comments waiting' breaking. The panel has room for them.

The numbers should sit on one line, with their labels under them, and the row should still behave on a narrow screen — the admin has no breakpoint for this panel today, so whatever is used should wrap as a row of cells rather than overflow.

`column-reverse` is there because a definition list is `dt` then `dd` and the number is the `dd`: the markup has to stay in that order and the number has to be drawn above the label. Keep that constraint; a grid with two rows would also satisfy it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every count's number sits on the same line as the others, whatever its label's length, proven by a test
- [ ] #2 A label is not broken across lines where the panel has room for it
- [ ] #3 The row wraps rather than overflowing when the panel is narrow
- [ ] #4 The markup stays a dl of dt then dd, with the number drawn above its label
<!-- AC:END -->
