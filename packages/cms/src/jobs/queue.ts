import { randomUUID } from 'node:crypto';

import type { Clock } from '../util/clock.ts';
import { messageOf } from '../util/errors.ts';
import { isClaimerAlive, thisProcess } from './processes.ts';
import { JobLostError } from './types.ts';
import type {
  JobDefinition,
  JobName,
  JobQueue,
  JobRecords,
  JobStatus,
  Json,
  MessageTransport,
} from './types.ts';

const DEFAULT_MAX_ATTEMPTS = 3;

export const MAX_PAYLOAD_BYTES = 64 * 1024;

const FOREIGN_JOB_POLL_MS = 100;

export interface JobQueueOptions {
  readonly transport: MessageTransport;
  readonly records: JobRecords;
  readonly jobs: readonly JobDefinition[];
  readonly maxAttempts?: number;
  readonly now: Clock;
}

/**
 * The job layer of decision-54, the same on every transport. A message
 * carries only a job id; a claim is a compare-and-set from queued to
 * running at one attempt, and the attempt fences every later write, so a
 * duplicate or late message runs nothing.
 */
export function createJobQueue(options: JobQueueOptions): JobQueue {
  const { transport, records } = options;
  const owner = randomUUID();
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const now = () => options.now().toISOString();
  const definitions = new Map<string, JobDefinition>(options.jobs.map((job) => [job.name, job]));

  let stopping = new AbortController();
  let listening: Promise<void> = Promise.resolve();
  let started = false;
  let inFlight = 0;
  let idle: (() => void)[] = [];

  /**
   * Take back what a dead or discarded worker left: a running job whose
   * claiming process is gone goes back to queued as the next attempt, and,
   * while nothing runs here, every queued job is sent to the transport again,
   * since its message may have died with another process. A duplicate message
   * is dropped by the claim. A started queue does this on start, before
   * answering {@link JobQueue.latest}, and each time it goes idle.
   */
  async function reconcile(): Promise<void> {
    for (const record of await records.list(['running'])) {
      if (record.state !== 'running' || record.owner === owner || !isCutOff(record)) continue;
      const expected = { state: 'running' as const, attempt: record.attempt };
      await records.transition(
        record.id,
        expected,
        record.attempt >= maxAttempts
          ? { state: 'interrupted', attempt: record.attempt, interruptedAt: now() }
          : { state: 'queued', attempt: record.attempt + 1, interruptedAt: now() },
      );
    }
    if (inFlight > 0) return;
    for (const record of await records.list(['queued'])) await transport.enqueue({ id: record.id });
  }

  async function claimAndRun(id: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    const record = await records.get(id);
    if (record?.state !== 'queued') return false;
    const { attempt } = record;
    const queued = { state: 'queued' as const, attempt };
    const definition = definitions.get(record.name);
    if (definition === undefined) {
      return records.transition(id, queued, {
        state: 'failed',
        attempt,
        finishedAt: now(),
        error: `No handler is registered for ${record.name}.`,
      });
    }
    const claim = {
      state: 'running' as const,
      attempt,
      owner,
      claimer: thisProcess(),
      startedAt: now(),
    };
    if (!(await records.transition(id, queued, claim))) return false;

    inFlight += 1;
    const running = { state: 'running' as const, attempt };
    try {
      const result = await definition.run(definition.parse(record.payload), {
        signal,
        attempt,
        async progress(progress) {
          const kept = await records.transition(id, running, { ...claim, progress });
          if (!kept) throw new JobLostError(id);
        },
      });
      await records.transition(id, running, {
        state: 'finished',
        attempt,
        finishedAt: now(),
        result: plain(result ?? null),
      });
    } catch (error) {
      if (signal.aborted) {
        if (await records.transition(id, running, { state: 'queued', attempt })) {
          await transport.enqueue({ id }).catch(() => undefined);
        }
      } else if (!(error instanceof JobLostError)) {
        await records.transition(id, running, {
          state: 'failed',
          attempt,
          finishedAt: now(),
          error: messageOf(error),
        });
      }
    } finally {
      inFlight -= 1;
      if (inFlight === 0) {
        const waiting = idle;
        idle = [];
        for (const wake of waiting) wake();
        if (started && !signal.aborted) void reconcile().catch(() => undefined);
      }
    }
    return true;
  }

  async function deliver(message: unknown, signal: AbortSignal): Promise<void> {
    const id = (message as { id?: unknown } | null)?.id;
    if (typeof id === 'string') await claimAndRun(id, signal);
  }

  function newRecord(job: JobName, payload: Json): JobStatus {
    if (!definitions.has(job.name)) throw new Error(`No handler is registered for ${job.name}.`);
    const copy = plain(payload);
    if (Buffer.byteLength(JSON.stringify(copy)) > MAX_PAYLOAD_BYTES) {
      throw new Error(`A ${job.name} job's payload is over ${String(MAX_PAYLOAD_BYTES)} bytes.`);
    }
    return {
      id: randomUUID(),
      name: job.name,
      payload: copy,
      queuedAt: now(),
      state: 'queued',
      attempt: 1,
    };
  }

  function isActive(status: JobStatus, countQueued = true): boolean {
    if (status.state === 'queued') return countQueued;
    return status.state === 'running' && (status.owner === owner || !isCutOff(status));
  }

  const queue: JobQueue = {
    async enqueue(job, payload) {
      const status = newRecord(job, payload);
      await records.create(status);
      await transport.enqueue({ id: status.id });
      return status.id;
    },

    async enqueueUnlessActive(job, payload, options = {}) {
      const status = newRecord(job, payload);
      if (started) await reconcile();
      const active = await records.create(status, (latest) =>
        isActive(latest, options.countQueued),
      );
      if (active !== undefined) return { queued: false, active };
      await transport.enqueue({ id: status.id });
      return { queued: true, id: status.id };
    },

    status: (id) => records.get(id),

    async latest(name) {
      if (started) await reconcile();
      return records.latest(name);
    },

    async active(name) {
      const latest = await queue.latest(name);
      return latest !== undefined && isActive(latest) ? latest : undefined;
    },

    async list(states) {
      if (started) await reconcile();
      return records.list(states);
    },

    async run(id) {
      await claimAndRun(id, stopping.signal);
      for (;;) {
        const status = await records.get(id);
        if (status === undefined) throw new Error(`No job ${id} is recorded.`);
        if (isFinal(status) || stopping.signal.aborted) return status;
        await new Promise((resolve) => setTimeout(resolve, FOREIGN_JOB_POLL_MS));
      }
    },

    async start() {
      if (started) return;
      await listening;
      if (stopping.signal.aborted) stopping = new AbortController();
      started = true;
      const { signal } = stopping;
      await reconcile();
      listening = transport.listen((message) => deliver(message, signal), { signal });
    },

    stop() {
      started = false;
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

function isCutOff(status: JobStatus): boolean {
  return (
    status.state === 'running' && (status.claimer === undefined || !isClaimerAlive(status.claimer))
  );
}

function isFinal(status: JobStatus): boolean {
  return status.state === 'finished' || status.state === 'failed' || status.state === 'interrupted';
}

function plain(value: Json): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
