import type { CatalogReader } from '../content/store.ts';
import { jobName } from '../jobs/types.ts';
import type { JobDefinition, Json } from '../jobs/types.ts';
import { isRecord } from '../util/guards.ts';
import type { WebmentionService } from '../webmention/service.ts';
import type { DeliveryReport, DeliveryService } from './delivery.ts';

export type ResendPayload = {
  /** Content paths, which name one post where a slug can name several. */
  readonly paths: readonly string[] | 'all';
  readonly webmentions: boolean;
};

export type ResendActivity = {
  readonly activityType: string;
  readonly heldByDevMode: boolean;
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

export type ResendPost =
  | { readonly path: string; readonly resent: false }
  | {
      readonly path: string;
      readonly resent: true;
      readonly activity: ResendActivity | null;
      readonly webmentions: ResendWebmentions | null;
    };

export type ResendReport = { readonly posts: readonly ResendPost[] };

export const RESEND_JOB = jobName<ResendPayload, ResendReport>('resend');

export interface ResendJobServices {
  readonly store: Pick<CatalogReader, 'listFederated'>;
  readonly delivery: Pick<DeliveryService, 'resend'>;
  readonly webmentions: Pick<WebmentionService, 'send'>;
}

/** Running it again sends another `Update`, which receivers treat as the same post. */
export function resendJob(services: ResendJobServices): JobDefinition<ResendPayload, ResendReport> {
  return {
    name: RESEND_JOB.name,
    parse: parseResendPayload,
    async run(payload, context) {
      const paths =
        payload.paths === 'all'
          ? services.store.listFederated().map((document) => document.path)
          : payload.paths;
      const posts: ResendPost[] = [];
      for (const path of paths) {
        context.signal.throwIfAborted();
        const report = await services.delivery.resend(path);
        const links = payload.webmentions ? await services.webmentions.send(path) : undefined;
        const activity = report === undefined ? null : resendActivity(report);
        const webmentions: ResendWebmentions | null =
          links === undefined || links.sent.length === 0
            ? null
            : {
                pages: links.sent.length,
                told: countOf(links.sent, 'sent'),
                none: countOf(links.sent, 'none'),
                failed: countOf(links.sent, 'failed'),
              };
        posts.push(
          activity === null && webmentions === null
            ? { path, resent: false }
            : { path, resent: true, activity, webmentions },
        );
        await context.progress({ done: posts.length, total: paths.length });
      }
      return { posts };
    },
  };
}

export function resendActivity(report: DeliveryReport): ResendActivity {
  return {
    activityType: report.activityType,
    heldByDevMode: report.held,
    inboxes: report.deliveries.length,
    reached: countOf(report.deliveries, 'sent'),
    queued: countOf(report.deliveries, 'queued'),
    failed: countOf(report.deliveries, 'failed'),
  };
}

function countOf(rows: readonly { readonly status: string }[], status: string): number {
  return rows.filter((row) => row.status === status).length;
}

function parseResendPayload(payload: Json): ResendPayload {
  if (isRecord(payload) && typeof payload['webmentions'] === 'boolean') {
    const { paths, webmentions } = payload;
    if (paths === 'all') return { paths, webmentions };
    if (Array.isArray(paths) && paths.every((path) => typeof path === 'string')) {
      return { paths: paths as readonly string[], webmentions };
    }
  }
  throw new Error(
    'A resend job names its posts’ paths, or "all", and whether to send webmentions.',
  );
}
