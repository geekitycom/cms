---
id: TASK-110
title: The users list looks like every other list
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 12:40'
updated_date: '2026-09-20 12:43'
labels:
  - admin
  - web
milestone: m-16
dependencies: []
references:
  - packages/cms/admin/pages/users/list.njk
  - packages/cms/admin/pages/documents/list.njk
  - packages/cms/src/admin/users.ts
  - packages/cms/src/admin/users.test.ts
type: task
ordinal: 135800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
/admin/users is the one listing in the admin that does not look like the others. `pages/documents/list.njk` is the pattern every other list follows: the first column links to the editor, and Actions holds plain text links — Edit, the action buttons, then View, which opens what the row is about on the public site.

The users list instead prints the author archive URL as a second line under the username, and styles Edit as `admin-button admin-button-small`. So the row is taller than it needs to be, the archive URL is shown as text where every other screen shows a word, and Edit looks like a different kind of thing from the Edit on a post.

Bring it into line: the username links to the edit screen and nothing sits under it, Actions holds Edit, Delete where the account can go, and View pointing at that person's archive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Actions holds Edit as a text link, Delete where the account is deletable, and View pointing at the author archive, proven by a test
- [x] #2 The archive URL is no longer printed under the username, and the username still links to the edit screen, proven by a test
- [x] #3 Edit is no longer styled as a button, so it matches the Edit on a post listing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
One template changed, packages/cms/admin/pages/users/list.njk: the archive URL came out from under the username, Edit lost its admin-button classes, and View was added after Delete so the cell reads Edit, then what can be done, then View — the order and shape pages/documents/list.njk uses.

Three tests added to users.test.ts. Two existing assertions moved with the markup: the comment saying 'Username with the archive under it' and the message on the /author/grace/ match, which now says the archive is still reachable rather than still under the name. The assertion itself is unchanged — the URL is still on the screen, in the actions instead.

Both of my first two tests were wrong before they were right, and worth recording: one matched the first actions cell rather than the last, so it looked for grace's Edit link in ada's row; the other asserted no admin-button anywhere on the screen, which fails on the Add new button that every listing has, this one included. The fixed tests take the last cell and scope the button check to the table.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The users listing now has the shape every other listing has: the username links to the edit screen with nothing under it, and the actions cell holds Edit as a plain link, Delete where the account can go, and View pointing at the author archive. Proven by three tests — the actions in order, the username cell holding nothing but the link, and no button styling inside the table.
<!-- SECTION:FINAL_SUMMARY:END -->
