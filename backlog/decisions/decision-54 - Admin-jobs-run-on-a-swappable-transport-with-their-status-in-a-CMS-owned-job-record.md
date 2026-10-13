---
id: decision-54
title: >-
  Admin jobs run on a swappable transport with their status in a CMS-owned job
  record
date: '2026-10-13 16:45'
status: accepted
---
## Context

Two admin actions take long enough to risk a proxy timeout if they run inside the request. The first sweeps `content/uploads/` for location and camera metadata (`geekity strip-metadata`, `stripStoredUploads` in packages/cms/src/content/metadata/sweep.ts). The second resends announced posts to their followers (`geekity resend`, and the resend button on the federation screen, which calls `delivery.resend` inside the request). Both should become jobs that the admin queues, and the admin then shows their progress and result. The button must not hold the request open.

decision-52 sets the frame. A site is one container. Foundational systems sit behind async interfaces that a different build can swap. SQS and Aurora are patterns the interfaces must not rule out, and nothing is built for them. The first implementation is in-process, on `createSerialQueue` (packages/cms/src/util/queue.ts), with job status kept in a file under `data/`.

A draft shape came out of discussion: a job is a name plus a JSON payload, a handler is registered per name at startup, and the queue offers enqueue, status by id, latest status for a name, `settled()` and `close()`. A status is queued, running (with progress), finished (with a result), failed or interrupted. TASK-380 tested that draft against real brokers before adopting it.

### What was tested

One contract test (Appendix A) ran against six transports. Each run used a fresh queue name and a fresh job record file. Redis and RabbitMQ ran in Docker.

| Transport | Versions | Contract cases C1 to C11 | P1: hands a message out again after a consumer dies |
| --- | --- | --- | --- |
| In-process, on `createSerialQueue` | Node 24.18.0 | 11 of 11, in 3 runs | no |
| BullMQ adapter (throwaway) | bullmq 6.3.14, Redis 8.2.10 | 11 of 11, in 3 runs | yes |
| RabbitMQ adapter on amqplib (throwaway) | amqplib 2.2.0, RabbitMQ 4.1.8 | 11 of 11, in 3 runs | yes |
| Fedify `SqliteMessageQueue` as it ships | @fedify/sqlite 2.4.0, `node:sqlite` | 11 of 11, in 3 runs | no |
| Fedify `RedisMessageQueue` as it ships | @fedify/redis 2.4.0, ioredis 5.11.1, Redis 8.2.10 | 11 of 11, in 2 runs | no |
| Fedify `AmqpMessageQueue` as it ships, default options | @fedify/amqp 2.4.0, amqplib 0.10.9, RabbitMQ 4.1.8 | 2 of 11 | no |
| Fedify `AmqpMessageQueue` with `nativeRetrial: true` | as above | 11 of 11 in 2 of 5 runs; C7 failed in 3 | yes |

The cases are these:

- C1 runs a job and reports its result, which round-trips a nested JSON payload.
- C2 reports progress while the job runs.
- C3 records a failure and still runs the next job.
- C4 gives the newest job of a name from `latest(name)`, and nothing for a name that never ran.
- C5 refuses a job whose name has no handler. It also starts and closes a queue at once, which caught a real bug in the first RabbitMQ adapter.
- C6 checks that `settled()` waits for the running job.
- C7 stops the queue while a job runs. The job goes back to queued without using up an attempt, and a restarted queue runs it to the end.
- C8 kills the transport while a job runs, with no goodbye. A restarted queue runs the job again as attempt 2, and a broker redelivering the dead message does not run it a third time.
- C9 checks that a job cut off `maxAttempts` times ends as interrupted and is not run again.
- C10 sends the same message twice more after the job finished. The handler runs once.
- C11 checks that a job queued while no worker listened runs once after a restart.
- P1 is an observation, not a pass or fail case. It records whether the transport itself hands out a message again when its consumer dies mid-handler.

The test was checked against injected defects. Removing start-up recovery failed C7, C8, C9 and C11 in-process, and C8 and C9 on BullMQ. Requeueing a stopped job as failed instead failed C7 in-process and on RabbitMQ. Making `settled()` resolve at once failed C6. Removing both the state check before a claim and the compare-and-set in the record store failed C10 on every transport, and C7 to C11 on the brokers. The compare-and-set alone, without the state check, passed all 11 cases on in-process, BullMQ and RabbitMQ.

Commands, run from a scratch directory in the TASK-380 worktree that has since been deleted:

