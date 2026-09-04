---
id: TASK-54
title: 'Password recovery: user email addresses and a forgot-password flow'
status: To Do
assignee: []
created_date: '2026-09-04 01:42'
labels:
  - admin
  - email
milestone: m-8
dependencies:
  - TASK-9
  - TASK-15
  - TASK-53
references:
  - backlog/docs/doc-5 - Admin-UI.md
  - >-
    https://owasp.org/www-project-cheat-sheets/cheatsheets/Forgot_Password_Cheat_Sheet.html
type: feature
ordinal: 50500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Users have a username and a password hash and nothing else, so a forgotten password means `geekity user add` from a shell. Give each user an optional email address, edited on the users screen and by the user for their own account, and set by `geekity user add --email`. Add a Forgot password link on the login form leading to a form that takes a username or email and always answers the same way whether or not it matched. When it matches a user with an email, send a single-use reset link with a random token that expires in an hour, stored hashed with the sessions in the cache (a restart invalidates it, which is acceptable). The reset form sets a new password under the existing rules, invalidates the token and every other session for that user, and emails a confirmation. Requests are rate limited like login (TASK-47). Without mail configured, the link says recovery is not available and points at the CLI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A user can be given an email on the users screen and via geekity user add --email, and it is stored with the user
- [ ] #2 The forgot-password form answers identically for a known and an unknown username, and sends a reset link only when a user with an email matches
- [ ] #3 The reset link works once, expires after an hour, sets the password, signs out the user's other sessions and sends a confirmation
- [ ] #4 Repeated recovery requests are rate limited
- [ ] #5 With no mail configuration the form explains that recovery is unavailable and how to reset from the CLI
<!-- AC:END -->
