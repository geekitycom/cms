---
id: TASK-398
title: >-
  Job start-up recovery leaves a job alone while the process that claimed it is
  alive
status: To Do
assignee: []
created_date: '2026-10-14 11:02'
labels: []
milestone: m-38
dependencies:
  - TASK-391
references:
  - packages/cms/src/jobs/queue.ts
  - packages/cms/src/jobs/file-records.ts
  - >-
    backlog/decisions/decision-54 -
    Admin-jobs-run-on-a-swappable-transport-with-their-status-in-a-CMS-owned-job-record.md
priority: medium
type: bug
ordinal: 354800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-391 built the job queue (packages/cms/src/jobs/). Start-up recovery treats every running record owned by another worker as cut off (decision-54 point 8). If the server boots or reloads while a geekity CLI process is running a job with JobQueue.run(id), the server marks that job queued as a new attempt and runs it a second time, alongside the CLI. Handlers are meant to be safe to run twice, but the double run wastes work and makes the record lie about which attempt is running. Separately, the jobs.json.lock takeover in file-records.ts lets two waiters both take over a stale lock (dead pid or older than 10 s) at the same moment, so both can write. Record the claiming process (for example pid plus host) on a running record, have recovery skip a record whose claimer is still alive, and make stale-lock takeover atomic so only one waiter wins.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A job a live CLI process is running is not re-run or re-queued when the server starts or reloads; a test proves it
- [ ] #2 A job whose claiming process is dead is still recovered as the next attempt, as today
- [ ] #3 When several processes find a stale records lock at once, exactly one takes it over; a test proves it
- [ ] #4 docs/configuration.md says how recovery decides a job was cut off
<!-- AC:END -->
