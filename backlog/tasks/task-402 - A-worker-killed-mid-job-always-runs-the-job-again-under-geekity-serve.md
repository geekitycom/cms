---
id: TASK-402
title: A worker killed mid-job always runs the job again under geekity serve
status: To Do
assignee: []
created_date: '2026-10-14 14:09'
labels: []
milestone: m-38
dependencies: []
references:
  - packages/cms/src/cli-jobs.test.ts
  - packages/cms/src/jobs/queue.ts
  - packages/cms/src/jobs/processes.ts
  - packages/cms/src/jobs/lock-file.ts
  - packages/cms/src/supervisor/primary.ts
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
