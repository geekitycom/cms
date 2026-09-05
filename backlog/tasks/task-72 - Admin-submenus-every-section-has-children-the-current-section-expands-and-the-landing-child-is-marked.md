---
id: TASK-72
title: >-
  Admin submenus: every section has children, the current section expands, and
  the landing child is marked
status: To Do
assignee: []
created_date: '2026-09-05 13:58'
labels:
  - admin
  - theme
milestone: m-12
dependencies: []
references:
  - packages/cms/src/admin/routes.ts
  - packages/cms/admin/layouts/shell.njk
  - packages/cms/admin/static/admin.css
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 99600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin navigation is a flat list of eleven sections (ADMIN_SECTIONS in admin/routes.ts), with tags and categories at the top level and settings, users and federation each hiding several screens behind one link. Model the menu on WordPress classic: a section is a heading with one or more children, clicking the heading opens it and lands on its first child, the open section shows its children, and the child you are on is marked as current, so clicking Users shows you are on Users > All users. Every section has at least one child even when it has one screen, because that is what makes the rule uniform and lets a second child appear later without changing the shape. The grouping to start from, following WordPress where the CMS has the same thing: Dashboard (Home); Posts (All posts, Add new, Categories, Tags); Pages (All pages, Add new); Media (Library); Comments (All comments); Messages (All messages); Users (All users, Add new); Settings (whatever TASK-73 splits it into, General alone until then); Federation (Followers). A screen names its section and its child rather than only its section, and the sections registry carries the children, so a later screen adds one line. Keyboard and assistive access: the open section is a real list, the current child carries aria-current, and the menu works without JavaScript, with JavaScript only adding the open and close affordance if one is wanted at all.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every top-level section in the admin has at least one child; clicking a section lands on its first child with the section open and that child marked current
- [ ] #2 Tags and categories live under Posts, Add new under Posts, Pages and Users, and the top level reads Dashboard, Posts, Pages, Media, Comments, Messages, Users, Settings, Federation
- [ ] #3 A screen declares its section and child in one place and the registry renders the whole menu; adding a child is one entry and a test proves an unknown child is refused
- [ ] #4 The current child carries aria-current, the menu is usable with no JavaScript, and a screenshot of the demo admin on a narrow and a wide viewport looks right
- [ ] #5 doc-5 describes the menu and its rule; the admin README or the theme README documents how a site's own screen joins it
<!-- AC:END -->
