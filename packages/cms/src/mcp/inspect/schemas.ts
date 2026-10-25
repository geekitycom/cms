import { DELIVERY_STATUSES } from '../../store/deliveries.ts';
import { nullable } from '../../util/json-schema.ts';
import type { McpToolAnnotations } from '../../plugin.ts';

/** Every inspect tool reads what the site recorded and changes nothing. */
export const READ_ONLY: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const STATUS_COUNTS = {
  type: 'object',
  description: 'How many recipients stand at each delivery status.',
  properties: Object.fromEntries(
    DELIVERY_STATUSES.map((status) => [status, { type: 'integer' }]),
  ) as Record<(typeof DELIVERY_STATUSES)[number], { readonly type: 'integer' }>,
  required: DELIVERY_STATUSES,
} as const;

/** One recorded outcome of one activity sent to one recipient, as the store keeps it. */
export const DELIVERY = {
  type: 'object',
  properties: {
    activityId: { type: 'string' },
    activityType: { type: 'string', description: 'Create, Update or Delete.' },
    objectId: { type: 'string', description: 'What the activity was about.' },
    slug: nullable({ type: 'string', description: 'The post it was about, when it was one.' }),
    actorId: { type: 'string', description: 'The follower or relay it went to.' },
    inboxId: { type: 'string', description: 'The inbox used, often the shared one.' },
    status: { type: 'string', enum: DELIVERY_STATUSES },
    error: nullable({ type: 'string', description: 'Why it failed or is being retried.' }),
    attemptedAt: { type: 'string' },
  },
  required: [
    'activityId',
    'activityType',
    'objectId',
    'slug',
    'actorId',
    'inboxId',
    'status',
    'error',
    'attemptedAt',
  ],
} as const;

/** Any JSON object, such as an activity as it was received. */
export const ANY_OBJECT = { type: 'object', properties: {} } as const;
