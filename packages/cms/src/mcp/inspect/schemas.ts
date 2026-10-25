import { DELIVERY_STATUSES } from '../../store/deliveries.ts';
import { nullable } from '../../util/json-schema.ts';
import type { McpToolAnnotations } from '../../plugin.ts';

export const READ_ONLY: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function countsOf<const V extends readonly [string, ...string[]]>(values: V) {
  return {
    type: 'object',
    properties: Object.fromEntries(values.map((value) => [value, { type: 'integer' }])) as Record<
      V[number],
      { readonly type: 'integer' }
    >,
    required: values,
  } as const;
}

export const STATUS_COUNTS = {
  ...countsOf(DELIVERY_STATUSES),
  description: 'How many recipients stand at each delivery status.',
} as const;

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

export const ANY_OBJECT = { type: 'object', properties: {} } as const;
