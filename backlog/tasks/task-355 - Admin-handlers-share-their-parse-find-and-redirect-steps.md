---
id: TASK-355
title: 'Admin handlers share their parse, find and redirect steps'
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-33
dependencies:
  - TASK-354
type: chore
ordinal: 314800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
users.ts has 8 POST handlers that each parse the body, find the user by id, and flash "That user is already gone." then redirect. media, plugins and federation repeat the shape. accounts.ts has 7 users.json mutators with the same let changed = false; write(...map...) bookkeeping.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 User routes resolve the target user through one shared step that owns the gone-user flash and redirect
- [ ] #2 users.json mutators go through one update-user function; each setter only states its transform
- [ ] #3 Flash wording and status codes for every existing admin POST are unchanged, shown by the existing tests
<!-- AC:END -->
