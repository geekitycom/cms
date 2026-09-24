---
id: TASK-126
title: >-
  Admin bar: a "Hoopla!" account menu in place of "Signed in as" and the Log out
  button
status: To Do
assignee: []
created_date: '2026-09-24 12:37'
updated_date: '2026-09-24 12:37'
labels:
  - admin
dependencies: []
ordinal: 150800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin bar (packages/cms/admin/layouts/shell.njk) ends with "Signed in as {username}" and a bare Log out button. Replace them with an account menu like the one WordPress puts at the right of its admin bar ("Howdy, Name" that opens a dropdown), but greeting with "Hoopla!" instead of "Howdy," because the site owner prefers it. The greeting uses the signed-in user's display name when they have one and their username when they do not. The dropdown holds a link to the user's own edit screen (/admin/users/<id>) and Log out. Log out is a POST with a CSRF token today and must stay one. The admin runs under a CSP of script-src 'self', so any script must be a self-hosted file. Several tests match "Signed in as ada" (accounts.test.ts, dashboard.test.ts, users.test.ts) and move with the markup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The admin bar reads "Hoopla! {display name}" for a user with a display name, and "Hoopla! {username}" for one without
- [ ] #2 "Signed in as" no longer appears in the admin
- [ ] #3 Activating the greeting opens a menu with a link to the user's own edit screen and Log out; activating it again, pressing Escape, or clicking elsewhere closes it
- [ ] #4 The menu opens and works with the keyboard alone, and a screen reader announces it as a collapsed/expanded control
- [ ] #5 Log out from the menu signs the user out with the same POST and CSRF check as today
- [ ] #6 Tests assert the greeting for both a named and an unnamed user, and that Log out still signs out
- [ ] #7 The menu works on a phone-width screen and matches the admin bar's look
<!-- AC:END -->
