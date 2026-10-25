import { setTimeout as sleep } from 'node:timers/promises';

import { postObjectId } from '../content/guids.ts';
import type { CatalogReader, DocumentLookup } from '../content/store.ts';
import type { ResolvedConfig } from '../config.ts';
import { jobName } from '../jobs/types.ts';
import type { JobDefinition, Json } from '../jobs/types.ts';
import type { AdminStore, Delivery } from '../store/admin-store.ts';
import { NO_LIMIT } from '../store/rows.ts';
import { isRecord } from '../util/guards.ts';
import { postBySlug } from './delivery.ts';
import type { DeliveryService } from './delivery.ts';
import { objectIdsOf, readObjectIds } from './object-ids.ts';
import { resendActivity } from './resend-job.ts';
import type { ResendActivity } from './resend-job.ts';

export type RetryFilter =
  | { readonly slug: string; readonly inbox: string | null }
  | { readonly slug: null; readonly inbox: string };

export type RetryRecipient = {
  readonly actorId: string;
  readonly inboxId: string;
  readonly error: string | null;
  readonly missedAnnouncement: boolean;
};

export type Retry = { readonly slug: string; readonly recipients: RetryRecipient[] };

export type RetryReport = {
  readonly posts: readonly {
    readonly slug: string;
    readonly recipients: number;
    readonly activity: ResendActivity | null;
  }[];
};

export const RETRY_DELIVERIES_JOB = jobName<RetryFilter, RetryReport>('retry-deliveries');

/** A burst of deliveries to one server can trip its bot protection. */
export const RETRY_PACE_MS = 2000;

export interface RetryPlanServices {
  readonly store: DocumentLookup & CatalogReader;
  readonly admin: Pick<AdminStore, 'searchDeliveries'>;
  readonly config: Pick<ResolvedConfig, 'contentDir' | 'baseUrl'>;
}

export interface RetryJobServices extends RetryPlanServices {
  readonly delivery: Pick<DeliveryService, 'resend'>;
}

export function failedRetries(services: RetryPlanServices, filter: RetryFilter): Retry[] {
  const { admin, config } = services;
  let objectIds: string[] | undefined;
  if (filter.slug !== null) {
    const document = postBySlug(services.store, filter.slug);
    if (document === undefined) return [];
    objectIds = [
      ...objectIdsOf(readObjectIds(config.contentDir), postObjectId(document, config.baseUrl)),
    ];
  }
  const all = { limit: NO_LIMIT };
  const candidates = admin.searchDeliveries(
    { objectIds, inboxId: filter.inbox ?? undefined },
    all,
  ).items;
  const history =
    filter.inbox === null ? candidates : deliveriesToSameActors(admin, objectIds, candidates);

  const newest = new Map<string, { slug: string; row: Delivery }>();
  const newestCreate = new Map<string, Delivery>();
  for (const row of history) {
    const slug = filter.slug ?? row.slug;
    if (slug === null) continue;
    const key = JSON.stringify([slug, row.actorId]);
    if (!newest.has(key)) newest.set(key, { slug, row });
    if (row.activityType === 'Create' && !newestCreate.has(key)) newestCreate.set(key, row);
  }

  const retries = new Map<string, RetryRecipient[]>();
  for (const [key, { slug, row }] of newest) {
    if (row.status !== 'failed') continue;
    if (filter.inbox !== null && row.inboxId !== filter.inbox) continue;
    const recipient = {
      actorId: row.actorId,
      inboxId: row.inboxId,
      error: row.error,
      missedAnnouncement: newestCreate.get(key)?.status === 'failed',
    };
    const held = retries.get(slug);
    if (held === undefined) retries.set(slug, [recipient]);
    else held.push(recipient);
  }
  return [...retries].map(([slug, recipients]) => ({ slug, recipients }));
}

function deliveriesToSameActors(
  admin: RetryPlanServices['admin'],
  objectIds: string[] | undefined,
  rows: readonly Delivery[],
): Delivery[] {
  const actorIds = new Set(rows.map((row) => row.actorId));
  return [...actorIds].flatMap(
    (actorId) => admin.searchDeliveries({ objectIds, actorId }, { limit: NO_LIMIT }).items,
  );
}

export function retryDeliveriesJob(
  services: RetryJobServices,
  pace: (signal: AbortSignal) => Promise<void> = (signal) =>
    sleep(RETRY_PACE_MS, undefined, { signal }),
): JobDefinition<RetryFilter, RetryReport> {
  return {
    name: RETRY_DELIVERIES_JOB.name,
    parse: parseRetryFilter,
    async run(filter, context) {
      const retries = failedRetries(services, filter);
      const posts: RetryReport['posts'][number][] = [];
      for (const [done, retry] of retries.entries()) {
        context.signal.throwIfAborted();
        if (done > 0) await pace(context.signal);
        for (const missedAnnouncement of [true, false]) {
          const group = retry.recipients.filter(
            (recipient) => recipient.missedAnnouncement === missedAnnouncement,
          );
          if (group.length === 0) continue;
          const actors = new Set(group.map((recipient) => recipient.actorId));
          const report = await services.delivery.resend(retry.slug, { actors, missedAnnouncement });
          posts.push({
            slug: retry.slug,
            recipients: group.length,
            activity: report === undefined ? null : resendActivity(report),
          });
        }
        await context.progress({ done: done + 1, total: retries.length });
      }
      return { posts };
    },
  };
}

function parseRetryFilter(payload: Json): RetryFilter {
  if (isRecord(payload)) {
    const { slug, inbox } = payload;
    if (typeof slug === 'string' && (inbox === null || typeof inbox === 'string')) {
      return { slug, inbox };
    }
    if (slug === null && typeof inbox === 'string') return { slug, inbox };
  }
  throw new Error('A retry names a post’s slug, an inbox, or both.');
}
