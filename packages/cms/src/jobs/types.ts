export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export interface Progress {
  readonly done: number;
  readonly total?: number;
  readonly note?: string;
}

/**
 * The process that claimed a running job: its host, its id, and when it
 * started as the operating system reports it, which tells it apart from a
 * later process given the same id.
 */
export interface Claimer {
  readonly host: string;
  readonly pid: number;
  readonly since?: string;
}

export type JobState =
  | { readonly state: 'queued'; readonly attempt: number; readonly interruptedAt?: string }
  | {
      readonly state: 'running';
      readonly attempt: number;
      readonly owner: string;
      readonly claimer?: Claimer;
      readonly startedAt: string;
      readonly progress?: Progress;
    }
  | {
      readonly state: 'finished';
      readonly attempt: number;
      readonly finishedAt: string;
      readonly result: Json;
    }
  | {
      readonly state: 'failed';
      readonly attempt: number;
      readonly finishedAt: string;
      readonly error: string;
    }
  | { readonly state: 'interrupted'; readonly attempt: number; readonly interruptedAt: string };

export const JOB_STATES = ['queued', 'running', 'finished', 'failed', 'interrupted'] as const;

export type JobStateName = (typeof JOB_STATES)[number];

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
  /** Throws {@link JobLostError} when this worker no longer owns the job. */
  progress(progress: Progress): Promise<void>;
}

declare const carries: unique symbol;

/** A job's name, typed with the payload it is queued with and the result it finishes with. */
export interface JobName<P extends Json = Json, R extends Json = Json> {
  readonly name: string;
  readonly [carries]?: { readonly payload: P; readonly result: R };
}

export function jobName<P extends Json, R extends Json>(name: string): JobName<P, R> {
  return { name };
}

/**
 * A finished job's result, typed by its name. The result is the job's own
 * output, read back from the record store, so it is trusted rather than
 * checked again.
 */
export function finishedResult<R extends Json>(
  job: JobName<Json, R>,
  status: JobStatus | undefined,
): R | undefined {
  return status?.state === 'finished' && status.name === job.name
    ? (status.result as R)
    : undefined;
}

/**
 * One kind of job. `parse` checks the payload, which crossed a boundary, and
 * `run` must be safe to run twice: execution is at least once.
 */
export interface JobDefinition<P extends Json = Json, R extends Json = Json> extends JobName<P, R> {
  parse(payload: Json): P;
  run(payload: P, context: JobContext): Promise<R>;
}

/** What the admin and the CLI use. */
export interface JobQueue {
  /** Record a job as queued and send it to the transport. Refuses a name with no registered definition. */
  enqueue<P extends Json>(job: JobName<P, Json>, payload: NoInfer<P>): Promise<string>;
  /**
   * {@link JobQueue.enqueue}, unless a job of this name is active, as
   * {@link JobQueue.active} means it: then nothing is queued and the active
   * job is returned. The check and the write are one step in the record
   * store, so two callers at once queue one job. With `countQueued: false`, a
   * queued job does not count as active.
   */
  enqueueUnlessActive<P extends Json>(
    job: JobName<P, Json>,
    payload: NoInfer<P>,
    options?: { readonly countQueued?: boolean },
  ): Promise<Enqueued>;
  status(id: string): Promise<JobStatus | undefined>;
  /**
   * The newest job of this name, whatever its state. A started queue first
   * takes back the jobs a dead or discarded worker left, so a cut-off job
   * reads as queued again rather than as running.
   */
  latest(name: string): Promise<JobStatus | undefined>;
  /**
   * The newest job of this name while it waits or runs: queued, or running
   * in this worker or in a process that is still alive. A job a gone process
   * left running is not active; a started queue runs it again.
   */
  active(name: string): Promise<JobStatus | undefined>;
  /**
   * Run one queued job in this process and resolve with its final status,
   * with no transport and no start-up recovery: what a CLI command does
   * beside a server that may be running. A job another process claimed first
   * is waited for instead.
   */
  run(id: string): Promise<JobStatus>;
  /** Recover the jobs no worker owns and start taking messages. */
  start(): Promise<void>;
  /** Stop taking messages and abort the running job's signal. */
  stop(): void;
  /** Resolve once no handler in this process is running. */
  settled(): Promise<void>;
  /** {@link JobQueue.stop}, then {@link JobQueue.settled}, then the transport's `listen` returning. */
  close(): Promise<void>;
}

export type Enqueued =
  | { readonly queued: true; readonly id: string }
  | { readonly queued: false; readonly active: JobStatus };

/** Swap point 1: what carries a job's id to a worker. Any Fedify `MessageQueue` satisfies it. */
export interface MessageTransport {
  enqueue(message: unknown): Promise<void>;
  listen(
    handler: (message: unknown) => Promise<void>,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

/** Swap point 2: where job status lives. Every transition is a compare-and-set on state and attempt. */
export interface JobRecords {
  /**
   * Record a new job, unless `blocks` holds for the newest job of the same
   * name: then record nothing and resolve with that job. The check and the
   * write must be one step, so that two callers never both get past it.
   */
  create(
    status: JobStatus,
    blocks?: (latest: JobStatus) => boolean,
  ): Promise<JobStatus | undefined>;
  get(id: string): Promise<JobStatus | undefined>;
  latest(name: string): Promise<JobStatus | undefined>;
  list(states: readonly JobStateName[]): Promise<JobStatus[]>;
  transition(
    id: string,
    expected: Pick<JobState, 'state' | 'attempt'>,
    next: JobState,
  ): Promise<boolean>;
}

/** A write by a worker that no longer owns its job. */
export class JobLostError extends Error {
  constructor(id: string) {
    super(`Job ${id} is no longer this worker's.`);
    this.name = 'JobLostError';
  }
}
