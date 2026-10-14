import { randomUUID } from 'node:crypto';

import type { Clock } from '../util/clock.ts';
import { messageOf } from '../util/errors.ts';
import { isClaimerAlive, thisProcess } from './processes.ts';
import { JobLostError } from './types.ts';
import type {
  JobDefinition,
  JobQueue,
  JobRecords,
  JobStatus,
  Json,
  MessageTransport,
} from './types.ts';

export const DEFAULT_MAX_ATTEMPTS = 3;

/** The largest payload a job carries, as JSON text. */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/** How often a CLI process looks at a job another process claimed first. */
const FOREIGN_JOB_POLL_MS = 100;

export interface JobQueueOptions {
  readonly transport: MessageTransport;
  readonly records: JobRecords;
  readonly jobs: readonly JobDefinition[];
  /** Who this worker is in a running record. One per process. */
  readonly owner?: string;
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
  const owner = options.owner ?? randomUUID();
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const now = () => options.now().toISOString();
  const definitions = new Map<string, JobDefinition>(options.jobs.map((job) => [job.name, job]));

  let stopping = new AbortController();
  let listening: Promise<void> = Promise.resolve();
  let started = false;
  let inFlight = 0;
  let idle: (() => void)[] = [];

  async function recover(): Promise<void> {
    for (const record of await records.list(['running'])) {
      if (record.state !== 'running' || record.owner === owner) continue;
      if (record.claimer !== undefined && isClaimerAlive(record.claimer)) continue;
      const expected = { state: 'running' as const, attempt: record.attempt };
      await records.transition(
        record.id,
        expected,
        record.attempt >= maxAttempts
          ? { state: 'interrupted', attempt: record.attempt, interruptedAt: now() }
          : { state: 'queued', attempt: record.attempt + 1, interruptedAt: now() },
      );
    }
    for (const record of await records.list(['queued'])) await transport.enqueue({ id: record.id });
  }

  /** Claim a queued job and run it here. False when it was not this worker's to run. */
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
      }
    }
    return true;
  }

  async function deliver(message: unknown, signal: AbortSignal): Promise<void> {
    const id = (message as { id?: unknown } | null)?.id;
    if (typeof id === 'string') await claimAndRun(id, signal);
  }

  const queue: JobQueue = {
    async enqueue(job, payload) {
      if (!definitions.has(job.name)) throw new Error(`No handler is registered for ${job.name}.`);
      const text = JSON.stringify(payload);
      if (Buffer.byteLength(text) > MAX_PAYLOAD_BYTES) {
        throw new Error(`A ${job.name} job's payload is over ${String(MAX_PAYLOAD_BYTES)} bytes.`);
      }
      const id = randomUUID();
      await records.create({
        id,
        name: job.name,
        payload: JSON.parse(text) as Json,
        queuedAt: now(),
        state: 'queued',
        attempt: 1,
      });
      await transport.enqueue({ id });
      return id;
    },

    status: (id) => records.get(id),

    latest: (name) => records.latest(name),

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
      await recover();
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

function isFinal(status: JobStatus): boolean {
  return status.state === 'finished' || status.state === 'failed' || status.state === 'interrupted';
}

function plain(value: Json): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
