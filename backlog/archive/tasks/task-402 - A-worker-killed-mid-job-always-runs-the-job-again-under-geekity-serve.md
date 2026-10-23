---
id: TASK-402
title: A worker killed mid-job always runs the job again under geekity serve
status: To Do
assignee: []
created_date: '2026-10-14 14:09'
updated_date: '2026-10-23 14:34'
labels: []
milestone: m-38
dependencies: []
references:
  - packages/cms/src/cli-jobs.test.ts
  - packages/cms/src/jobs/queue.ts
  - packages/cms/src/jobs/processes.ts
  - packages/cms/src/jobs/lock-file.ts
  - packages/cms/src/supervisor/primary.ts
  - backlog/tasks/task-422
priority: low
type: bug
ordinal: 358800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
cli-jobs.test.ts 'runs a job cut off by a killed worker again as the next attempt (AC #6)' failed once in about 25 full-suite runs in a node:24 Linux container: after SIGKILL of the worker running the job, a run logging 'start 2' never came within 90 s. It passed in the 14 runs after. Cause unknown. Candidates: the new worker's start-up reconcile seeing the killed worker as alive (kill(pid, 0) succeeds on a zombie until the primary reaps it; the primary should reap it before respawning, but check), a records lock or .takeover guard left by the killed worker that is not taken over, or the fs.watch in the test's whenChanged missing the runs.log change. Repro: copy the repo (without node_modules and .git) into a node:24 container, pnpm install and build, then run pnpm test in packages/cms in a loop (about 3-4 minutes a run). Capture the serve child's stderr and dump runs.log, data/jobs.json and any jobs.json.lock files when the wait times out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The cause of the missed second attempt is found and named in the notes, or the test is shown sound with the evidence
- [ ] #2 If the cause is in the product, it is fixed with a test that fails without the fix
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-14: recurred on CI for PR #191 in 'shows a job cut off three times as interrupted' (start 2 never came within 90 s after the first SIGKILL). Could not reproduce locally: 90 isolated runs of the kill tests under CPU load and 15 full-suite runs in a node:24 container all passed. cli-jobs.test.ts now captures the server's stderr and, when a wait times out, appends it with runs.log and data/jobs.json to the error, so the next CI failure shows where recovery stopped.

2026-10-18: related flake filed as TASK-422 (delivery.test.ts, TASK-417 AC #2: a second rewrite of the same file never produced its Create within 15 s on CI). Different code path (in process, no job queue or killed worker), but it shares this task's watcher candidate: a file watcher that misses or merges a second quick change under CI load. Whatever either task finds about the watcher applies to both.

2026-10-23: closed without a fix. The flake has not recurred since 2026-10-14. TASK-422 (PR #202, 2026-10-18) found that Node 24's recursive fs.watch on Linux stops reporting writes to a file after it is replaced by an atomic rename, one of this task's candidates, and fixed the content watcher. That is the likely explanation, but it was not proven here, so the acceptance criteria are left unchecked. If the test fails again, its timeout error now carries the server's stderr, runs.log and data/jobs.json; file a new task from that.
<!-- SECTION:NOTES:END -->
