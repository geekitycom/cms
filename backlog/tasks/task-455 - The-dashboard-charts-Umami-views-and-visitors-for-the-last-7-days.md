---
id: TASK-455
title: The dashboard charts Umami views and visitors for the last 7 days
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
  - TASK-454
  - TASK-444
priority: medium
ordinal: 392800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The main Umami widget: views and visitors per day over the last 7 days, and headline stats (visitors, views, bounce rate, average visit time) with the change from the previous 7 days.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A full-width widget draws views and visitors per day for the last 7 days as two series, with days in the site time zone
- [ ] #2 Visitors, views, bounce rate and average visit time show with the change from the previous 7 days
- [ ] #3 With Umami unreachable, the widget shows its last good result marked stale, or unavailable, and the dashboard still draws
- [ ] #4 The widget is absent while the plugin settings are incomplete
<!-- AC:END -->
