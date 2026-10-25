import { JOB_STATES } from '../../jobs/types.ts';
import type { Enqueued } from '../../jobs/types.ts';
import type { McpToolAnnotations } from '../../plugin.ts';

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

export function queuedJob(enqueued: Enqueued): {
  queued: boolean;
  job: { id: string; state: (typeof JOB_STATES)[number] };
} {
  return enqueued.queued
    ? { queued: true, job: { id: enqueued.id, state: 'queued' } }
    : { queued: false, job: { id: enqueued.active.id, state: enqueued.active.state } };
}