```sh
# compose.yaml: redis:8.2-alpine on 56379, rabbitmq:4.1-alpine on 55672, project geekity-queue-spike
docker compose up -d
npm install bullmq@6.3.14 amqplib@0.10 amqplib2@npm:amqplib@2.2.0 ioredis@^5.8.2 \
  @fedify/fedify@2.4.0 @fedify/sqlite@2.4.0 @fedify/redis@2.4.0 @fedify/amqp@2.4.0
node --test --test-reporter=spec test/backends.test.ts            # every transport
BACKEND=BullMQ node --test --test-reporter=spec test/backends.test.ts   # one transport
docker compose down -v
```

### Findings about the backends

- **No Fedify backend gives the handler an acknowledgement.** Fedify's `MessageQueue` is `enqueue(message, { delay?, orderingKey?, deduplicationKey? })` plus `listen(handler, { signal })`. `SqliteMessageQueue` deletes the row in the same transaction that takes it, before the handler runs. `RedisMessageQueue` removes the member from its sorted set before the handler runs. Both are at most once: a message whose handler is running when the process dies is gone (P1: no). Fedify does its own retries by enqueueing again with a delay (`nativeRetrial = false`).
- **@fedify/amqp 2.4.0 acknowledges an async handler twice by default.** With `nativeRetrial` false, `listen` acks in a `finally` block as soon as the handler returns its promise, then acks again when the promise settles. RabbitMQ closes the channel with `406 PRECONDITION_FAILED - unknown delivery tag 1`, and the queue stops working. The published 2.4.4 has the same `listen` code. With `nativeRetrial: true` it acks after the handler and nacks with requeue on failure, which is at least once (P1: yes). In that mode it still closes the channel on abort without waiting for a running handler, so the late ack throws. That is why C7 failed in 3 of 5 runs. This is worth reporting upstream before anyone picks @fedify/amqp.
- **@fedify/redis breaks with a poll interval under 500 ms.** It locks with `SET NX EX floor(pollInterval * 2 s)`. A 200 ms interval gives `EX 0`, which Redis rejects, and every poll logs an error and does nothing. One second works.
- **SQLite claims each message once across processes.** Two processes listening on one `SqliteMessageQueue` table handled 300 messages with no duplicate (46 and 254 each). Two tables in one SQLite file, one for Fedify and one for jobs, did not see each other's messages.
- **BullMQ keeps job state, RabbitMQ does not.** BullMQ stores each job as a Redis hash with state, progress, return value and failure reason, until `removeOnComplete` or `removeOnFail` prunes it. It redelivers a job whose lock expired (`lockDuration`, 30 s by default) up to `maxStalledCount` times (1 by default), then fails it. RabbitMQ deletes a message once it is acked and keeps no history. An unacked message returns to the queue when its channel closes (P1: yes).
- **A `listen` must check `signal.aborted` before it waits.** The first RabbitMQ adapter connected asynchronously and then added its abort listener. A queue closed straight after `start()` aborted before the listener existed, so `close()` never returned. C5 caught it.

### On paper only

- **Amazon SQS** (from the SQS message quotas page, read 2026-10-13). A standard queue delivers at least once and may deliver out of order. A FIFO queue deduplicates within 5 minutes. A message is at most 1 MiB, which replaces the 256 KB figure in TASK-380's notes. A message delay is at most 15 minutes. A received message is hidden for a visibility timeout (30 s by default, 12 hours at most) and comes back unless it is deleted, so a long handler must extend its visibility. A message is kept at most 14 days. SQS keeps no job status.
- **pg-boss and Graphile Worker**, from their documentation and not tested. Both keep jobs in Postgres tables with a state and a lock, and both retry failures with backoff. pg-boss keeps finished jobs for a retention period. Graphile Worker deletes a job once it succeeds. In an Aurora build either could be the transport, and pg-boss could also hold the job records in the same database. That fits the split below and does not change it.

## Decision

1. **The admin and the CLI use one `JobQueue` interface. Under it are two swap points: a `MessageTransport` that carries work, and a `JobRecords` store that holds status.** Status never depends on the broker. One reason is that RabbitMQ, SQS and every Fedify backend keep none. The other is that a broker which does keep status (BullMQ) would make the admin read a different source per build.

2. **A message carries only the job id.** The name, payload, attempt, progress and result live in the job record. A message is a few dozen bytes on any backend, so SQS's size limit and RabbitMQ's message size limit never come up. The record is the one source for recovery.

3. **The transport is a structural subset of Fedify's `MessageQueue`.** Every Fedify backend is a transport as it ships, and the contract proved it for `SqliteMessageQueue` and `RedisMessageQueue`. A BullMQ or RabbitMQ transport is about 50 lines. An SQS transport would delete the message after the handler returns and extend its visibility while the handler runs.

