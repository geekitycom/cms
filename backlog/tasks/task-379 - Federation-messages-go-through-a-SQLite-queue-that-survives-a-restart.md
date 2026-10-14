---
id: TASK-379
title: Federation messages go through a SQLite queue that survives a restart
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 11:18'
updated_date: '2026-10-14 14:54'
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
- [x] #1 A delivery queued, and a retry Fedify scheduled for later, are still sent after the CMS process is stopped and started again; a test proves each
- [x] #2 The queue lives in its own SQLite file under the data directory; geekity rebuild leaves it, and the pending messages in it, untouched
- [x] #3 During a supervised reload (geekity serve) each queued message is handled exactly once, not by both the old and the new worker; a test proves it
- [x] #4 Dev mode still holds every outgoing ActivityPub delivery and relay follow, as it does today
- [x] #5 @fedify/sqlite is a dependency of @geekity/cms, and the Docker image runs with it
- [x] #6 A decision record supersedes decision-5 for the message queue, and docs/personal-data.md and docs/federation.md say where the queue is stored and what it holds
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Default queue: a SqliteMessageQueue on data/queue.sqlite (table federation_messages), opened by store/queue-database.ts (node:sqlite stays inside store/). @fedify/sqlite moves to dependencies.
2. createSettlingQueue gets a durable mode: for a durable queue it stops taking messages when the CMS stops (drain or close) and settled() waits only for handlers in flight; messages still waiting stay in the file for the next worker. pause/resume so a failed reload's old worker takes messages again. An in-memory queue passed in config keeps today's counting (TASK-382).
3. Fedify starts its queue only when the CMS starts (manuallyStartQueue), so only a serving CMS takes messages; the lifecycle start calls federation.startQueue, which also sends what an earlier process left in the file.
4. Dev mode: the queue drops outbox and fanout messages while dev mode is on and records them as held, so messages copied in with a production data/ are not sent.
5. Tests first: queued delivery and a scheduled retry survive close/start (in-process CMS with a local peer); geekity rebuild leaves data/queue.sqlite and its rows; geekity serve reload with pre-filled queue delivers each message once; dev mode holds a leftover message; queue.test.ts cases for durable mode.
6. Docs: federation.md, configuration.md, content.md data/ table, personal-data.md; decision record superseding decision-5 for the queue.
7. Verify with pnpm build/test/typecheck/lint/format:check, and a Docker image build and boot.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-380 (see the job queue decision record in the references, section "What this means for TASK-379"): name the SQLite file for any queue rather than for Fedify (for example data/queue.sqlite) and pass tableName, so admin jobs can later share the file in a table of their own; two tables in one file were measured not to see each other's messages. SqliteMessageQueue deletes a row when it takes it, before the handler runs, so it is at most once: a delivery in its handler when the process dies is lost, while waiting messages and scheduled retries survive. On the two-workers question: two processes listening on one table handled 300 messages with no duplicate (the take is DELETE ... RETURNING inside BEGIN IMMEDIATE), and the supervisor drains the old worker before forking the new one. After the move, the settled() count only needs to cover handlers in flight. The default poll interval is 5 s, so a message enqueued by another process waits up to that long. Avoid @fedify/amqp 2.4.x with default options: it acks an async handler twice and RabbitMQ closes the channel.

Built:
- store/queue-database.ts opens data/queue.sqlite (mode 0600, busy timeout 5 s); node:sqlite stays inside store/, so the sqlite-boundary allow-list is unchanged.
- federation/queue.ts: createFederationQueue builds the default SqliteMessageQueue (table federation_messages) or wraps a config queue. createSettlingQueue gained a durable mode with pause/resume: a durable queue stops taking messages at the lifecycle stop step (drain and close), settled() waits for the paused listener and the handlers in flight, and waiting messages stay in the file. Durable messages are stored raw, without the TASK-382 envelope, so any process can produce them. An InProcessMessageQueue passed in config keeps the TASK-382 counting and is never paused.
- services.ts builds Fedify with manuallyStartQueue; the lifecycle start resumes the queue and calls federation.startQueue, which also takes what an earlier process left. A CMS that never serves (CLI, tests) queues but does not take.
- Dev mode: the queue's hold drops an outbox or fanout message while dev mode is on and appends a held entry to data/dev-mode.jsonl. Found while checking AC #4: a data/ copied from a live site carries waiting deliveries, which holdOutbound (called before enqueue) never sees.
- Found: a waiting outbox message holds the sender's private key as a JWK, so the file is created 0600 and the docs say so.
- @fedify/sqlite moved to dependencies (^2.4.0).

