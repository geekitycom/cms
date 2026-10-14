---
id: TASK-408
title: Tools > Export runs a site export as a job and offers the download
status: To Do
assignee: []
created_date: '2026-10-14 16:25'
labels: []
milestone: m-38
dependencies:
  - TASK-406
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 364800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A `site.export` job on the decision-54 queue, with password re-entry, the credentials checkbox, progress, and a download.

From decision-55 (accepted), proposed task 6. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Starting an export needs the current user's password. A wrong password queues nothing.
- [ ] #2 The page shows the number of deliveries waiting in `queue.sqlite` before the export starts.
- [ ] #3 The page shows the job's progress and, when it finishes, a download that only a signed-in user can fetch.
- [ ] #4 `data/exports/` keeps only the newest archive, deletes it after 24 hours, and is declared scratch.
<!-- AC:END -->
