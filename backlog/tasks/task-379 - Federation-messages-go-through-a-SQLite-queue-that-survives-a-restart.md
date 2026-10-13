---
id: TASK-379
title: Federation messages go through a SQLite queue that survives a restart
status: To Do
assignee: []
created_date: '2026-10-13 11:18'
updated_date: '2026-10-13 16:48'
labels: []
milestone: m-38
dependencies:
  - TASK-382
  - TASK-380
references:
  - packages/cms/src/federation/queue.ts
  - packages/cms/src/federation/federation.ts
  - packages/cms/src/cms/services.ts
  - >-
    backlog/decisions/decision-52 -
    A-site-is-one-container-and-its-directory-foundational-systems-sit-behind-async-interfaces-a-build-can-swap.md
  - >-
    backlog/decisions/decision-54 -
    Admin-jobs-run-on-a-swappable-transport-with-their-status-in-a-CMS-owned-job-record.md
priority: medium
type: enhancement
ordinal: 338800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fedify currently runs on `InProcessMessageQueue` (packages/cms/src/federation/federation.ts), wrapped by `createSettlingQueue` (packages/cms/src/federation/queue.ts). Outgoing deliveries, inbox processing and every retry Fedify schedules live only in memory: a reload or restart drops a scheduled retry, and the old worker under `geekity serve` has to send what it queued before it can close. decision-5 chose this for phase one and said moving to a persistent queue later would be a configuration change.

Move Fedify's message queue to `SqliteMessageQueue` from `@fedify/sqlite`, which runs on `node:sqlite` like the rest of the CMS, so queued and retried messages survive a restart with no new service to run. The queue gets its own database file under `data/`, not `data/geekity.db`: that database is derived and `geekity rebuild` deletes it, which would drop pending deliveries. `@fedify/sqlite` is currently only a transitive dev dependency (through `@fedify/cli`) and becomes a real dependency of `@geekity/cms`.

The KV store (`MemoryKvStore`) is out of scope; it holds caches that are fine to refetch.

Open questions for the worker to settle and record: whether two workers listening on the same SQLite queue during a supervised reload is safe or the old worker must stop listening first; and what the in-memory `settled()` counting in `createSettlingQueue` is still needed for once nothing queued is lost on close.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A delivery queued, and a retry Fedify scheduled for later, are still sent after the CMS process is stopped and started again; a test proves each
- [ ] #2 The queue lives in its own SQLite file under the data directory; geekity rebuild leaves it, and the pending messages in it, untouched
- [ ] #3 During a supervised reload (geekity serve) each queued message is handled exactly once, not by both the old and the new worker; a test proves it
- [ ] #4 Dev mode still holds every outgoing ActivityPub delivery and relay follow, as it does today
- [ ] #5 @fedify/sqlite is a dependency of @geekity/cms, and the Docker image runs with it
- [ ] #6 A decision record supersedes decision-5 for the message queue, and docs/personal-data.md and docs/federation.md say where the queue is stored and what it holds
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-380 (see the job queue decision record in the references, section "What this means for TASK-379"): name the SQLite file for any queue rather than for Fedify (for example data/queue.sqlite) and pass tableName, so admin jobs can later share the file in a table of their own; two tables in one file were measured not to see each other's messages. SqliteMessageQueue deletes a row when it takes it, before the handler runs, so it is at most once: a delivery in its handler when the process dies is lost, while waiting messages and scheduled retries survive. On the two-workers question: two processes listening on one table handled 300 messages with no duplicate (the take is DELETE ... RETURNING inside BEGIN IMMEDIATE), and the supervisor drains the old worker before forking the new one. After the move, the settled() count only needs to cover handlers in flight. The default poll interval is 5 s, so a message enqueued by another process waits up to that long. Avoid @fedify/amqp 2.4.x with default options: it acks an async handler twice and RabbitMQ closes the channel.
<!-- SECTION:NOTES:END -->