4. **A job is data.** A job is a registered name and a JSON payload under 64 KB. The payload is copied through `JSON.stringify` at `enqueue`, and the handler parses it as a boundary. Closures never cross the queue. A name with no handler is refused at `enqueue`. A message whose record names a missing handler, because a plugin was removed, ends as failed.

5. **Execution is at least once, and a handler must be safe to run twice.** The job layer adds two guards on top of any transport:
   - A claim is a compare-and-set from `queued` at attempt n to `running` at attempt n. A duplicate or late message finds the record already claimed or finished and does nothing. C10 and C8 prove this on brokers that redeliver.
   - The attempt number is a fencing token. Every later write by a handler (`progress`, `finished`, `failed`) expects `running` at its own attempt. A worker that lost its job gets `JobLostError` from `progress()` and its result is dropped.

   One window remains. A handler that finished its work and died before writing `finished` runs again. strip-metadata already skips clean files. Resend sends an `Update` again, which receivers treat as the same post.

6. **The states and transitions are fixed.**

   | From | Event | To |
   | --- | --- | --- |
   | (new) | `enqueue` | `queued`, attempt 1 |
   | `queued` n | a worker claims it | `running` n, with owner and `startedAt` |
   | `running` n | `progress()` | `running` n, with progress |
   | `running` n | handler returns | `finished` n, with result |
   | `running` n | handler throws | `failed` n, with the error message |
   | `running` n | the queue stops and the handler gives up | `queued` n (a graceful stop uses no attempt) |
   | `running` n, owner gone | start-up recovery, n < maxAttempts | `queued` n+1, with `interruptedAt` |
   | `running` n, owner gone | start-up recovery, n = maxAttempts | `interrupted` n, terminal |

   `maxAttempts` defaults to 3. It stops a job that crashes the process from crash-looping the site. A failed job is not retried automatically. The admin shows the error and offers to run it again, which enqueues a new job with the same name and payload.

7. **`stop()`, `settled()` and `close()` are about this process only.** `stop()` stops taking messages and aborts the `signal` handed to the running handler. `settled()` resolves when no handler in this process is running. `close()` is `stop()`, then `settled()`, then waiting for the transport's `listen` to return. None of them waits for the queue to be empty. Under `geekity serve`, a drain or close is quick because a handler checks its signal between items. The job goes back to queued, and the next worker runs it. A handler that ignores the signal is waited for, as any other `settled()` is. On a broker shared by several processes the same meaning still holds, because it never claimed more than this process's own work.

8. **Start-up recovery assumes one worker per site.** On `start()`, every `running` record that this worker does not own is treated as cut off, and every `queued` record is enqueued again on the transport. Duplicate messages are harmless by point 5. This is correct for one container (decision-52), and the supervisor drains the old worker before it forks the new one. It is not correct for several workers at once. Those would need a lease on the running record (owner plus expiry, renewed with progress), as BullMQ's lock and SQS's visibility timeout do. The record type leaves room for that, and nothing is built for it.

9. **Delays and retries are not part of the interface yet.** Neither first user needs them. The scheduler and other timers stay in-process (decision-52). If a delay is ever needed, the transport already has Fedify's `delay` option, and the mapping table shows each backend can carry it, SQS only up to 15 minutes.

10. **The first implementation is the in-process transport plus a file record store.** The transport runs one job at a time on `createSerialQueue`. Records live in `data/jobs.json`, written by atomic rename, with only the newest few records per name kept. It is a kept file in the data classes of decision-52, because it holds queued jobs. Losing it would lose only queued jobs and history. Fedify's `SqliteMessageQueue` passes the same contract, so moving jobs onto TASK-379's SQLite file later is a configuration change.

### Interface