Open questions:
- Two workers on one queue: safe. The take is DELETE ... RETURNING inside BEGIN IMMEDIATE, so a message goes to one connection only (decision-54 measured 300 messages across two processes with no duplicate). In the real flow they do not overlap anyway: the supervisor sends drain, the old worker pauses its listener at the stop step before the drain resolves, and only then does the supervisor fork the new worker. The old worker no longer listens between drain and close (before this change it listened until close). cli-federation-queue.test.ts drives geekity serve: 20 deliveries, the first held by the peer while the reload starts; all 20 arrive once and the file is empty.
- settled() counting: for the durable default it now covers only handlers in flight (and the paused listener's last poll). The per-message pending count is kept only for an in-memory queue passed through config, which would otherwise lose what it holds on close (TASK-382 AC #1).

Behaviour changes: a reload no longer waits for queued deliveries to go out; the new worker sends them. data/ now holds queue.sqlite, a kept file (rebuild.test.ts updated). The TASK-288 AC #4 test in delivery.test.ts was replaced by the TASK-379 AC #3 drain test, and the TASK-382 tests now serve the CMS because only a serving CMS takes from a queue.

Limits: at-most-once, so a delivery whose handler is running when the process is killed is lost. A message another process queued, including a retry an earlier worker scheduled, waits up to the 5 s poll interval after it is due; the AC #1 retry test takes about 5 s for that reason. The decision record was created with backlog decision create; the CLI has no body option, so its sections were written into the created file.

Verification: pnpm build, typecheck, lint, format:check pass; pnpm test passes (cms 6018/6018, all packages 0 failures). New tests: delivery.test.ts TASK-379 suite (AC #1 queued and retry, AC #3 drain, AC #4 dev mode) failed against HEAD's queue.ts and services.ts (nothing sent to the next CMS; 'a delivery of a Create never came'; 'no such table: federation_messages') and pass now. cli-rebuild.test.ts (AC #2: a waiting and a delayed message survive geekity rebuild). cli-federation-queue.test.ts (AC #3 under geekity serve with a reload). queue.test.ts durable-mode cases (failed with 'queue.pause is not a function' before). AC #4 also rests on the existing dev-mode tests, which pass. AC #5: docker build of the repo Dockerfile succeeded; the container served /healthz 200, /app/node_modules/@fedify/sqlite was present, and /site/data/queue.sqlite was created -rw------- with tables federation_messages and federation_messages_locks; container and image removed after. AC #6: decision-57 supersedes decision-5 for the queue; docs/federation.md (The message queue), personal-data.md, content.md data/ table and configuration.md updated.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fedify now runs on a SqliteMessageQueue in data/queue.sqlite (table federation_messages, mode 0600), apart from geekity.db, so waiting deliveries and scheduled retries survive a restart, a crash and a reload, and geekity rebuild leaves them alone. Only a serving CMS takes messages (manuallyStartQueue plus a lifecycle start); a worker pauses its listener when it drains or closes and waits only for the handlers in flight, leaving the rest for the next worker, so a supervised reload hands each message to one worker. Dev mode drops and records a waiting outgoing delivery. @fedify/sqlite is a dependency; decision-57 supersedes decision-5 for the queue; docs updated. Verified with new in-process, CLI and geekity serve tests that failed before the change, the full test suite, and a Docker image build and boot.
<!-- SECTION:FINAL_SUMMARY:END -->
