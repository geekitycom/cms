---
id: TASK-391
title: A job queue runs admin jobs in-process and keeps their status in data/
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 16:48'
updated_date: '2026-10-14 10:59'
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
- [x] #1 A JobQueue interface with typed job definitions (name, payload parser, handler) exists, and enqueue refuses a job whose name has no registered handler
- [x] #2 The transport and the record store can each be replaced through config, and Fedify SqliteMessageQueue works as a transport unchanged
- [x] #3 The contract test from the decision record runs in the repo against the in-process transport and against SqliteMessageQueue, and passes
- [x] #4 Job records live in one file under the data directory, written atomically, pruned to the newest few per job name, and survive geekity rebuild
- [x] #5 Under geekity serve, a drain or close stops taking jobs, aborts the running job signal, waits for its handler, and the next worker runs the job to the end; a test proves it
- [x] #6 A job running when the process is killed runs again as the next attempt after a restart, and after the maximum number of attempts it shows as interrupted and is not run again; tests prove both
- [x] #7 A duplicate or late message for a job already claimed or finished runs nothing; a test proves it
- [x] #8 Two processes writing job records at once (a CLI command and the server) cannot both claim one job, and a CLI process never runs start-up recovery; a test proves the record writes are safe across processes
- [x] #9 docs say where job records are stored and what they hold
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add packages/cms/src/jobs/: types.ts (Json, Progress, JobState, JobStatus, JobContext, JobDefinition, JobQueue, MessageTransport, JobRecords, as decision-54 gives them), queue.ts (createJobQueue: the Appendix B runner with typed definitions, restartable start after stop, a 64 KB payload limit, and run(id) for a CLI process, which claims and runs one job here with no transport and no start-up recovery), in-process.ts (the transport on createSerialQueue, holding messages until a listener comes), file-records.ts (data/jobs.json, read-modify-write under the in-process file lock plus a cross-process lock file, each write an atomic rename, pruned to the newest five finished records per name).
2. Port the Appendix A contract test to src/jobs/contract.test.ts with typed definitions and event waits in place of sleeps, and run it against the in-process transport and Fedify SqliteMessageQueue (@fedify/sqlite 2.4.0 as a devDependency).
3. Wire it in: GeekityConfig.jobs { transport, records, definitions }, resolved like federation; services build the queue and put it in the lifecycle after the scheduler (start after the scan, stop on drain or close, settled waits for the handler); cms.jobs and c.var.jobs expose it.
4. Tests: file records (one file, atomic, pruning, survives geekity rebuild), cross-process (child processes racing on one claim and on creates; a CLI-side run leaves the server's running record alone), and geekity serve (reload drains a running job back to queued and the new worker finishes it; SIGKILL of the worker runs the job again as attempt 2, and maxAttempts kills end it interrupted).
5. Docs: docs/content.md data table, docs/configuration.md and docs/public-api.md for the new config and types.
6. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built in packages/cms/src/jobs/: types.ts (decision-54's interface, plus JobQueue.run(id) for a CLI process and JobLostError), queue.ts (createJobQueue: the Appendix B runner with typed JobDefinitions, a 64 KB payload limit, a required Clock, and start() that works again after stop() so drain then resume works), in-process.ts (transport on createSerialQueue; holds messages until a listener), file-records.ts (data/jobs.json, a JSON list oldest first; each change runs under withFileLock plus a jobs.json.lock file created with O_EXCL, taken over when its pid is dead or it is over 10 s old; atomic rename; keeps every queued/running job and the newest 5 ended jobs per name).

Wiring: GeekityConfig.jobs { transport, records, definitions } resolved like federation; services build the queue and put it in the lifecycle right after the scheduler (start after the scan; stop aborts; settled = close, before delivery settles); cms.jobs and c.var.jobs expose it. No CMS job is registered yet; TASK-392/393 add theirs to the jobs list in services.ts.

Decisions: enqueue refuses by name (not by object identity). A CLI process uses jobs.enqueue + jobs.run(id), which claims and runs the job here with no transport listen and no recovery; when another process claimed it first, run() polls the record every 100 ms until it ends. @fedify/sqlite 2.4.0 is a devDependency for the contract test (TASK-379 makes it a real dependency). jobs/ is a new layer in layer-boundary.test.ts between caches and content. The clock-boundary allowance covers the lock-file age check.

Evidence:
- AC1, AC7: src/jobs/contract.test.ts C5 and C10; src/jobs/queue.test.ts checks the payload type with @ts-expect-error under pnpm typecheck.
- AC2: src/jobs/cms-jobs.test.ts serves a CMS on SqliteMessageQueue (passed as is) and a file record store at another path; config.test.ts default jobs: {}.
- AC3: contract C1-C11 pass against the in-process transport and SqliteMessageQueue (22 cases). Waits are on events (record changes, messages handled) instead of sleeps, per test-waits.test.ts; P1 dropped, as neither transport redelivers. Injected defects: removing recovery fails C7-C9, C11 (C8, C9, C11 on SQLite); removing the state check and the CAS fails C10 (and C11 on SQLite); settled() resolving at once fails C6.
- AC4: src/jobs/file-records.test.ts (one file and nothing beside it, CAS, pruning, malformed file refused); cms-jobs.test.ts runs geekity rebuild and the file is byte-identical.
- AC5: src/cli-jobs.test.ts, real geekity serve: a reload over the control socket aborts the running job in the old worker, and the new worker runs it to the end as attempt 1. close() goes through the same endServices path; contract C7 covers close() at the queue level.
- AC6: src/cli-jobs.test.ts: SIGKILL of the worker -> respawn runs attempt 2 to finished; three kills -> interrupted at attempt 3, and a further reload runs it no more. Contract C8, C9.
- AC8: file-records.test.ts spawns 4 processes creating 25 jobs each (100 kept) and 4 processes running the same 20 jobs (each ran once). Without the lock file both fail. queue.test.ts: a CLI-side run() leaves a running record owned by the server untouched.
- AC9: docs/configuration.md Admin jobs section, docs/content.md data table row, docs/public-api.md rows.

Validation: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check all pass (cms 5954 tests).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the admin job queue of decision-54: a typed JobQueue (enqueue, status, latest, run, start, stop, settled, close) over two swap points, an in-process MessageTransport on createSerialQueue and a JobRecords store in data/jobs.json (atomic, cross-process lock file, pruned to five ended jobs per name). config.jobs swaps the transport, the records and adds job definitions; the CMS runs the queue in its lifecycle and exposes it as cms.jobs and c.var.jobs. Verified with the decision's contract test against the in-process transport and Fedify SqliteMessageQueue, multi-process record tests, real geekity serve tests for reload hand-over, crash re-run and interrupted after three attempts, a geekity rebuild check, and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
