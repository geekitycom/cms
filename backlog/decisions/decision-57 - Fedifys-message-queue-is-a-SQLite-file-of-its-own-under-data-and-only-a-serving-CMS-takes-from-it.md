---
id: decision-57
title: >-
  Fedify's message queue is a SQLite file of its own under data/, and only a
  serving CMS takes from it
date: '2026-10-14 14:47'
status: accepted
---
## Context

decision-5 ran Fedify on `InProcessMessageQueue` for phase one. Outgoing deliveries, inbox processing and the retries Fedify schedules lived only in memory. A restart dropped every scheduled retry, and the old worker under `geekity serve` had to send everything it had queued before it could hand over (TASK-288). decision-5 said a persistent queue would be a configuration change later. decision-52 asked for the move, and decision-54 measured `SqliteMessageQueue` from `@fedify/sqlite` 2.4 against the job queue contract (TASK-380).

## Decision

This supersedes decision-5 for the message queue. The KV store stays `MemoryKvStore`.

1. **The default queue is `SqliteMessageQueue` in `data/queue.sqlite`, table `federation_messages`.** The file is not `data/geekity.db`, because that one is derived and `geekity rebuild` deletes it. The file is named for any queue, so admin jobs can later take a table of their own in it (decision-54). It is created mode `0600`, because a waiting outgoing delivery carries the private key it is signed with. `@fedify/sqlite` is a dependency of `@geekity/cms`.
2. **Only a serving CMS takes messages.** Fedify is built with `manuallyStartQueue`, and the CMS lifecycle starts the queue when the site starts. A CMS that a CLI command builds, or that a test never serves, can queue messages but leaves them in the file for the server. On start, the server sends what an earlier process left there.
3. **A worker stops taking messages from its own queue when it drains or closes.** The queue around the built-in SQLite queue pauses its listener at the stop step. `settled()` then waits only for the handlers in flight. Messages still waiting stay in the file, and the next worker sends them. A worker whose reload failed resumes taking messages. Only the built-in queue is treated as durable. A queue passed through `federation.queue` is never paused, whatever it is, and `settled()` still waits for every message that worker queued for now, as TASK-382 made it do. The CMS cannot tell whether a supplied queue keeps its messages: a `ParallelMessageQueue` around an `InProcessMessageQueue` holds them in memory, and pausing it would lose them.
4. **Dev mode holds a waiting delivery too.** The queue drops an outbox or fanout message while dev mode is on and records it as held. A `data/` copied from a live site can carry waiting deliveries, and the hold before sending does not see those.

## Consequences

- A waiting delivery and a scheduled retry survive a stop, a crash and a reload. A delivery whose handler is running when the process dies is lost: `SqliteMessageQueue` deletes the row when it takes it, so it delivers at most once. A graceful stop is not affected, because `settled()` waits for the handler.
- Two workers on one file never handle the same message: the take is `DELETE ... RETURNING` inside `BEGIN IMMEDIATE`. Under `geekity serve` they do not overlap anyway, because the old worker stops taking messages before the supervisor forks the new one.
- A reload no longer waits for a large fan-out to finish. The new worker sends the rest.
- A message or retry the running worker queued itself is taken at once or when it comes due. One another process queued, such as a retry an earlier worker scheduled, waits up to one poll interval, 5 seconds, after it comes due. On start, the server takes everything already due.
- `data/queue.sqlite` is a kept file in decision-52's data classes, and a secret one while deliveries wait. Deleting it while the site is stopped loses the waiting deliveries and retries, and nothing else.
