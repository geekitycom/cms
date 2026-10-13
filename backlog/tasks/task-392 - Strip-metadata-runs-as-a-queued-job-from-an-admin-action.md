---
id: TASK-392
title: Strip-metadata runs as a queued job from an admin action
status: To Do
assignee: []
created_date: '2026-10-13 16:48'
labels: []
milestone: m-38
dependencies:
  - TASK-391
references:
  - >-
    backlog/decisions/decision-54 -
    Admin-jobs-run-on-a-swappable-transport-with-their-status-in-a-CMS-owned-job-record.md
  - packages/cms/src/content/metadata/sweep.ts
  - packages/cms/src/cli.ts
  - packages/cms/src/admin/media.ts
priority: medium
type: enhancement
ordinal: 346800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sweeping content/uploads for location and camera metadata is today only `geekity strip-metadata` (stripMetadataCommand in packages/cms/src/cli.ts, stripStoredUploads in packages/cms/src/content/metadata/sweep.ts). On a site with many uploads it is too long to run inside a request. Make it a job on the job queue from TASK-391 and give the admin a button that queues it and shows its progress and result, as decided in the referenced decision record. The CLI command stays as a thin layer over the same job. The handler must be safe to run twice and should stop between files when its signal is aborted, so a reload is not held up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An admin action queues the sweep and answers at once, without waiting for the sweep
- [ ] #2 The admin shows the latest sweep: queued, running with files checked out of the total, finished with the stripped, clean and unreadable counts and the stripped files, failed with the error, or interrupted
- [ ] #3 Running the sweep twice, or again after it was cut off part way, leaves every upload the same as running it once; a test proves it
- [ ] #4 The handler stops between files when the queue stops, and the sweep then finishes in the next worker; a test proves it
- [ ] #5 geekity strip-metadata runs the same job, prints the same report as today and keeps its exit codes
<!-- AC:END -->