```ts
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export interface Progress {
  readonly done: number;
  readonly total?: number;
  readonly note?: string;
}

export type JobState =
  | { readonly state: 'queued'; readonly attempt: number; readonly interruptedAt?: string }
  | {
      readonly state: 'running';
      readonly attempt: number;
      readonly owner: string;
      readonly startedAt: string;
      readonly progress?: Progress;
    }
  | { readonly state: 'finished'; readonly attempt: number; readonly finishedAt: string; readonly result: Json }
  | { readonly state: 'failed'; readonly attempt: number; readonly finishedAt: string; readonly error: string }
  | { readonly state: 'interrupted'; readonly attempt: number; readonly interruptedAt: string };

export type JobStatus = {
  readonly id: string;
  readonly name: string;
  readonly payload: Json;
  readonly queuedAt: string;
} & JobState;

export interface JobContext {
  /** Aborted when the queue stops. Check it between items and throw to give the job back. */
  readonly signal: AbortSignal;
  readonly attempt: number;
  /** Throws JobLostError when this worker no longer owns the job. */
  progress(progress: Progress): Promise<void>;
}

/** A handler parses its own payload: the payload crossed a boundary. */
export interface JobDefinition<P extends Json, R extends Json> {
  readonly name: string;
  parse(payload: Json): P;
  run(payload: P, context: JobContext): Promise<R>;
}

/** What the admin and the CLI use. */
export interface JobQueue {
  enqueue<P extends Json>(job: JobDefinition<P, Json>, payload: P): Promise<string>;
  status(id: string): Promise<JobStatus | undefined>;
  latest(name: string): Promise<JobStatus | undefined>;
  start(): Promise<void>;
  stop(): void;
  settled(): Promise<void>;
  close(): Promise<void>;
}

/** Swap point 1. Any Fedify MessageQueue satisfies it. */
export interface MessageTransport {
  enqueue(message: unknown): Promise<void>;
  listen(
    handler: (message: unknown) => Promise<void>,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

/** Swap point 2. Every transition is a compare-and-set on state and attempt. */
export interface JobRecords {
  create(status: JobStatus): Promise<void>;
  get(id: string): Promise<JobStatus | undefined>;
  latest(name: string): Promise<JobStatus | undefined>;
  list(states: readonly JobState['state'][]): Promise<JobStatus[]>;
  transition(
    id: string,
    expected: Pick<JobState, 'state' | 'attempt'>,
    next: JobState,
  ): Promise<boolean>;
}
```

The spike's runner took a name string and a `Map` of handlers. The typed `JobDefinition` above is the shape to build, so that `enqueue(stripMetadata, payload)` checks the payload type at compile time. A build swaps the transport and the records through config, in the way `config.federation.queue` already works, for example `config.jobs.{transport,records}`.

### Mapping

"Job layer" means the runner in Appendix B, which is the same on every transport.

| Operation or guarantee | In-process (`createSerialQueue`) | BullMQ | RabbitMQ (amqplib) | Fedify `SqliteMessageQueue` | SQS (paper) |
| --- | --- | --- | --- | --- | --- |
| `enqueue` sends `{ id }` | push onto the serial queue, or hold it until `listen` | `queue.add('job', { id })` | `sendToQueue`, persistent, confirm channel | `INSERT` row | `SendMessage` |
| `listen(handler, { signal })` | runs one at a time; abort drops what has not started | `Worker`, concurrency 1; abort calls `worker.close()`, which waits for the active job | `prefetch(1)`, ack after the handler; abort cancels, waits for in-flight handlers, then closes | poll plus an in-process wake-up; abort stops polling | long-poll `ReceiveMessage`; delete after the handler |
| Transport guarantee (P1, measured) | at most once; memory dies with the process | at least once; a stalled job is redelivered after `lockDuration` | at least once; an unacked message is requeued when the channel closes | at most once; the row is deleted before the handler runs | at least once; the message reappears after the visibility timeout |
| Execution guarantee | at least once, from records plus recovery (C8, C11) | at least once (C8, C11) | at least once (C8, C11) | at least once (C8, C11) | at least once by design |
| Duplicate message | not produced except by recovery; claim drops it (C10) | redelivered stall dropped by the claim (C8, C10) | redelivery dropped by the claim (C8, C10) | not produced except by recovery; claim drops it (C10) | expected; claim drops it |
| Status, progress, result | job record | job record. BullMQ's own job hash is not used, and `removeOnComplete` deletes it. | job record. The broker keeps none. | job record. The table only holds pending rows. | job record. SQS keeps none. |
| `status(id)`, `latest(name)` | read the record store | read the record store | read the record store | read the record store | read the record store (Aurora in that build) |
| `settled()` | no handler running here (C6) | same (C6) | same (C6) | same (C6) | same |
| `stop()` mid-job | job back to `queued` n; the new worker runs it (C7) | same; the job layer enqueues `{ id }` again before BullMQ acks (C7) | same (C7) | same (C7) | same; delete the message, or set its visibility to 0 |
| Crash mid-job | recovery: `queued` n+1, then run (C8) | recovery runs it; BullMQ's later stalled redelivery is dropped (C8) | recovery runs it; RabbitMQ's redelivery is dropped (C8) | recovery runs it; the row was already gone (C8) | recovery or visibility timeout; the claim keeps one run |
| Crash loop | `interrupted` after `maxAttempts` (C9) | same; BullMQ's `maxStalledCount` alone would fail it after 1 stall | same (C9) | same (C9) | same; a redrive policy is not needed |
| Delay (not in the interface) | a timer, lost on exit | `delay` option, durable | no native delay; TTL plus dead-letter queue, as @fedify/amqp does, or the delayed-message plugin | `delay` option, durable (`scheduled` column) | `DelaySeconds`, 15 minutes at most |
| Retry on failure (not in the interface) | none; the admin offers a new run | `attempts` and `backoff`, not used | nack with requeue, not used | Fedify retries by enqueueing again | redelivery after visibility timeout, not used |
| Size limit | none | Redis value, 512 MB | `max_message_size`, 16 MiB by default in RabbitMQ 4 | none | 1 MiB; a message is a few dozen bytes |
| Several processes | not possible | yes; needs a lease in the records (point 8) | yes; needs a lease | yes; one claim per row across processes (measured) | yes; needs a lease |

