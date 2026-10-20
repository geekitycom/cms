---
id: TASK-441
title: Dashboard home drops the Recent posts card and keeps the stat tiles
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
labels:
  - admin
  - dashboard
milestone: m-41
dependencies: []
references:
  - packages/cms/src/admin/routes.ts
  - packages/cms/admin/pages/dashboard/home.njk
priority: medium
ordinal: 378800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dashboard › Home shows a stat tile row (published posts, drafts, pages, followers, comments waiting, messages unread) and a Recent posts card. The Recent posts card repeats what the Posts list shows. Remove it, so the space below the tiles is free for the charts in this milestone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /admin draws no Recent posts card, and the store is not asked for recent posts
- [ ] #2 The six stat tiles draw as before, with the same labels, values and links
- [ ] #3 The dashboard tests that assert on Recent posts are removed or replaced, and docs/admin.md no longer mentions it
<!-- AC:END -->
