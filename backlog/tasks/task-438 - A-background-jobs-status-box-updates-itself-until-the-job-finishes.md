---
id: TASK-438
title: A background job's status box updates itself until the job finishes
status: To Do
assignee: []
created_date: '2026-10-20 14:04'
labels:
  - admin
dependencies: []
references:
  - packages/cms/admin/components/job-status.njk
  - packages/cms/src/admin/job-status.ts
priority: medium
type: bug
ordinal: 375800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On Tools > Maintenance, running the metadata sweep shows a progress bar that never changes until you leave the page and come back. By design the job status box (packages/cms/admin/components/job-status.njk) does not reload itself and offers a Check again link, which is easy to miss and not what people expect. With JavaScript on, the box should poll and redraw itself while the job is queued or running, then show the result when it ends. Every screen that uses jobStatus gets this, not only the sweep. Without JavaScript, Check again stays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With JavaScript on, a queued or running job's box refreshes on its own every few seconds and shows the progress, then the finished result, failure or interruption without a page load
- [ ] #2 Polling stops once the job is no longer queued or running, and when the page is hidden it slows or pauses
- [ ] #3 Every screen that uses the jobStatus component gets this behaviour
- [ ] #4 The script obeys the admin CSP (no inline script) and the progress is announced politely to screen readers
- [ ] #5 Without JavaScript the Check again link still works
<!-- AC:END -->
