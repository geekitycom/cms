---
id: TASK-458
title: The dashboard sets Umami views beside fediverse engagement per post
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
labels:
  - plugins
  - umami
  - dashboard
milestone: m-42
dependencies:
  - TASK-456
  - TASK-448
priority: medium
ordinal: 395800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Combine Umami views per post with the core per-post engagement totals (TASK-448) to show posts read widely but little reacted to, and the other way round, plus each recent post traffic in its first 7 days.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A widget lists recent posts with their views and engagement total side by side, sortable by either
- [ ] #2 Each post published in the last 30 days shows its views over its first 7 days
- [ ] #3 Posts with no Umami data show as no data, not zero
<!-- AC:END -->
