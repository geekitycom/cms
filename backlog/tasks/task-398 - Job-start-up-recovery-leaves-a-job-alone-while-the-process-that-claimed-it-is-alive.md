---
id: TASK-398
title: >-
  Job start-up recovery leaves a job alone while the process that claimed it is
  alive
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 11:02'
updated_date: '2026-10-14 11:47'
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
- [x] #1 A job a live CLI process is running is not re-run or re-queued when the server starts or reloads; a test proves it
- [x] #2 A job whose claiming process is dead is still recovered as the next attempt, as today
- [x] #3 When several processes find a stale records lock at once, exactly one takes it over; a test proves it
- [x] #4 docs/configuration.md says how recovery decides a job was cut off
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Running record gains an optional claimer { host, pid, since } (since = the process's start as the OS reports it: /proc/<pid>/stat starttime on Linux, ps lstart elsewhere). jobs/claimer.ts gives thisProcess() and isAlive(claimer).
2. Recovery treats a running record as cut off unless it is not this worker's and its claimer is live: same host, a pid other than this process, the pid alive, and the pid's start equal to since (so a reused pid reads as dead). A record with no claimer, from another host, or with this process's pid is cut off as today.
3. Move the lock file into jobs/lock-file.ts; a stale lock is removed only under a takeover guard file (O_EXCL), after re-checking it is still stale, so only one waiter removes it.
4. Tests first: serve test with a CLI-like child running a job across serve start + reload (AC1); queue tests for a killed claimer, a reused pid and another host (AC2); concurrent waiters on a stale lock never overlap (AC3).
5. Document the rule in docs/configuration.md Admin jobs; update decision text only via notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Liveness rule (jobs/processes.ts isClaimerAlive): a running record not owned by this queue is left alone only if its claimer {host, pid, since} is on this host, is not this process's pid, kill(pid,0) says alive, and the pid's OS start time (/proc/<pid>/stat starttime on Linux, ps -o lstart= elsewhere) equals since. Why: another host's process cannot be seen and one data dir means one container, so a record from another host (e.g. a recreated container) is cut off rather than stuck; a pid reused after the claimer died has a different start time, so a reused pid reads as dead; this process's own pid with another owner is an earlier queue in this process (the contract tests' in-process crash), so it is cut off. A record with no claimer (written before this change, or by a custom store that drops it) is cut off as before. If the start time cannot be read, a recorded since never matches, so the job is recovered rather than left running.
Supervisor reload: the old worker drains (gives its job back as queued) before the new one is forked, so the new worker sees no running record from it. One gap remains on a failed reload (keepOld): the old worker resumes and recovers while the killed new worker may still be alive with a running job; it is skipped, and when the new worker gives it back as queued on its own in-process transport, nothing runs it until the next start. Recovery runs only at start, so a CLI killed after the server started also waits for the next start (unchanged from before).
Lock: moved to jobs/lock-file.ts. A stale lock is removed only by the waiter holding jobs.json.lock.takeover (O_EXCL), after re-checking under it that the lock is still stale, so a waiter that read the old lock never removes its replacement. The guard itself, if its holder dies in its few-ms window, is taken over by the same stale rule; that second-level case is not atomic.
Tests: cli-jobs.test.ts AC1 (CLI child runs the job across serve start + reload; failed before the fix with attempt 2 vs 1), AC2 (killed CLI child, server runs attempt 2); queue.test.ts start-up recovery (reused pid, other host, no claimer; mutating the since/host checks fails them); lock-file.test.ts 40 staggered in-process waiters on a stale lock (failed before the fix: 'two waiters held the lock at once', 5 of 5 runs) plus 6 processes x 4 holds.
Verified: pnpm build, pnpm test (cms 5990 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Running job records now name the claiming process (claimer: host, pid, OS start time). Start-up recovery leaves a job alone while that process is alive on this host and is the same process (start time matches), and recovers it otherwise: dead pid, reused pid, another host, this process's own pid, or no claimer. The records lock's stale takeover now happens under an O_EXCL guard file with a re-check, so one waiter removes a stale lock. docs/configuration.md Admin jobs says how recovery decides a job was cut off, documents claimer and the takeover guard. Verified with new cli-jobs.test.ts serve tests (AC1 failed before the fix), queue.test.ts recovery tests, lock-file.test.ts (failed before the fix), and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
