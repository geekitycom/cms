---
id: TASK-445
title: 'The dashboard charts fediverse likes, boosts and replies per day'
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
priority: medium
ordinal: 382800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The ap_inbox table logs incoming Like, Announce and replies with received_at. A core widget charts them per day over the last 7 days, with a 30-day option, so the owner sees how posts land on the fediverse.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A core widget draws likes, boosts and replies per day as named series for the last 7 days, and for 30 days when chosen
- [ ] #2 An Undo of a like or boost removes it from the count, and duplicate deliveries of one activity count once
- [ ] #3 Days with no activity show as zero, and days follow the site time zone
- [ ] #4 Totals for the period show as stats with the change from the previous period
<!-- AC:END -->
