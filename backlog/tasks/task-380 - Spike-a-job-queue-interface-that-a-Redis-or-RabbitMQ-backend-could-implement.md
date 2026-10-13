---
id: TASK-380
title: 'Spike: a job queue interface that a Redis or RabbitMQ backend could implement'
status: To Do
assignee: []
created_date: '2026-10-13 11:24'
updated_date: '2026-10-13 12:10'
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
- [ ] #1 A decision record gives the job queue interface: its operations, the job and status types, and the guarantees a handler may rely on, such as at least once delivery and how it should behave when run twice
- [ ] #2 A table maps every operation and guarantee in the interface onto BullMQ, RabbitMQ and Fedify MessageQueue (with @fedify/sqlite), saying for each how it is done or why it cannot be, and what the in-process implementation does
- [ ] #3 Where a backend keeps no job status, the record says where status lives instead, and the interface separates running jobs from reporting their status if that is the answer
- [ ] #4 Claims about BullMQ and RabbitMQ are checked against the real thing: a throwaway adapter for each passes the same contract test as the in-process one, run against a real Redis and a real RabbitMQ (for example in Docker), with the results in the record; the adapters are not merged
- [ ] #5 The record says whether one backend could carry both admin jobs and Fedify messages, and what that would take
- [ ] #6 Follow-up tasks are filed for the chosen interface and its in-process implementation; nothing is implemented for production in this task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope added 2026-10-13: also check the interface on paper against Amazon SQS as a pattern a future AWS build (SQS plus Aurora, swapped in by a different Docker build) might use. No SQS adapter or test is written. Note the SQS constraints the interface must not rule out: at-least-once delivery, a 15-minute maximum delay, a 256 KB message limit, a visibility timeout instead of a lock, and no job status kept by the queue.
<!-- SECTION:NOTES:END -->