### One backend for admin jobs and Fedify messages

One backend can carry both. Because the transport is a subset of Fedify's `MessageQueue`, any Fedify backend can carry jobs, and the contract proved it for SQLite and Redis. They need separate queues. Two listeners on one queue would take each other's messages, and Fedify's handler would get `{ id }` messages it cannot read. With SQLite this means one database file and two tables. The measured case used `fedify_message` and `geekity_job`, and neither saw the other's message. With Redis it means two key prefixes, and with RabbitMQ two queue names.

For a solo site there is little reason to move jobs off the in-process transport now. Recovery from the record file already makes jobs survive a restart. Moving them onto TASK-379's SQLite file would add one thing: a CLI process could enqueue a job that the running server picks up within one poll interval. That is a small change once TASK-379 lands, and it is not part of the first build.

### What this means for TASK-379

- Name the SQLite file for any queue, not only Fedify (for example `data/queue.sqlite`), and pass `tableName` for each use. That keeps the jobs option open with no second file.
- `SqliteMessageQueue` is at most once. A delivery whose handler is running when the process dies is lost, because its row was deleted when it was taken. TASK-379's first criterion holds for messages still waiting and for retries Fedify has scheduled. It does not hold for a message in its handler at the moment of a crash. A graceful stop is not affected, because `settled()` waits for the handler.
- The two-workers question in TASK-379 has evidence. One table shared by two processes handled each of 300 messages once, because the take is a `DELETE ... RETURNING` inside `BEGIN IMMEDIATE`. The supervisor also drains the old worker before it forks the new one.
- After the move, `createSettlingQueue`'s count needs to cover only handlers in flight, not messages waiting. Waiting messages survive in the file.
- The default poll interval is 5 seconds. A message enqueued in the same process wakes its listener at once. A message from another process waits up to one poll interval.

## Consequences

- Admin jobs survive a restart and a supervised reload with no new service to run. A cut-off job runs again as a new attempt, up to three times, and then shows as interrupted.
- Every handler must be safe to run twice, must check its signal between items, and must report progress through `progress()`. The build tasks need to prove this for strip-metadata and resend.
- The CLI commands become thin layers over the same queue. A CLI process must not run start-up recovery while a server may be running, because it would treat the server's running job as cut off. The CLI runs its own job by id and waits for it. Writes to `data/jobs.json` from two processes need a lock so that the compare-and-set stays atomic. The first build task covers both.
- An AWS build would supply an SQS transport and an Aurora record store, and would need a lease on running records before it runs more than one worker. Nothing else in the interface changes.
- The throwaway BullMQ and RabbitMQ adapters, the Fedify runs and the Docker setup were deleted after the spike. Appendix A keeps the contract test so the build can adopt it, and Appendix B keeps the runner as a reference.

## Appendix A: contract test

The spike's contract test, as it ran. A backend supplies `namespace()`, which returns `connect()` for one process's view of the transport, with `crash()` to kill it without a goodbye. `redeliveryWaitMs` is how long the test waits for a broker to hand out a dead consumer's message again. The build should adopt it with the typed `JobDefinition` handlers and run it against the in-process transport and `SqliteMessageQueue`.

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { createFileRecords } from '../src/records-file.ts';
import { createJobQueue } from '../src/runner.ts';
import type { JobHandler, JobQueue, JobRecords, JobStatus, MessageTransport } from '../src/types.ts';

/** One process's view of the backend: a transport and a way to kill it without any goodbye. */
export interface ProcessTransport {
  readonly transport: MessageTransport;
  crash(): Promise<void>;
  dispose(): Promise<void>;
}

export interface Backend {
  readonly name: string;
  /** A fresh namespace (queue name, table, key) for one case. */
  namespace(): Promise<{ connect(): Promise<ProcessTransport> }>;
  /** How long a broker takes to notice a dead consumer and hand its message out again. */
  readonly redeliveryWaitMs: number;
}

