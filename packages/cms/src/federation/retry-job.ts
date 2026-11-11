import { setTimeout as sleep } from 'node:timers/promises';

import type { Document } from '../content/document.ts';
import type { CatalogReader, DocumentLookup, IndexClock } from '../content/store.ts';
import type { ResolvedConfig } from '../config.ts';
import { jobName } from '../jobs/types.ts';
import type { JobDefinition, Json } from '../jobs/types.ts';
import type { AdminStore, Delivery, DeliveryStatus } from '../store/admin-store.ts';
import { NO_LIMIT } from '../store/rows.ts';
import { isRecord } from '../util/guards.ts';
import type { DeliveryService } from './delivery.ts';
import { ownObjectIds } from './article.ts';
import { resendActivity } from './resend-job.ts';
import type { ResendActivity } from './resend-job.ts';

/** A post is named by its content path, because a slug can name several. */
export type RetryFilter =
  | { readonly path: string; readonly inbox: string | null }
  | { readonly path: null; readonly inbox: string };

export type RetryRecipient = {
  readonly actorId: string;
  readonly inboxId: string;
  readonly error: string | null;
  readonly missedAnnouncement: boolean;
};

export type Retry = { readonly path: string; readonly recipients: RetryRecipient[] };

export type RetryReport = {
  readonly posts: readonly {
    readonly path: string;
    readonly recipients: number;
    readonly activity: ResendActivity | null;
  }[];
};

const RETRIED: ReadonlySet<DeliveryStatus> = new Set(['failed', 'unknown']);

export const RETRY_DELIVERIES_JOB = jobName<RetryFilter, RetryReport>('retry-deliveries');

/** A burst of deliveries to one server can trip its bot protection. */
export const RETRY_PACE_MS = 2000;

export interface RetryPlanServices {
  readonly store: DocumentLookup & CatalogReader & IndexClock;
  readonly admin: Pick<AdminStore, 'searchDeliveries'>;
  readonly config: Pick<ResolvedConfig, 'contentDir' | 'baseUrl'>;
}

export interface RetryJobServices extends RetryPlanServices {
  readonly delivery: Pick<DeliveryService, 'resend'>;
}

export function failedRetries(services: RetryPlanServices, filter: RetryFilter): Retry[] {
  const { admin, config } = services;
  let objectIds: string[] | undefined;
  let postOf = federatedPostOf(services);
  if (filter.path !== null) {
    const document = services.store.getByPath(filter.path);
    if (document?.type !== 'post') return [];
    objectIds = [...ownObjectIds(services.store, document, config)];
    postOf = () => document;
  }
  const all = { limit: NO_LIMIT };
  const candidates = admin.searchDeliveries(
    { objectIds, inboxId: filter.inbox ?? undefined },
    all,
  ).items;
  const history =
    filter.inbox === null ? candidates : deliveriesToSameActors(admin, objectIds, candidates);

  const newest = new Map<string, { path: string; row: Delivery }>();
  const newestCreate = new Map<string, Delivery>();
  for (const row of history) {
    const path = postOf(row.objectId)?.path;
    if (path === undefined) continue;
    const key = JSON.stringify([path, row.actorId]);
    if (!newest.has(key)) newest.set(key, { path, row });
    if (row.activityType === 'Create' && !newestCreate.has(key)) newestCreate.set(key, row);
  }

  const retries = new Map<string, RetryRecipient[]>();
  for (const [key, { path, row }] of newest) {
    if (!RETRIED.has(row.status)) continue;
    const create = newestCreate.get(key);
    if (filter.inbox !== null && row.inboxId !== filter.inbox) continue;
    const recipient = {
      actorId: row.actorId,
      inboxId: row.inboxId,
      error: row.error,
      missedAnnouncement: create !== undefined && RETRIED.has(create.status),
    };
    const held = retries.get(path);
    if (held === undefined) retries.set(path, [recipient]);
    else held.push(recipient);
  }
  return [...retries].map(([path, recipients]) => ({ path, recipients }));
}

/**
 * The announced post a delivery row's object id belongs to, under any id it
 * has been federated as. Built on first use, so a caller that never asks pays
 * nothing for the walk of every announced post.
 */
export function federatedPostOf(
  services: RetryPlanServices,
): (objectId: string) => Document | undefined {
  let posts: Map<string, Document> | undefined;
  return (objectId) => {
    posts ??= postsByObjectId(services);
    return posts.get(objectId);
  };
}

function postsByObjectId({ store, config }: RetryPlanServices): Map<string, Document> {
  const posts = new Map<string, Document>();
  for (const document of store.listFederated()) {
    for (const id of ownObjectIds(store, document, config)) {
      if (!posts.has(id)) posts.set(id, document);
    }
  }
  return posts;
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
          const report = await services.delivery.resend(retry.path, { actors, missedAnnouncement });
          posts.push({
            path: retry.path,
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
    const { path, inbox } = payload;
    if (typeof path === 'string' && (inbox === null || typeof inbox === 'string')) {
      return { path, inbox };
    }
    if (path === null && typeof inbox === 'string') return { path, inbox };
  }
  throw new Error('A retry names a post’s path, an inbox, or both.');
}
