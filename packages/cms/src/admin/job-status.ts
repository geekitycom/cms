import type { Context } from 'hono';

import type { JobName, JobStateName, JobStatus, Json, Progress } from '../jobs/types.ts';
import type { GeekityEnv } from '../web/env.ts';
import { flash } from './flash.ts';

export interface JobStatusView {
  readonly id: string;
  readonly state: JobStateName;
  readonly label: string;
  readonly active: boolean;
  readonly attempt: number;
  readonly at: string;
  readonly requeued: boolean;
  readonly progress?: Progress;
  readonly error?: string;
}

const LABELS: Readonly<Record<JobStateName, string>> = {
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
 * Queue a job from an admin form unless one of its name is active, say which
 * happened, and send the browser back to the job's panel.
 */
export async function queueJobFromForm<P extends Json>(
  c: Context<GeekityEnv>,
  job: JobName<P, Json>,
  payload: NoInfer<P>,
  replies: { readonly panel: string; readonly queued: string; readonly busy: string },
): Promise<Response> {
  const enqueued = await c.var.jobs.enqueueUnlessActive(job, payload);
  if (enqueued.queued) flash(c, 'notice', replies.queued);
  else flash(c, 'warning', replies.busy);
  return c.redirect(replies.panel, 303);
}
