---
id: TASK-257
title: >-
  Lead the public admin bar's site title to the home page, with a View admin
  link
status: To Do
assignee: []
created_date: '2026-10-04 00:25'
labels:
  - admin
  - web
dependencies: []
priority: low
type: enhancement
ordinal: 272800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin bar (packages/cms/admin/components/admin-bar.njk, shared by the admin and the public site, TASK-126 and TASK-183) always links the site title to the admin dashboard (adminUrl). In the admin that is right, and its first shortcut is View site. On the public site the title should lead to the home page (/), and the first shortcut should be View admin leading to the dashboard, mirroring the admin's View site. The template takes where the title leads from its caller rather than branching on where it is.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a public page the bar's site title links to / and the first shortcut is View admin linking to the dashboard; the other public shortcuts (+ New, Edit post) follow as today
- [ ] #2 In the admin the site title still links to the dashboard and View site is unchanged
- [ ] #3 Tests pin both bars' links
<!-- AC:END -->
