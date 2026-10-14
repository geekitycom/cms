---
id: TASK-400
title: >-
  A job left behind by a dead or discarded worker runs without waiting for a
  server restart
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 11:50'
updated_date: '2026-10-14 12:13'
labels: []
milestone: m-38
dependencies:
  - TASK-398
references:
  - packages/cms/src/jobs/queue.ts
  - packages/cms/src/jobs/lock-file.ts
  - packages/cms/src/admin/job-status.ts
  - packages/cms/src/supervisor/primary.ts
priority: medium
type: bug
ordinal: 356800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-398, start-up recovery in packages/cms/src/jobs/queue.ts skips running records whose claimer is alive and recovers the rest, but only at start-up. Three gaps remain. (1) A geekity CLI command killed after the server started leaves its job running until the next server start; meanwhile enqueueUnlessActive (packages/cms/src/admin/job-status.ts) refuses to queue another job of that name, so the admin cannot run the sweep or a resend at all. (2) When a supervisor reload fails, the supervisor resumes the old worker and kills the new one; if the new worker had claimed a job, it gives it back as queued on its own in-process transport, which dies with it, so nothing runs the job until the next start (and the old worker's recovery skipped it because the claimer was alive then). (3) withLockFile in jobs/lock-file.ts removes the lock file on unlock without checking it still holds it, so a holder that ran past the stale age can delete the lock of the waiter that took over. Make the server pick up a cut-off job without a restart (for example: when the queue is idle or before refusing an enqueue, recover records whose claimer is dead, and requeue queued records that no transport message will deliver), and make unlock remove only its own lock.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A job left running by a CLI process that was killed after the server started is run by the server as the next attempt without a restart, and the admin can then queue that job again; a test proves it
- [x] #2 After a failed reload, a job the discarded worker gave back as queued is run by the resumed worker; a test proves it
- [x] #3 Unlocking the records lock never removes a lock another process now holds; a test proves it
- [x] #4 docs/configuration.md describes when the server recovers a cut-off job
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Lock (AC3): withLockFile writes a per-holder token (pid plus a random id) and unlocks under the .takeover guard, removing the lock only when it still holds its own token; isStale reads the pid from the token's first word. Test: a holder that ran past the stale age, whose lock a waiter took over, leaves the waiter's lock in place.
2. Queue (AC1): a started queue reconciles before latest() answers and whenever it goes idle: running records it does not own whose claimer is dead go to queued n+1 (or interrupted at maxAttempts), and, when no handler runs here, every queued record is sent to the transport again (a duplicate is dropped by the claim). Start-up recovery is the same reconcile. Export isCutOff(status) for TASK-401. Tests: a record left running by a killed process after start is run as attempt 2 once latest() is read, and enqueueUnlessActive then queues a new job; a queued record whose message went to another transport runs when the queue goes idle.
3. Supervisor (AC2): on a failed reload with the new worker still alive, kill it and tell the old worker to resume only once the new one has exited, so the resumed worker's recovery sees the new worker's claim as dead. Tests: primary.test.ts ordering; cli-jobs.test.ts end to end with a fixture plugin that reports boot-failed after the new worker claimed the job.
4. Docs (AC4): docs/configuration.md Admin jobs says when the server recovers a cut-off job.
5. Verify: pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- jobs/queue.ts: start-up recovery became reconcile(), run by a started queue on start(), before latest() answers, and each time it goes idle after a job. It recovers running records it does not own whose claimer is dead (queued n+1, or interrupted at maxAttempts), and, only while no handler runs here, sends every queued record to the transport again; the claim drops a duplicate. Exported isCutOff(status) (running and claimer unnamed or dead), which recovery uses and TASK-401 can use. No poller: a cut-off job is picked up when the admin reads a status (media and federation screens, and enqueueUnlessActive, all go through latest()) or when the server finishes a job.
- supervisor/primary.ts: a failed reload with the new worker still alive (boot-failed message or boot deadline) now kills the new worker and enters an 'abandoning' phase; the old worker is told to resume only on the new worker's exit event, so its start-up recovery sees the new worker's claim as dead. Before, resume was sent first and the recovery raced the kill, skipping the job as alive. In practice the new worker never gives a job back as queued (it exits with process.exit(1) or SIGKILL); the job is left running with a dead claimer, which this now recovers. A queued one would also run, since recovery resends queued records.
- jobs/lock-file.ts: the lock holds a token (pid plus a random id); unlock runs under the .takeover guard and removes the lock only if it still holds its own token, so it cannot race a takeover. isStale reads the pid from the first word, so an older pid-only lock still reads.
- decision-54 point 8 says recovery runs only on start(); the backlog CLI has no command to edit or annotate a decision, so it is noted here: recovery now also runs before latest() and when a started queue goes idle, and the claimer check of TASK-398 replaces 'every running record this worker does not own'.
Tests: lock-file.test.ts (late holder leaves the waiter's lock), admin/job-status.test.ts (dead-claimer record run as attempt 2 after enqueueUnlessActive, then a new job queues), queue.test.ts (queued record with a lost message runs once the queue goes idle), primary.test.ts (resume only after the new worker exits; deadline test and three boot-failed tests now send the exit a real worker produces), cli-jobs.test.ts end to end with a fixture plugin that reports boot-failed after the new worker claimed the job. Each new test failed before its fix: lock 'the late holder removed the lock the waiter now holds'; admin and queue 'never came within 15000 ms'; e2e against the old primary.ts 'a run logging /^start 2 / never came within 90000 ms'.
Verification: pnpm build, pnpm test (cms 5997 pass, 0 fail; other packages pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A job cut off while the server runs is picked up without a restart. A started queue reconciles on start, before latest(), and when it goes idle: dead-claimer running records go back as the next attempt, and queued records are resent while nothing runs. A failed reload kills the new worker and resumes the old one only after the new one exits, so the old one recovers the job. Unlocking the records lock removes only the holder's own lock, under the takeover guard. docs/configuration.md says when the server recovers a cut-off job. Verified with new failing-first tests in lock-file, admin/job-status, queue, primary and cli-jobs (end to end), and full build/test/typecheck/lint/format.
<!-- SECTION:FINAL_SUMMARY:END -->
