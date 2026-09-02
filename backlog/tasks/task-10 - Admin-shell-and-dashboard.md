---
id: TASK-10
title: Admin shell and dashboard
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-9
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Admin layout in Nunjucks loosely following WordPress classic: left navigation (Dashboard, Posts, Pages, Settings, Users, Federation), top bar with site name and View Site link, flash messages. Dashboard shows counts of published posts, drafts, and pages, the five most recent posts, and a quick draft form.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /admin renders the layout with navigation to every section listed in doc-5
- [ ] #2 Dashboard counts match the index
- [ ] #3 Quick draft creates a draft post file and redirects to its editor
- [ ] #4 Flash messages survive one redirect and then clear
<!-- AC:END -->
