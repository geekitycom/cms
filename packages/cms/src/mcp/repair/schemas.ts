import { JOB_STATES } from '../../jobs/types.ts';
import type { Enqueued } from '../../jobs/types.ts';
import type { McpToolAnnotations } from '../../plugin.ts';

/**
 * Every repair tool sends to other servers, through the queues, and removes
 * nothing the site has not already removed. Repeating one converges: a
 * second resend while the first waits queues nothing, a retry finds nothing
 * left that failed, and a refresh writes what the actor says again.
 */
export const REPAIR: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const JOB = {
  type: 'object',
  description: 'The job on the jobs queue that does the work.',
  properties: {
    id: { type: 'string' },
    state: { type: 'string', enum: JOB_STATES },
  },
  required: ['id', 'state'],
} as const;

export const QUEUED = {
  type: 'boolean',
  description:
    'Whether this call queued the job. false means a job of the same kind was already waiting or running, and job names it.',
} as const;

/** What a call to enqueueUnlessActive came to, as the tools answer it. */
export function queuedJob(enqueued: Enqueued): {
  queued: boolean;
  job: { id: string; state: (typeof JOB_STATES)[number] };
} {
  return enqueued.queued
    ? { queued: true, job: { id: enqueued.id, state: 'queued' } }
    : { queued: false, job: { id: enqueued.active.id, state: enqueued.active.state } };
}
