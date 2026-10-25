import { RESEND_JOB } from '../../federation/resend-job.ts';
import { defineTool } from '../tools.ts';
import { findPost, POST_INPUT } from '../inspect/post.ts';
import { JOB, QUEUED, queuedJob, REPAIR } from './schemas.ts';

export const resendPost = defineTool({
  name: 'resend_post',
  title: 'Resend a post',
  description:
    'Queue a resend of one post to every follower and accepted relay, as the Resend button on the admin federation screen does. The post goes out as it reads now: an Update when followers hold it, a Create when it was never announced, a Delete when it is a draft or in the trash. Returns the queued job; delivery outcomes appear in post_federation as the queue settles them.',
  scope: 'repair',
  annotations: REPAIR,
  inputSchema: {
    type: 'object',
    properties: {
      post: POST_INPUT,
      webmentions: {
        type: 'boolean',
        description: 'Whether to send the post’s webmentions again too. true unless given.',
      },
    },
    required: ['post'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { slug: { type: 'string' }, queued: QUEUED, job: JOB },
    required: ['slug', 'queued', 'job'],
  },
  run: async (args, { site }) => {
    const document = findPost(site, args.post);
    if (document === undefined) return { ok: false, message: `No post answers to ${args.post}.` };
    const { slug } = document;
    const outcome = queuedJob(
      await site.jobs.enqueueUnlessActive(RESEND_JOB, {
        slugs: [slug],
        webmentions: args.webmentions ?? true,
      }),
    );
    return {
      ok: true,
      summary: outcome.queued
        ? `Queued a resend of ${slug} as job ${outcome.job.id}.`
        : `A resend is already ${outcome.job.state} as job ${outcome.job.id}; nothing new was queued.`,
      structured: { slug, ...outcome },
    };
  },
});
