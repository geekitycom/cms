---
id: TASK-15
title: 'Users screen: list, add, change password'
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-10
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Single admin role. /admin/users lists users; admins can add a user with a generated or supplied password and change their own password. Deleting the last user is refused.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An admin can add a user who can then log in
- [ ] #2 Changing a password invalidates other sessions for that user
- [ ] #3 Deleting the last remaining user is refused with a message
<!-- AC:END -->
