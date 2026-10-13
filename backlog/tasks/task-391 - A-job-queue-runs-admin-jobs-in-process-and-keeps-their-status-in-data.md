---
id: TASK-391
title: A job queue runs admin jobs in-process and keeps their status in data/
status: To Do
assignee: []
created_date: '2026-10-13 16:48'
labels: []
milestone: m-38
dependencies:
  - TASK-380
references:
  - >-
    backlog/decisions/decision-54 -
    Admin-jobs-run-on-a-swappable-transport-with-their-status-in-a-CMS-owned-job-record.md
  - packages/cms/src/util/queue.ts
  - packages/cms/src/cms/services.ts
  - packages/cms/src/cms/lifecycle.ts
  - packages/cms/src/drain.ts
  - packages/cms/src/supervisor/primary.ts
priority: medium
type: enhancement
ordinal: 345800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Long admin actions (the strip-metadata sweep, resending announced posts) must not run inside a request, where a proxy can time them out. This task builds the job queue that the follow-up tasks move them onto. It follows the proposed decision in the reference (from TASK-380): read it first, including its Appendix A contract test and Appendix B reference runner.

The admin and the CLI use one `JobQueue` (enqueue a typed job definition with a JSON payload, status by id, latest status for a name, start, stop, settled, close). Under it are two swap points that a different build can replace through config, as `config.federation.queue` already works: a `MessageTransport` (a structural subset of Fedify's `MessageQueue`; a message carries only the job id) and a `JobRecords` store whose every transition is a compare-and-set on state and attempt. The first transport is in-process on `createSerialQueue`; the first record store is a file in the data directory. A job that was running when the process died runs again as a new attempt after start-up recovery, up to a maximum, then shows as interrupted. A graceful stop gives the running job back as queued without using an attempt. Delays and automatic retries are out of scope. No job has to exist yet besides test jobs; strip-metadata and resend are separate tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A JobQueue interface with typed job definitions (name, payload parser, handler) exists, and enqueue refuses a job whose name has no registered handler
- [ ] #2 The transport and the record store can each be replaced through config, and Fedify SqliteMessageQueue works as a transport unchanged
- [ ] #3 The contract test from the decision record runs in the repo against the in-process transport and against SqliteMessageQueue, and passes
- [ ] #4 Job records live in one file under the data directory, written atomically, pruned to the newest few per job name, and survive geekity rebuild
- [ ] #5 Under geekity serve, a drain or close stops taking jobs, aborts the running job signal, waits for its handler, and the next worker runs the job to the end; a test proves it
- [ ] #6 A job running when the process is killed runs again as the next attempt after a restart, and after the maximum number of attempts it shows as interrupted and is not run again; tests prove both
- [ ] #7 A duplicate or late message for a job already claimed or finished runs nothing; a test proves it
- [ ] #8 Two processes writing job records at once (a CLI command and the server) cannot both claim one job, and a CLI process never runs start-up recovery; a test proves the record writes are safe across processes
- [ ] #9 docs say where job records are stored and what they hold
<!-- AC:END -->
