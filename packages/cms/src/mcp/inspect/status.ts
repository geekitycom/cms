import { actorSummary } from '../../admin/federation.ts';
import { actorKeyHealth, ACTOR_KEY_ALGORITHMS } from '../../federation/keys.ts';
import { JOB_STATES } from '../../jobs/types.ts';
import type { JobStatus } from '../../jobs/types.ts';
import { listUsers } from '../../site/users.ts';
import { RELAY_STATES } from '../../store/relays.ts';
import { countRetryingDeliveries, countWaitingMessages } from '../../store/queue-database.ts';
import { messageOf } from '../../util/errors.ts';
import { nullable } from '../../util/json-schema.ts';
import { defineTool } from '../tools.ts';
import { countsOf, DELIVERY, READ_ONLY } from './schemas.ts';

const RECENT = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export const federationStatus = defineTool({
  name: 'federation_status',
  title: 'Federation status',
  description:
    'Summarises the site’s federation: each user’s actor with its follower count and key files, relay subscriptions by state, messages waiting in the federation queue, deliveries being retried, the newest failed or retrying deliveries with their errors, failed webmentions, and the newest jobs with how they ended.',
  scope: 'inspect',
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: {
      days: {
        type: 'integer',
        minimum: 1,
        maximum: 90,
        description: 'How many days back the failure counts reach. 7 unless given.',
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      since: { type: 'string', description: 'Where the failure counts start.' },
      actors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            handle: { type: 'string' },
            actorId: { type: 'string' },
            followerCount: { type: 'integer' },
            keys: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  algorithm: { type: 'string', enum: ACTOR_KEY_ALGORITHMS },
                  state: {
                    type: 'string',
                    enum: ['usable', 'missing', 'unusable'],
                    description:
                      'missing is normal before the first request that signs; unusable stops the site booting.',
                  },
                  problem: nullable({ type: 'string' }),
                },
                required: ['algorithm', 'state', 'problem'],
              },
            },
          },
          required: ['username', 'handle', 'actorId', 'followerCount', 'keys'],
        },
      },
      relays: countsOf(RELAY_STATES),
      queue: {
        type: 'object',
        properties: {
          waiting: {
            type: 'integer',
            description:
              'Messages waiting in the federation queue: deliveries, retries and inbox activities.',
          },
          retrying: {
            type: 'integer',
            description:
              'Of those, deliveries first tried since `since` waiting for another attempt.',
          },
        },
        required: ['waiting', 'retrying'],
      },
      failedDeliveries: {
        type: 'integer',
        description:
          'Deliveries that failed since `since` and are still the newest delivery of their post to that recipient.',
      },
      failedWebmentions: { type: 'integer', description: 'Webmentions that failed since `since`.' },
      recentFailures: {
        type: 'array',
        description: 'The newest failed or retrying deliveries.',
        items: DELIVERY,
      },
      jobs: {
        type: 'array',
        description: 'The newest jobs, whatever their state.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            state: { type: 'string', enum: JOB_STATES },
            attempt: { type: 'integer' },
            queuedAt: { type: 'string' },
            endedAt: nullable({
              type: 'string',
              description: 'When it finished, failed or was interrupted.',
            }),
            error: nullable({ type: 'string' }),
          },
          required: ['id', 'name', 'state', 'attempt', 'queuedAt', 'endedAt', 'error'],
        },
      },
    },
    required: [
      'since',
      'actors',
      'relays',
      'queue',
      'failedDeliveries',
      'failedWebmentions',
      'recentFailures',
      'jobs',
    ],
  },
  run: async (args, { site }) => {
    const { admin, config } = site;
    const since = new Date(config.now().getTime() - (args.days ?? 7) * DAY_MS).toISOString();

    const actors = listUsers(config.dataDir).map((user) => {
      const summary = actorSummary(user, {
        baseUrl: config.baseUrl,
        followerCount: admin.countFollowers(user.username),
        followers: [],
      });
      return {
        username: summary.username,
        handle: summary.handle,
        actorId: summary.actorId,
        followerCount: summary.followerCount,
        keys: actorKeyHealth(config.dataDir, user.username).map((key) => ({
          algorithm: key.algorithm,
          state: key.state,
          problem: key.state === 'unusable' ? messageOf(key.cause) : null,
        })),
      };
    });

    const relayList = admin.listRelays();
    const relays = Object.fromEntries(
      RELAY_STATES.map((state) => [
        state,
        relayList.filter((relay) => relay.state === state).length,
      ]),
    ) as Record<(typeof RELAY_STATES)[number], number>;

    const queue = {
      waiting: countWaitingMessages(config.dataDir),
      retrying: countRetryingDeliveries(config.dataDir, since),
    };
    const failedDeliveries = admin.listStandingFailuresSince(since).length;
    const failedWebmentions = admin.countFailedWebmentionsSince(since);
    const recentFailures = admin.searchDeliveries(
      { statuses: ['failed', 'retrying'] },
      { limit: RECENT },
    ).items;
    const jobs = (await site.jobs.list(JOB_STATES))
      .toSorted((a, b) => b.queuedAt.localeCompare(a.queuedAt))
      .slice(0, RECENT)
      .map(jobRow);

    const unusable = actors
      .filter((actor) => actor.keys.some((key) => key.state === 'unusable'))
      .map((actor) => actor.username);
    return {
      ok: true,
      summary: [
        `${String(actors.length)} ${actors.length === 1 ? 'actor' : 'actors'}`,
        `${String(queue.waiting)} queued, ${String(queue.retrying)} retrying`,
        `${String(failedDeliveries)} failed deliveries and ${String(failedWebmentions)} failed webmentions since ${since}`,
        ...(unusable.length > 0 ? [`unusable key files for ${unusable.join(', ')}`] : []),
      ].join('; '),
      structured: {
        since,
        actors,
        relays,
        queue,
        failedDeliveries,
        failedWebmentions,
        recentFailures,
        jobs,
      },
    };
  },
});

function jobRow(job: JobStatus) {
  return {
    id: job.id,
    name: job.name,
    state: job.state,
    attempt: job.attempt,
    queuedAt: job.queuedAt,
    endedAt:
      job.state === 'finished' || job.state === 'failed'
        ? job.finishedAt
        : job.state === 'interrupted'
          ? job.interruptedAt
          : null,
    error: job.state === 'failed' ? job.error : null,
  };
}
