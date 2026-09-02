---
id: TASK-9
title: 'Admin auth: users, sessions, login, first-run setup, CSRF'
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-1
  - TASK-3
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the auth section of doc-5. Users and sessions tables in SQLite, argon2id password hashing, HttpOnly Secure SameSite=Lax session cookie, CSRF token on mutating forms, login and logout routes, and a first-run setup form when no user exists.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Visiting /admin with no users shows a setup form that creates the first admin and logs them in
- [ ] #2 Wrong password on /admin/login returns the form with an error and no session
- [ ] #3 Unauthenticated requests to any /admin route other than login and setup redirect to /admin/login
- [ ] #4 A POST to an admin form without a valid CSRF token is rejected with 403
- [ ] #5 Logout invalidates the session server-side
- [ ] #6 Sessions expire after a configurable lifetime
<!-- AC:END -->
