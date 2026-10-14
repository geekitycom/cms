---
id: TASK-400
title: >-
  A job left behind by a dead or discarded worker runs without waiting for a
  server restart
status: To Do
assignee: []
created_date: '2026-10-14 11:50'
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
- [ ] #1 A job left running by a CLI process that was killed after the server started is run by the server as the next attempt without a restart, and the admin can then queue that job again; a test proves it
- [ ] #2 After a failed reload, a job the discarded worker gave back as queued is run by the resumed worker; a test proves it
- [ ] #3 Unlocking the records lock never removes a lock another process now holds; a test proves it
- [ ] #4 docs/configuration.md describes when the server recovers a cut-off job
<!-- AC:END -->
