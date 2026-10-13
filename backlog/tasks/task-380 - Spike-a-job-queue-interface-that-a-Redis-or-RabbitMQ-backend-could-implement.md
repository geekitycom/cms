---
id: TASK-380
title: 'Spike: a job queue interface that a Redis or RabbitMQ backend could implement'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 11:24'
updated_date: '2026-10-13 17:40'
labels: []
milestone: m-38
dependencies: []
references:
  - packages/cms/src/util/queue.ts
  - packages/cms/src/federation/queue.ts
  - backlog/decisions/decision-5 - Fedify-with-in-process-queue-for-phase-one.md
  - >-
    backlog/decisions/decision-52 -
    A-site-is-one-container-and-its-directory-foundational-systems-sit-behind-async-interfaces-a-build-can-swap.md
  - >-
    backlog/decisions/decision-54 -
    Admin-jobs-run-on-a-swappable-transport-with-their-status-in-a-CMS-owned-job-record.md
priority: medium
type: spike
ordinal: 339800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Some admin actions are long enough that running them inside the request risks a proxy timeout: sweeping content/uploads for location and camera metadata (today `geekity strip-metadata`) and resending every announced post (today `geekity resend --all`). The plan is for the admin to queue them as jobs and show their progress and result. The first implementation would be in-process, on `createSerialQueue` (packages/cms/src/util/queue.ts), with each job's status kept in a file under data/. That is enough for a single-container personal site, because both jobs are safe to run again.

The queue must sit behind an interface, so that a sturdier backend can replace the in-process one later without changing the admin screens or the jobs. Before that interface is decided, this spike checks it against popular queue systems, so it does not quietly assume something only an in-process queue can do.

A draft shape from discussion, to test and not to adopt as is: jobs are a name plus a JSON payload, with a handler registered per name at startup; the interface has enqueue, status by id, the latest status for a name, settled() and close(); a status is queued, running (with progress), finished (with a result), failed or interrupted.

Backends to look at, at least: Redis (BullMQ, and plain Redis lists or streams), RabbitMQ (AMQP), and Fedify's MessageQueue interface with its backends (`@fedify/sqlite`, `@fedify/redis`, `@fedify/amqp`, `@fedify/postgres`), since TASK-379 moves federation onto `SqliteMessageQueue` and one queue backend for both would be simpler to run. A Postgres queue (pg-boss or Graphile Worker) is worth a look if it changes the answer.

Questions to answer: where job status, progress and results live when the broker does not keep them (RabbitMQ deletes a message once acknowledged); what delivery guarantee each gives (at least once, or at most once) and what that means for job handlers; whether settled() and close() can be honoured, or mean something different, with a broker shared by several processes; how a job interrupted by a restart or a supervised reload shows up; and how delayed jobs and retries map across backends.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decision record gives the job queue interface: its operations, the job and status types, and the guarantees a handler may rely on, such as at least once delivery and how it should behave when run twice
- [x] #2 A table maps every operation and guarantee in the interface onto BullMQ, RabbitMQ and Fedify MessageQueue (with @fedify/sqlite), saying for each how it is done or why it cannot be, and what the in-process implementation does
- [x] #3 Where a backend keeps no job status, the record says where status lives instead, and the interface separates running jobs from reporting their status if that is the answer
- [x] #4 Claims about BullMQ and RabbitMQ are checked against the real thing: a throwaway adapter for each passes the same contract test as the in-process one, run against a real Redis and a real RabbitMQ (for example in Docker), with the results in the record; the adapters are not merged
- [x] #5 The record says whether one backend could carry both admin jobs and Fedify messages, and what that would take
- [x] #6 Follow-up tasks are filed for the chosen interface and its in-process implementation; nothing is implemented for production in this task
- [x] #7 The user has read the decision record and accepted it, or asked for changes that are made; follow-up build tasks are not started before then
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the Fedify MessageQueue types and @fedify/sqlite's SqliteMessageQueue in node_modules; read BullMQ and amqplib type definitions after installing them in a scratch directory; check SQS limits and pg-boss/Graphile Worker on paper.
2. Draft the interface: job = name + JSON payload, handlers registered by name, a JobQueue (enqueue/run side) separate from a JobStatusStore (status side), statuses queued/running/finished/failed/interrupted.
3. Write one contract test (node:test) parameterised by a factory, plus an in-process implementation on createSerialQueue with a file status store, a throwaway BullMQ adapter and a throwaway RabbitMQ (amqplib) adapter; also a Fedify SqliteMessageQueue adapter to test whether one backend carries both.
4. Run the contract against real Redis and RabbitMQ in Docker; record versions and per-case results; remove the containers.
5. Write the decision record (proposed): interface sketch, guarantees, mapping table, status location, settled/close, interruption, delays and retries, shared backend and TASK-379.
6. File follow-up tasks under m-38 with dependencies; note TASK-379 if the finding changes it.
7. Delete the scratch code so git status shows only backlog/ changes; check the ACs with proof, leave #7 open and the task In Progress for user review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope added 2026-10-13: also check the interface on paper against Amazon SQS as a pattern a future AWS build (SQS plus Aurora, swapped in by a different Docker build) might use. No SQS adapter or test is written. Note the SQS constraints the interface must not rule out: at-least-once delivery, a 15-minute maximum delay, a 256 KB message limit, a visibility timeout instead of a lock, and no job status kept by the queue.

Decision record decision-54 (status proposed) holds the interface, the mapping table, the measured results, the TASK-379 implications and the contract test (Appendix A). Measured with Docker (Redis 8.2.10, RabbitMQ 4.1.8, Node 24.18.0): the contract (C1 to C11) passed 11 of 11 on the in-process transport, a throwaway BullMQ 6.3.14 adapter and a throwaway amqplib 2.2.0 adapter in 3 runs each, and on Fedify SqliteMessageQueue 2.4.0 (3 runs) and RedisMessageQueue 2.4.0 (2 runs) unchanged. @fedify/amqp 2.4.0 failed 9 of 11 with default options (double ack, 406 unknown delivery tag) and failed C7 in 3 of 5 runs with nativeRetrial. Injected defects (no recovery, no requeue on stop, settled at once, no claim guard) each failed the cases expected. The throwaway code and containers were removed. Follow-ups filed: TASK-391 (queue and in-process implementation), TASK-392 (strip-metadata) and TASK-393 (resend), both depending on TASK-391. A note was added to TASK-379. AC #7 waits for the user to read and accept decision-54; the task stays In Progress until then.

2026-10-13: the user accepted decision-54 in chat; its status is now accepted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Designed and recorded in decision-54, which the user accepted on 2026-10-13. Follow-up build tasks are filed under M39 (m-38) and reference it.
<!-- SECTION:FINAL_SUMMARY:END -->
