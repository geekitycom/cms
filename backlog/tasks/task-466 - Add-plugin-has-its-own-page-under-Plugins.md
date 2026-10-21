---
id: TASK-466
title: Add plugin has its own page under Plugins
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-21 13:24'
labels:
  - admin
  - plugins
dependencies: []
priority: medium
ordinal: 400800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Plugins screen (/admin/plugins, packages/cms/admin/pages/plugins/installed.njk) draws the Add plugin form as a card below the installed list. Move it to its own page, reached by an Add plugin button on the Plugins screen, the same way other admin lists link to a separate form for a new item.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /admin/plugins lists the installed plugins and has an Add plugin button linking to a new page, with no install form on the list
- [ ] #2 The new page holds the package, version and password fields with the trust warning, posts to the same install handler, and shows its errors on the new page
- [ ] #3 After a successful install the user lands where they do today, and the admin navigation marks Plugins as current on the new page
- [ ] #4 Tests and docs/admin.md (and docs/plugins.md where it says where to install from the admin) describe the new page
<!-- AC:END -->
