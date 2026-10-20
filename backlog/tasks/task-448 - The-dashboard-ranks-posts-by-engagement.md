---
id: TASK-448
title: The dashboard ranks posts by engagement
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
labels:
  - dashboard
  - federation
  - comments
milestone: m-41
dependencies:
  - TASK-444
priority: medium
ordinal: 385800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Show which posts drew the most response over the last 30 days: likes, boosts, replies, webmentions and approved comments added up per post. The per-post totals are also what M43 sets beside Umami views, so make them available to plugins as a service.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The widget lists the top five posts for the last 30 days with their total and a breakdown by kind, each linking to the post editor
- [ ] #2 Undone likes and boosts and unapproved comments do not count
- [ ] #3 Per-post engagement totals are available to plugins through host.use
- [ ] #4 A site with no engagement shows a short empty state
<!-- AC:END -->
