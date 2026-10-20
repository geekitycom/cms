---
id: TASK-446
title: The core records follower count each day and charts it
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
labels:
  - dashboard
  - federation
milestone: m-41
dependencies:
  - TASK-444
references:
  - packages/cms/src/store/schema.ts
  - packages/cms/src/files/data-files.ts
priority: medium
ordinal: 383800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The followers table holds only the current set, so an unfollow leaves no trace and follower history cannot be charted. Record a daily snapshot (count, plus follows and unfollows that day) and chart it on the dashboard.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A follow and an unfollow each update that day record, and a day with no change still has a count
- [ ] #2 The record survives restarts and is included in a site export according to its declared data class
- [ ] #3 A core widget charts follower count over the last 30 days, and shows gained and lost for the period
- [ ] #4 A site with no history yet starts from the current count instead of drawing a misleading drop from zero
<!-- AC:END -->
