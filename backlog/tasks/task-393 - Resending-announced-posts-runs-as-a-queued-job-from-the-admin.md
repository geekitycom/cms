---
id: TASK-393
title: Resending announced posts runs as a queued job from the admin
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
  - packages/cms/src/admin/federation.ts
  - packages/cms/src/cli.ts
priority: medium
type: enhancement
ordinal: 347800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Resending a post sends an Update to every follower inbox, and the federation screen does it inside the request (packages/cms/src/admin/federation.ts, RESEND_PATH, which calls delivery.resend). `geekity resend --all` does it for every announced post. With many followers or posts this risks a proxy timeout. Move both onto the job queue from TASK-391, as decided in the referenced decision record: the per-post resend button and a new resend-all action queue a job and show its progress and result. The CLI command stays as a thin layer over the same job. Resending twice is allowed (receivers treat an Update as the same post), but the handler should stop between posts when its signal is aborted. Dev mode must still hold deliveries as it does today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The per-post resend button on the federation screen queues a job and answers at once
- [ ] #2 An admin action queues a resend of every announced post and answers at once
- [ ] #3 The federation screen shows the latest resend job: progress in posts, and when finished, per post how many inboxes were reached, which posts dev mode held and which slugs had nothing to resend
- [ ] #4 A resend job cut off part way is run again by the next worker and finishes; a test proves it
- [ ] #5 Dev mode still holds every resend, and the job result says so
- [ ] #6 geekity resend, with slugs or --all, runs the same job, prints the same report as today and keeps its exit codes
<!-- AC:END -->
