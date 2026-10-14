import type { JobDefinition, Json } from '../jobs/types.ts';
import type { WebmentionService } from '../webmention/service.ts';
import type { DeliveryService } from './delivery.ts';

export const RESEND_JOB = 'resend';

/** Which posts to send again: named slugs, or every announced post as the job runs. */
export type ResendPayload = {
  readonly slugs: readonly string[] | 'all';
  /** Whether each post's webmentions go out again with it, as the per-post button does. */
  readonly webmentions: boolean;
};

/** What one post's activity came to. `held` means dev mode sent nothing. */
export type ResendActivity = {
  readonly activityType: string;
  readonly held: boolean;
  readonly inboxes: number;
  readonly reached: number;
  readonly queued: number;
  readonly failed: number;
};

export type ResendWebmentions = {
  readonly pages: number;
  readonly told: number;
  readonly none: number;
  readonly failed: number;
};

/** One slug's outcome. Both halves `null` means it had nothing to resend. */
export type ResendPost = {
  readonly slug: string;
  readonly activity: ResendActivity | null;
  readonly webmentions: ResendWebmentions | null;
};

/** A resend job's result: one entry per slug, in the order they were sent. */
export type ResendReport = { readonly posts: readonly ResendPost[] };

export interface ResendJobServices {
  readonly store: { listFederated(): readonly { readonly slug: string }[] };
  readonly delivery: Pick<DeliveryService, 'resend'>;
  readonly webmentions: Pick<WebmentionService, 'send'>;
}

/**
 * Resending announced posts as a job (TASK-393): the federation screen's
 * buttons and `geekity resend` queue it. It stops before the next post once
 * its signal is aborted. Running it again sends another `Update`, which
 * receivers treat as the same post.
 */
export function resendJob(services: ResendJobServices): JobDefinition<ResendPayload, ResendReport> {
  return {
    name: RESEND_JOB,
    parse: parseResendPayload,
    async run(payload, context) {
      const slugs =
        payload.slugs === 'all'
          ? services.store.listFederated().map((document) => document.slug)
          : payload.slugs;
      const posts: ResendPost[] = [];
      for (const slug of slugs) {
        context.signal.throwIfAborted();
        const report = await services.delivery.resend(slug);
        const links = payload.webmentions ? await services.webmentions.send(slug) : undefined;
        posts.push({
          slug,
          activity:
            report === undefined
              ? null
              : {
                  activityType: report.activityType,
                  held: report.held,
                  inboxes: report.deliveries.length,
                  reached: countOf(report.deliveries, 'sent'),
                  queued: countOf(report.deliveries, 'queued'),
                  failed: countOf(report.deliveries, 'failed'),
                },
          webmentions:
            links === undefined || links.sent.length === 0
              ? null
              : {
                  pages: links.sent.length,
                  told: countOf(links.sent, 'sent'),
                  none: countOf(links.sent, 'none'),
                  failed: countOf(links.sent, 'failed'),
                },
        });
        await context.progress({ done: posts.length, total: slugs.length });
      }
      return { posts };
    },
  };
}

function countOf(rows: readonly { readonly status: string }[], status: string): number {
  return rows.filter((row) => row.status === status).length;
}

function parseResendPayload(payload: Json): ResendPayload {
  if (isRecord(payload) && typeof payload['webmentions'] === 'boolean') {
    const { slugs, webmentions } = payload;
    if (slugs === 'all') return { slugs, webmentions };
    if (Array.isArray(slugs) && slugs.every((slug) => typeof slug === 'string')) {
      return { slugs: slugs as readonly string[], webmentions };
    }
  }
  throw new Error('A resend job names its slugs, or "all", and whether to send webmentions.');
}

/** A finished resend's result read back from its job record, or `undefined` when it is not one. */
export function resendReport(result: Json): ResendReport | undefined {
  if (!isRecord(result) || !Array.isArray(result['posts'])) return undefined;
  const posts = result['posts'] as readonly Json[];
  const valid = posts.every(
    (post) =>
      isRecord(post) &&
      typeof post['slug'] === 'string' &&
      (post['activity'] === null || isRecord(post['activity'])) &&
      (post['webmentions'] === null || isRecord(post['webmentions'])),
  );
  return valid ? (result as ResendReport) : undefined;
}

function isRecord(value: Json | undefined): value is { readonly [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
