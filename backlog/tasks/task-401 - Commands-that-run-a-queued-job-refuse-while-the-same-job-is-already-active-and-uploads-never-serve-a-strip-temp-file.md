---
id: TASK-401
title: >-
  Commands that run a queued job refuse while the same job is already active,
  and uploads never serve a strip temp file
status: To Do
assignee: []
created_date: '2026-10-14 11:58'
labels: []
milestone: m-38
dependencies:
  - TASK-399
references:
  - packages/cms/src/cli.ts
  - packages/cms/src/admin/job-status.ts
  - packages/cms/src/content/metadata/sweep.ts
priority: low
type: bug
ordinal: 357800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
geekity strip-metadata and geekity resend (packages/cms/src/cli.ts) enqueue and run their job without checking for an active job of the same name, while the admin uses enqueueUnlessActive (packages/cms/src/admin/job-status.ts). A CLI sweep overlapping the server's sweep job can delete the job's in-flight .geekity-strip temp file (TASK-399 cleans leftovers at the start of every sweep), and the job's rename then fails with ENOENT. Separately, the /uploads/ route (findUpload -> findAsset) still serves a leftover .geekity-strip file at its URL until the next sweep removes it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 geekity strip-metadata and geekity resend print a clear message and exit non-zero, running nothing, when a job of the same name is queued or running; a test proves it
- [ ] #2 A request for a .geekity-strip file under /uploads/ answers 404; a test proves it
- [ ] #3 docs/cli.md says what the commands do when the job is already active
<!-- AC:END -->
