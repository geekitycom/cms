import { setTimeout as sleep } from 'node:timers/promises';

import type { Document } from '../content/document.ts';
import type { CatalogReader, DocumentLookup, IndexClock } from '../content/store.ts';
import type { ResolvedConfig } from '../config.ts';
import { jobName } from '../jobs/types.ts';
import type { JobDefinition, Json } from '../jobs/types.ts';
import type { AdminStore, Delivery, DeliveryStatus } from '../store/admin-store.ts';
import { NO_LIMIT } from '../store/rows.ts';
import { isRecord } from '../util/guards.ts';
import type { DeliveryReport, DeliveryService } from './delivery.ts';
import { ownObjectIds } from './article.ts';
import { resendActivity } from './resend-job.ts';
import type { ResendActivity } from './resend-job.ts';

/** A post is named by its content path, because a slug can name several. */
export type RetryFilter =
  | { readonly path: string; readonly inbox: string | null }
  | { readonly path: null; readonly inbox: string };

/**
 * What a recipient is owed. `post` is `announcement` when its newest `Create`
 * failed, so it may never have stored the post, and `revision` when only a
 * later activity about the post failed. `pin` is whether its newest `Add` or
 * `Remove` failed.
 */
export type Missed = {
  readonly post: 'announcement' | 'revision' | null;
  readonly pin: boolean;
};

export type RetryRecipient = {
  readonly actorId: string;
  readonly inboxId: string;
  readonly error: string | null;
  readonly missed: Missed;
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

const PIN_ACTIVITIES: ReadonlySet<string> = new Set(['Add', 'Remove']);

const POST_ORDER: readonly Missed['post'][] = ['announcement', 'revision', null];

export const RETRY_DELIVERIES_JOB = jobName<RetryFilter, RetryReport>('retry-deliveries');

/** A burst of deliveries to one server can trip its bot protection. */
export const RETRY_PACE_MS = 2000;

export interface RetryPlanServices {
  readonly store: DocumentLookup & CatalogReader & IndexClock;
  readonly admin: Pick<AdminStore, 'searchDeliveries'>;
  readonly config: Pick<ResolvedConfig, 'contentDir' | 'baseUrl'>;
}

export interface RetryJobServices extends RetryPlanServices {
  readonly delivery: Pick<DeliveryService, 'resend' | 'resendPin'>;
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

  const histories = new Map<string, RecipientHistory>();
  for (const row of history) {
    const path = postOf(row.objectId)?.path;
    if (path === undefined) continue;
    const key = JSON.stringify([path, row.actorId]);
    let held = histories.get(key);
    if (held === undefined) {
      held = { path };
      histories.set(key, held);
    }
    if (row.activityType === 'Create') held.create ??= row;
    if (PIN_ACTIVITIES.has(row.activityType)) held.pin ??= row;
    else held.post ??= row;
  }

  const retries = new Map<string, RetryRecipient[]>();
  for (const { path, ...rows } of histories.values()) {
    const missed = missedFrom(rows);
    const failure = newestFailure(rows, missed);
    if (failure === undefined) continue;
    if (filter.inbox !== null && failure.inboxId !== filter.inbox) continue;
    const recipient = {
      actorId: failure.actorId,
      inboxId: failure.inboxId,
      error: failure.error,
      missed,
    };
    const held = retries.get(path);
    if (held === undefined) retries.set(path, [recipient]);
    else held.push(recipient);
  }
  return [...retries].map(([path, recipients]) => ({ path, recipients }));
}

type RecipientHistory = {
  readonly path: string;
  create?: Delivery;
  post?: Delivery;
  pin?: Delivery;
};

type RecipientRows = Omit<RecipientHistory, 'path'>;

function failed(row: Delivery | undefined): row is Delivery {
  return row !== undefined && RETRIED.has(row.status);
}

/**
 * A failed `Create` is owed even after a later `Update` went through, because
 * a peer drops an `Update` of a status it never stored; only a later `Delete`
 * settles it.
 */
function missedFrom({ create, post, pin }: RecipientRows): Missed {
  const withdrawn = post?.activityType === 'Delete' && !failed(post);
  return {
    post: failed(create) && !withdrawn ? 'announcement' : failed(post) ? 'revision' : null,
    pin: failed(pin),
  };
}

function newestFailure({ create, post, pin }: RecipientRows, missed: Missed): Delivery | undefined {
  const owed = [
    missed.post === 'announcement' ? create : undefined,
    missed.post === null ? undefined : post,
    missed.pin ? pin : undefined,
  ].filter(failed);
  return owed.toSorted((a, b) => b.attemptedAt.localeCompare(a.attemptedAt))[0];
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
        for (const { missed, group } of byWhatTheyMissed(retry.recipients)) {
          const actors = new Set(group.map((recipient) => recipient.actorId));
          const reports: (DeliveryReport | undefined)[] = [];
          if (missed.post !== null) {
            const missedAnnouncement = missed.post === 'announcement';
            reports.push(
              await services.delivery.resend(retry.path, { actors, missedAnnouncement }),
            );
          }
          if (missed.pin) reports.push(await services.delivery.resendPin(retry.path, actors));
          for (const report of reports) {
            posts.push({
              path: retry.path,
              recipients: group.length,
              activity: report === undefined ? null : resendActivity(report),
            });
          }
        }
        await context.progress({ done: done + 1, total: retries.length });
      }
      return { posts };
    },
  };
}

function byWhatTheyMissed(
  recipients: readonly RetryRecipient[],
): { readonly missed: Missed; readonly group: RetryRecipient[] }[] {
  const groups = new Map<string, { readonly missed: Missed; readonly group: RetryRecipient[] }>();
  for (const recipient of recipients) {
    const key = JSON.stringify(recipient.missed);
    const held = groups.get(key);
    if (held === undefined) groups.set(key, { missed: recipient.missed, group: [recipient] });
    else held.group.push(recipient);
  }
  return [...groups.values()].toSorted(
    (a, b) => POST_ORDER.indexOf(a.missed.post) - POST_ORDER.indexOf(b.missed.post),
  );
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
