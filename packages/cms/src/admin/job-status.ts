import type { JobDefinition, JobQueue, JobStatus, Json } from '../jobs/types.ts';

export interface JobStatusView {
  readonly id: string;
  readonly state: JobStatus['state'];
  readonly label: string;
  readonly active: boolean;
  readonly attempt: number;
  readonly at: string;
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

export async function enqueueUnlessActive<P extends Json>(
  jobs: JobQueue,
  job: JobDefinition<P, Json>,
  payload: P,
): Promise<string | undefined> {
  if ((await jobs.active(job.name)) !== undefined) return undefined;
  return jobs.enqueue(job, payload);
}