export const observations: Record<string, Record<string, string>> = {};

export function jobQueueContract(backend: Backend): void {
  describe(backend.name, () => {
    const opened: ProcessTransport[] = [];

    after(async () => {
      for (const process of opened) await process.dispose().catch(() => undefined);
    });

    async function world() {
      const space = await backend.namespace();
      const directory = await mkdtemp(path.join(tmpdir(), 'jobs-'));
      const records = createFileRecords(path.join(directory, 'jobs.json'));
      const runs = new Map<string, number>();
      const gates = new Map<string, PromiseWithResolvers<void>>();
      const gate = (key: string) => {
        let entry = gates.get(key);
        if (entry === undefined) {
          entry = Promise.withResolvers<void>();
          gates.set(key, entry);
        }
        return entry;
      };
      const count = (name: string) => runs.set(name, (runs.get(name) ?? 0) + 1).get(name) ?? 0;

      const handlers = new Map<string, JobHandler>([
        ['echo', async (payload) => (count('echo'), { got: payload })],
        ['boom', async () => (count('boom'), Promise.reject(new Error('nope')))],
        [
          'gated',
          async (_payload, context) => {
            count('gated');
            await context.progress({ done: 1, total: 2, note: 'halfway' });
            await gate('gated').promise;
            return 'opened';
          },
        ],
        [
          'patient',
          async (_payload, context) => {
            const run = count('patient');
            if (run > 1) return 'second run';
            await new Promise<void>((_resolve, reject) => {
              context.signal.addEventListener('abort', () => reject(new Error('stopped')));
            });
            return 'unreachable';
          },
        ],
        [
          'hang-once',
          async () => {
            const run = count('hang-once');
            if (run === 1) await new Promise(() => undefined);
            return { run };
          },
        ],
        ['hang-always', async () => (count('hang-always'), new Promise<never>(() => undefined))],
      ]);

      async function boot(options: { start?: boolean; maxAttempts?: number } = {}) {
        const process = await space.connect();
        opened.push(process);
        const queue = createJobQueue({
          transport: process.transport,
          records,
          handlers,
          owner: randomUUID(),
          maxAttempts: options.maxAttempts ?? 3,
        });
        if (options.start !== false) await queue.start();
        return { queue, process };
      }

      return { boot, records, runs, gate };
    }

    async function waitFor(
      queue: JobQueue | JobRecords,
      id: string,
      test: (status: JobStatus) => boolean,
      timeoutMs = 20_000,
    ): Promise<JobStatus> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const status = 'status' in queue ? await queue.status(id) : await queue.get(id);
        if (status !== undefined && test(status)) return status;
        if (Date.now() > deadline) assert.fail(`timed out; last status ${JSON.stringify(status)}`);
        await sleep(25);
      }
    }
    const terminal = (status: JobStatus) =>
      status.state === 'finished' || status.state === 'failed' || status.state === 'interrupted';

    it('C1 runs a job and reports its result', async () => {
      const { boot } = await world();
      const { queue } = await boot();
      const id = await queue.enqueue('echo', { n: 1, nested: { list: [1, 'x', null] } });
      const status = await waitFor(queue, id, terminal);
      assert.equal(status.state, 'finished');
      assert.deepEqual(status.state === 'finished' && status.result, {
        got: { n: 1, nested: { list: [1, 'x', null] } },
      });
      assert.equal(status.attempt, 1);
      await queue.close();
    });

    it('C2 reports progress while the job runs', async () => {
      const { boot, gate } = await world();
      const { queue } = await boot();
      const id = await queue.enqueue('gated', null);
      const running = await waitFor(queue, id, (status) => status.state === 'running' && status.progress !== undefined);
      assert.deepEqual(running.state === 'running' && running.progress, { done: 1, total: 2, note: 'halfway' });
      gate('gated').resolve();
      assert.equal((await waitFor(queue, id, terminal)).state, 'finished');
      await queue.close();
    });

    it('C3 records a failure and still runs the next job', async () => {
      const { boot } = await world();
      const { queue } = await boot();
      const failing = await queue.enqueue('boom', null);
      const next = await queue.enqueue('echo', 2);
      const failed = await waitFor(queue, failing, terminal);
      assert.equal(failed.state, 'failed');
      assert.equal(failed.state === 'failed' && failed.error, 'nope');
      assert.equal((await waitFor(queue, next, terminal)).state, 'finished');
      await queue.close();
    });

    it('C4 latest(name) gives the newest job of that name', async () => {
      const { boot } = await world();
      const { queue } = await boot();
      const first = await queue.enqueue('echo', 'a');
      await waitFor(queue, first, terminal);
      const second = await queue.enqueue('echo', 'b');
      await waitFor(queue, second, terminal);
      assert.equal((await queue.latest('echo'))?.id, second);
      assert.equal(await queue.latest('gated'), undefined);
      await queue.close();
    });

    it('C5 refuses a job no handler is registered for', async () => {
      const { boot } = await world();
      const { queue } = await boot();
      await assert.rejects(queue.enqueue('nobody', null), /No handler/);
      await queue.close();
    });

    it('C6 settled() waits for the running job', async () => {
      const { boot, gate } = await world();
      const { queue } = await boot();
      const id = await queue.enqueue('gated', null);
      await waitFor(queue, id, (status) => status.state === 'running');
      let settled = false;
      const waiting = queue.settled().then(() => (settled = true));
      await sleep(200);
      assert.equal(settled, false, 'settled before the job finished');
      gate('gated').resolve();
      await waiting;
      assert.equal((await queue.status(id))?.state, 'finished');
      await queue.close();
    });

    it('C7 stop interrupts the running job, which a restart runs to the end', async () => {
      const { boot, runs } = await world();
      const first = await boot();
      const id = await first.queue.enqueue('patient', null);
      await waitFor(first.queue, id, (status) => status.state === 'running');
      await first.queue.close();
      const parked = await first.queue.status(id);
      assert.equal(parked?.state, 'queued', 'a stopped job goes back to queued');
      assert.equal(parked.attempt, 1, 'a graceful stop does not count as an attempt');

      const second = await boot();
      const done = await waitFor(second.queue, id, terminal);
      assert.equal(done.state, 'finished');
      assert.equal(done.state === 'finished' && done.result, 'second run');
      assert.equal(runs.get('patient'), 2);
      await second.queue.close();
    });

    it('C8 a crash leaves the job to run again as a new attempt, once', async () => {
      const { boot, runs } = await world();
      const first = await boot();
      const id = await first.queue.enqueue('hang-once', null);
      await waitFor(first.queue, id, (status) => status.state === 'running');
      await first.process.crash();

      const second = await boot();
      const done = await waitFor(second.queue, id, terminal);
      assert.equal(done.state, 'finished');
      assert.equal(done.attempt, 2);
      await sleep(backend.redeliveryWaitMs);
      assert.equal(runs.get('hang-once'), 2, 'the broker redelivering the dead message ran it again');
      await second.queue.close();
    });

    it('C9 a job cut off maxAttempts times ends as interrupted and stays there', async () => {
      const { boot, runs, records } = await world();
      const first = await boot({ maxAttempts: 2 });
      const id = await first.queue.enqueue('hang-always', null);
      await waitFor(first.queue, id, (status) => status.state === 'running' && status.attempt === 1);
      await first.process.crash();

      const second = await boot({ maxAttempts: 2 });
      await waitFor(second.queue, id, (status) => status.state === 'running' && status.attempt === 2);
      await second.process.crash();

      const third = await boot({ maxAttempts: 2 });
      assert.equal((await waitFor(records, id, terminal)).state, 'interrupted');
      await sleep(backend.redeliveryWaitMs);
      assert.equal(runs.get('hang-always'), 2);
      assert.equal((await records.get(id))?.state, 'interrupted');
      await third.queue.close();
    });

    it('C10 a duplicate message runs nothing twice', async () => {
      const { boot, runs } = await world();
      const { queue, process } = await boot();
      const id = await queue.enqueue('echo', 'once');
      await waitFor(queue, id, terminal);
      await process.transport.enqueue({ id });
      await process.transport.enqueue({ id });
      await sleep(500);
      assert.equal(runs.get('echo'), 1);
      await queue.close();
    });

    it('C11 a job queued when the process stopped runs after a restart', async () => {
      const { boot, runs } = await world();
      const first = await boot({ start: false });
      const id = await first.queue.enqueue('echo', 'later');
      await first.process.crash();

      const second = await boot();
      assert.equal((await waitFor(second.queue, id, terminal)).state, 'finished');
      await sleep(backend.redeliveryWaitMs);
      assert.equal(runs.get('echo'), 1);
      await second.queue.close();
    });

    it('P1 (observed) the transport hands out again a message whose handler never finished', async () => {
      const space = await backend.namespace();
      const first = await space.connect();
      opened.push(first);
      const seen: unknown[] = [];
      const taken = Promise.withResolvers<void>();
      void first.transport.listen(async (message) => {
        seen.push(message);
        taken.resolve();
        await new Promise(() => undefined);
      });
      await first.transport.enqueue({ probe: 1 });
      await taken.promise;
      await first.crash();

      const second = await space.connect();
      opened.push(second);
      const listening = new AbortController();
      void second.transport.listen(
        async (message) => {
          seen.push(message);
        },
        { signal: listening.signal },
      );
      await sleep(backend.redeliveryWaitMs + 1500);
      listening.abort();
      (observations[backend.name] ??= {})['redelivers after a crash'] = seen.length > 1 ? 'yes' : 'no';
    });
  });
}
```

## Appendix B: runner

The spike's job layer, as it ran. It is a reference for the build, not code to copy as it stands.

```ts
import { randomUUID } from 'node:crypto';

