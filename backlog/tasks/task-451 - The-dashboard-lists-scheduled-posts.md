---
id: TASK-451
title: The dashboard lists scheduled posts
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
labels:
  - dashboard
  - content
milestone: m-41
dependencies:
  - TASK-444
references:
  - packages/cms/src/content/schedule.ts
priority: medium
ordinal: 388800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post with a future date is scheduled. List the next ones to publish so the owner sees what is queued.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The widget lists the next five scheduled posts with their publish time in the site time zone, each linking to the editor
- [ ] #2 With nothing scheduled, the widget draws nothing
<!-- AC:END -->
