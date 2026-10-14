/**
 * What an admin screen shows of a queued job (decision-54), and how its
 * button queues one. `components/job-status.njk` draws a {@link JobStatusView};
 * the screen draws a finished job's result itself.
 */

import type { JobDefinition, JobQueue, JobStatus, Json } from '../jobs/types.ts';

export interface JobStatusView {
  readonly id: string;
  readonly state: JobStatus['state'];
  /** The badge's text. */
  readonly label: string;
  /** Queued or running: the screen offers no second run and a link to look again. */
  readonly active: boolean;
  readonly attempt: number;
  /** When it reached its state, or when it was queued. */
  readonly at: string;
  /** Queued again after a restart cut it off. */
  readonly requeued: boolean;
  readonly progress?: { readonly done: number; readonly total?: number; readonly note?: string };
  readonly error?: string;
}

const LABELS: Readonly<Record<JobStatus['state'], string>> = {
  queued: 'Queued',
  running: 'Running',
  finished: 'Finished',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

export function jobStatusView(status: JobStatus | undefined): JobStatusView | undefined {
  if (status === undefined) return undefined;
  const common = {
    id: status.id,
    state: status.state,
    label: LABELS[status.state],
    active: status.state === 'queued' || status.state === 'running',
    attempt: status.attempt,
    requeued: false,
  };
  switch (status.state) {
    case 'queued':
      return {
        ...common,
        at: status.interruptedAt ?? status.queuedAt,
        requeued: status.interruptedAt !== undefined,
      };
    case 'running':
      return {
        ...common,
        at: status.startedAt,
        ...(status.progress === undefined ? {} : { progress: status.progress }),
      };
    case 'finished':
      return { ...common, at: status.finishedAt };
    case 'failed':
      return { ...common, at: status.finishedAt, error: status.error };
    case 'interrupted':
      return { ...common, at: status.interruptedAt };
  }
}

/**
 * Queue a job unless one of the same name is already queued or running, so a
 * second press, or a press in a second tab, starts nothing. Resolves with the
 * new job's id, or `undefined` when one was already waiting or running.
 */
export async function enqueueUnlessActive<P extends Json>(
  jobs: JobQueue,
  job: JobDefinition<P, Json>,
  payload: P,
): Promise<string | undefined> {
  if ((await jobs.active(job.name)) !== undefined) return undefined;
  return jobs.enqueue(job, payload);
}
