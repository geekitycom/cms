/**
 * Admin jobs (decision-54): a registered name and a JSON payload, run out of
 * the request that queued them, with their status kept in a job record.
 */

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

export type JobStateName = JobState['state'];

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

/**
 * One kind of job. `parse` checks the payload, which crossed a boundary, and
 * `run` must be safe to run twice: execution is at least once.
 */
export interface JobDefinition<P extends Json = Json, R extends Json = Json> {
  readonly name: string;
  parse(payload: Json): P;
  run(payload: P, context: JobContext): Promise<R>;
}

/** What the admin and the CLI use. */
export interface JobQueue {
  /** Record a job as queued and send it to the transport. Refuses a name with no registered definition. */
  enqueue<P extends Json>(job: JobDefinition<P, Json>, payload: P): Promise<string>;
  status(id: string): Promise<JobStatus | undefined>;
  /** The newest job of this name, whatever its state. */
  latest(name: string): Promise<JobStatus | undefined>;
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
  create(status: JobStatus): Promise<void>;
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