import type { JobHandler, JobQueue, JobRecords, Json, MessageTransport } from './types.ts';

export class JobLostError extends Error {}

export function createJobQueue(options: {
  transport: MessageTransport;
  records: JobRecords;
  handlers: ReadonlyMap<string, JobHandler>;
  owner: string;
  maxAttempts?: number;
}): JobQueue {
  const { transport, records, handlers, owner } = options;
  const maxAttempts = options.maxAttempts ?? 3;
  const stopping = new AbortController();
  let listening: Promise<void> = Promise.resolve();
  let inFlight = 0;
  let idle: (() => void)[] = [];

  const now = (): string => new Date().toISOString();

  async function recover(): Promise<void> {
    for (const record of await records.list(['running'])) {
      if (record.state !== 'running' || record.owner === owner) continue;
      const expected = { state: 'running' as const, attempt: record.attempt };
      if (record.attempt >= maxAttempts) {
        await records.transition(record.id, expected, {
          state: 'interrupted',
          attempt: record.attempt,
          interruptedAt: now(),
        });
      } else {
        await records.transition(record.id, expected, {
          state: 'queued',
          attempt: record.attempt + 1,
          interruptedAt: now(),
        });
      }
    }
    for (const record of await records.list(['queued'])) await transport.enqueue({ id: record.id });
  }

  async function deliver(message: unknown): Promise<void> {
    if (stopping.signal.aborted) return;
    const id = (message as { id?: unknown } | null)?.id;
    if (typeof id !== 'string') return;
    const record = await records.get(id);
    if (record?.state !== 'queued') return;
    const { attempt } = record;
    const handler = handlers.get(record.name);
    if (handler === undefined) {
      await records.transition(id, { state: 'queued', attempt }, {
        state: 'failed',
        attempt,
        finishedAt: now(),
        error: `No handler is registered for ${record.name}.`,
      });
      return;
    }
    const startedAt = now();
    const claimed = await records.transition(id, { state: 'queued', attempt }, { state: 'running', attempt, owner, startedAt });
    if (!claimed) return;

    inFlight += 1;
    const running = { state: 'running' as const, attempt };
    try {
      const result = await handler(record.payload, {
        signal: stopping.signal,
        attempt,
        async progress(progress) {
          const kept = await records.transition(id, running, { ...running, owner, startedAt, progress });
          if (!kept) throw new JobLostError(`Job ${id} is no longer this worker's.`);
        },
      });
      await records.transition(id, running, { state: 'finished', attempt, finishedAt: now(), result });
    } catch (error) {
      if (stopping.signal.aborted) {
        const requeued = await records.transition(id, running, { state: 'queued', attempt });
        if (requeued) await transport.enqueue({ id }).catch(() => undefined);
      } else if (!(error instanceof JobLostError)) {
        await records.transition(id, running, {
          state: 'failed',
          attempt,
          finishedAt: now(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      inFlight -= 1;
      if (inFlight === 0) {
        const waiting = idle;
        idle = [];
        for (const wake of waiting) wake();
      }
    }
  }

  const queue: JobQueue = {
    async enqueue(name: string, payload: Json) {
      if (!handlers.has(name)) throw new Error(`No handler is registered for ${name}.`);
      const id = randomUUID();
      const plain = JSON.parse(JSON.stringify(payload)) as Json;
      await records.create({ id, name, payload: plain, queuedAt: now(), state: 'queued', attempt: 1 });
      await transport.enqueue({ id });
      return id;
    },
    status: (id) => records.get(id),
    latest: (name) => records.latest(name),
    async start() {
      await recover();
      listening = transport.listen(deliver, { signal: stopping.signal });
    },
    stop() {
      stopping.abort();
    },
    async settled() {
      while (inFlight > 0) await new Promise<void>((resolve) => idle.push(resolve));
    },
    async close() {
      queue.stop();
      await queue.settled();
      await listening;
    },
  };
  return queue;
}
```
