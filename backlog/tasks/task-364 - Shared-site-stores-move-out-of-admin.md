---
id: TASK-364
title: Shared site stores move out of admin
status: To Do
assignee: []
created_date: '2026-10-11 22:39'
labels: []
milestone: m-33
dependencies:
  - TASK-355
type: chore
ordinal: 323800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-352, micropub/ and content/ still import users (admin/accounts), site settings (admin/settings), uploads (admin/uploads) and media resolution (admin/media). These are site data and storage used by every authoring input, not admin screens, so the layering points the wrong way: content and micropub depend on the admin UI package.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No non-test module under content/ or micropub/ imports from admin/
- [ ] #2 Users, site settings and uploads live in modules outside admin/; admin keeps their screens and routes
- [ ] #3 Public exports from the package index keep working
- [ ] #4 Existing tests pass unchanged in behaviour
<!-- AC:END -->
