import { failedRetries, RETRY_DELIVERIES_JOB } from '../../federation/retry-job.ts';
import type { RetryFilter } from '../../federation/retry-job.ts';
import { nullable } from '../../util/json-schema.ts';
import { defineTool, isRefused } from '../tools.ts';
import { findPost, POST_INPUT } from '../inspect/post.ts';
import { JOB, QUEUED, queuedJob, REPAIR } from './schemas.ts';

export const retryDeliveries = defineTool({
  name: 'retry_deliveries',
  title: 'Retry failed deliveries',
  description:
    'Find the recipients whose newest delivery of a post failed, for one post, for one inbox, or both, and queue a job that sends each post again, as it reads now, to those recipients alone, at the inbox each uses now. A recipient whose Create failed is sent the Create; the rest are sent an Update. Posts go one at a time with a pause between. Returns what will be retried and the queued job; outcomes appear in post_federation as the queue settles them.',
  scope: 'repair',
  annotations: REPAIR,
  inputSchema: {
    type: 'object',
    properties: {
      post: { ...POST_INPUT, description: `${POST_INPUT.description} Give this, inbox, or both.` },
      inbox: {
        type: 'string',
        description: 'Only deliveries that failed at this inbox, often a shared one.',
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      retries: {
        type: 'array',
        description: 'Each post to send again and the recipients it failed for.',
        items: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            recipients: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  actorId: { type: 'string' },
                  inboxId: { type: 'string', description: 'The inbox the failed delivery used.' },
                  error: nullable({ type: 'string' }),
                  missedAnnouncement: {
                    type: 'boolean',
                    description:
                      'True when the newest Create this recipient was sent failed, so the retry sends the Create rather than an Update.',
                  },
                },
                required: ['actorId', 'inboxId', 'error', 'missedAnnouncement'],
              },
            },
          },
          required: ['slug', 'recipients'],
        },
      },
      queued: QUEUED,
      job: nullable({ ...JOB, description: 'The job, or null when there was nothing to retry.' }),
    },
    required: ['retries', 'queued', 'job'],
  },
  run: async (args, { site }) => {
    let filter: RetryFilter;
    if (args.post !== undefined) {
      const document = findPost(site, args.post);
      if (isRefused(document)) return document;
      filter = { slug: document.slug, inbox: args.inbox ?? null };
    } else if (args.inbox !== undefined) {
      filter = { slug: null, inbox: args.inbox };
    } else {
      return { ok: false, message: 'Name a post, an inbox, or both.' };
    }

    const retries = failedRetries(site, filter);
    if (retries.length === 0) {
      return {
        ok: true,
        summary: 'No delivery that matches failed, so nothing was queued.',
        structured: { retries, queued: false, job: null },
      };
    }
    const outcome = queuedJob(await site.jobs.enqueueUnlessActive(RETRY_DELIVERIES_JOB, filter));
    const recipients = retries.reduce((sum, retry) => sum + retry.recipients.length, 0);
    return {
      ok: true,
      summary: outcome.queued
        ? `Queued job ${outcome.job.id} to retry ${String(recipients)} failed ${recipients === 1 ? 'delivery' : 'deliveries'} across ${String(retries.length)} ${retries.length === 1 ? 'post' : 'posts'}.`
        : `A retry is already ${outcome.job.state} as job ${outcome.job.id}; nothing new was queued. Call again once it finishes.`,
      structured: { retries, ...outcome },
    };
  },
});
