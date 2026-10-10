import type { Context, DocumentLoader } from '@fedify/fedify';
import { FetchError } from '@fedify/fedify';
import {
  Article,
  Collection,
  CollectionPage,
  Note,
  Object as ActivityObject,
  Page,
  PUBLIC_COLLECTION,
  Question,
} from '@fedify/vocab';

import type { AdminStore, InboxActivity } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import type { ContentStore } from '../content/store.ts';
import type { NotificationTimers } from '../notifications/digest.ts';
import { systemNotificationTimers } from '../notifications/digest.ts';
import type { ConversationReader, ThreadReply } from '../web/conversation.ts';
import { isFederatedDocument } from './article.ts';
import type { FederationContextData } from './federation.ts';
import { appendInboxActivity, removeInboxActivities } from './records.ts';
import type { FederationRecords } from './records.ts';
import { siteLoaders } from './site-loaders.ts';

/**
 * The fediverse replies nobody delivered (TASK-321).
 *
 * Somebody answering a fediverse reply on one of this site's posts addresses
 * the person they answer, not the site, so their reply never reaches the
 * inbox. The server the reply they answered lives on lists it in that note's
 * `replies` collection, so the site reads those collections and logs what it
 * finds as the `Create` it was never sent, marked as fetched (decision-50).
 * From there it is a reply like any other: threaded, counted, given a
 * `/replies/` key and a feed, and taken back by its author's `Delete`.
 *
 * It is polling, so everything is bounded: a thread is read at most once per
 * {@link BACKFILL_INTERVAL_MS} and only while its post is younger than
 * {@link BACKFILL_MAX_AGE_MS}; a reply's collection is read only while it sits
 * at most {@link BACKFILL_DEPTH} levels below the post, and at most
 * {@link BACKFILL_PAGES} pages of it. Nothing runs while a page is served.
 */

/** How often the sweep looks for a thread that is due. */
export const BACKFILL_SWEEP_MS = 60 * 60 * 1000;

/** How long a thread is left alone after it was read. */
export const BACKFILL_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** How old a post gets before its thread is no longer read. */
export const BACKFILL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** How far below the post a reply may sit and still have its collection read. */
export const BACKFILL_DEPTH = 4;

/** How many pages of one collection are read. */
export const BACKFILL_PAGES = 3;

/** How long reading one note and its collection may take. */
export const BACKFILL_TIMEOUT_MS = 30 * 1000;

/** Where when a thread was last read lives in {@link AdminStore.getState}, by permalink. */
export const BACKFILL_STATE_PREFIX = 'backfill.thread:';

/** One reply read out of a collection, ready to log. */
export interface FetchedNote {
  /** The note's id. */
  readonly id: string;
  /** Who wrote it, on the note's own server. */
  readonly actorId: string;
  /** The note as compacted JSON-LD. */
  readonly object: unknown;
}

/** What reading one note's `replies` collection came to. */
export type RepliesRead =
  /** The note is gone: its server answered 404 or 410. */
  | { readonly kind: 'gone' }
  /** Nothing could be learned, so nothing is concluded. */
  | { readonly kind: 'failed'; readonly reason: string }
  | {
      readonly kind: 'read';
      /** Every id the pages read listed, whether or not it could be read. */
      readonly listed: ReadonlySet<string>;
      /** The listed replies to the note that are public and could be read. */
      readonly notes: readonly FetchedNote[];
      /**
       * Whether the whole collection was read, which is the only time a reply
       * it does not list is known to be dropped. A note that publishes no
       * collection says nothing either way.
       */
      readonly complete: boolean;
    };

/** Read one note's replies. */
export type RepliesLoader = (noteId: string) => Promise<RepliesRead>;

/** How many posts the sweep asks the index for at a time, newest first. */
const POSTS_PAGE = 50;

/** HTTP statuses that mean a note is gone rather than unreachable. */
const GONE = new Set([404, 410]);

/**
 * The site's {@link RepliesLoader}: the note and its collection read with
 * {@link siteLoaders}, signed as the site's first account because a server in
 * authorized fetch mode answers an unsigned request with a 401.
 *
 * A listed item is read from its own server whenever it is not on the
 * collection's (Fedify refuses to trust an embedded copy across origins), and
 * never from this site: what this site published is in the thread already.
 */
export function signedRepliesLoader(
  contextOf: () => Context<FederationContextData>,
): RepliesLoader {
  return async (noteId) => {
    const context = contextOf();
    const site = new URL(context.data.config.baseUrl).origin;
    const signed = await siteLoaders(context, AbortSignal.timeout(BACKFILL_TIMEOUT_MS));
    const documentLoader: DocumentLoader = (url, options) =>
      new URL(url).origin === site
        ? Promise.reject(new Error(`${url} is this site's own`))
        : signed.documentLoader(url, options);
    const loaders = { contextLoader: signed.contextLoader, documentLoader };

    let note: ActivityObject;
    try {
      const remote = await loaders.documentLoader(noteId);
      note = await ActivityObject.fromJsonLd(remote.document, {
        ...loaders,
        baseUrl: new URL(remote.documentUrl),
      });
      if (note.id?.origin !== new URL(remote.documentUrl).origin) {
        return { kind: 'failed', reason: `${noteId} names an id on another server` };
      }
    } catch (thrown) {
      if (thrown instanceof FetchError && GONE.has(thrown.response?.status ?? 0)) {
        return { kind: 'gone' };
      }
      return { kind: 'failed', reason: messageOf(thrown) };
    }

    let collection: Collection | null;
    try {
      collection = await note.getReplies(loaders);
    } catch (thrown) {
      return { kind: 'failed', reason: messageOf(thrown) };
    }
    if (collection === null) return { kind: 'read', listed: new Set(), notes: [], complete: false };

    const listed = new Set<string>();
    const notes: FetchedNote[] = [];
    let current = collection;
    let pages = 0;

    for (;;) {
      // A collection lists its items itself or pages them from `first`.
      const paged = current instanceof CollectionPage;
      if (paged || current.itemIds.length > 0) {
        pages += 1;
        for (const id of current.itemIds) listed.add(id.href);
        for await (const item of current.getItems({ ...loaders, suppressError: true })) {
          const reply = await replyOf(item, noteId, loaders.contextLoader);
          if (reply !== undefined) notes.push(reply);
        }
      }

      const following = current instanceof CollectionPage ? current.nextId : current.firstId;
      if (following === null) return { kind: 'read', listed, notes, complete: true };
      if (pages >= BACKFILL_PAGES) break;

      let loaded: Collection | null;
      try {
        loaded =
          current instanceof CollectionPage
            ? await current.getNext(loaders)
            : await current.getFirst(loaders);
      } catch {
        loaded = null;
      }
      if (loaded === null) break;
      current = loaded;
    }
    return { kind: 'read', listed, notes, complete: false };
  };
}

/**
 * A listed item as the reply it is, or `undefined`.
 *
 * It has to answer the note whose collection listed it, be written by
 * somebody on its own server, so a page cannot put words in a stranger's
 * mouth, and be public, because the site is about to republish it.
 */
async function replyOf(
  item: unknown,
  noteId: string,
  contextLoader: DocumentLoader,
): Promise<FetchedNote | undefined> {
  if (
    !(item instanceof Note) &&
    !(item instanceof Article) &&
    !(item instanceof Page) &&
    !(item instanceof Question)
  ) {
    return undefined;
  }
  const id = item.id;
  const author = item.attributionId;
  if (id === null || author === null || author.origin !== id.origin) return undefined;
  if (item.replyTargetId?.href !== noteId) return undefined;
  const audience = [...item.toIds, ...item.ccIds].map((address) => address.href);
  if (!audience.includes(PUBLIC_COLLECTION.href)) return undefined;

  return {
    id: id.href,
    actorId: author.href,
    object: await item.toJsonLd({ format: 'compact', contextLoader }),
  };
}

/** Where the service reports a thread it could not read. */
export interface ReplyBackfillLogger {
  warn(message: string): void;
}

/** What {@link createReplyBackfill} needs. */
export interface CreateReplyBackfillOptions {
  readonly admin: AdminStore;
  readonly store: ContentStore;
  readonly conversation: Pick<ConversationReader, 'thread'>;
  readonly config: Pick<ResolvedConfig, 'now' | 'contentDir'>;
  readonly load: RepliesLoader;
  /** Told the author of every reply logged, so the thread can name them. */
  readonly heard?: ((actorId: string) => void) | undefined;
  /** Defaults to the real interval timer. */
  readonly timers?: NotificationTimers | undefined;
  /** Defaults to `console`. */
  readonly logger?: ReplyBackfillLogger | undefined;
}

/** Reads the replies collections of the fediverse replies in recent threads. */
export interface ReplyBackfill {
  /** Read every thread that is due, one at a time. Queued behind a sweep already running. */
  sweep(): Promise<void>;
  /** Sweep now and then every {@link BACKFILL_SWEEP_MS}. Safe twice. */
  start(): void;
  /** Stop the timer. Safe before starting and safe twice. */
  stop(): void;
  /** Resolve once the sweep in flight has finished. */
  settled(): Promise<void>;
}

/** Build the backfill for one site. */
export function createReplyBackfill(options: CreateReplyBackfillOptions): ReplyBackfill {
  const { admin, store, conversation, config, load } = options;
  const timers = options.timers ?? systemNotificationTimers;
  const logger = options.logger ?? console;
  const records: FederationRecords = { admin, contentDir: config.contentDir };

  let sweeping: Promise<void> = Promise.resolve();
  let handle: unknown;

  async function sweepOnce(): Promise<void> {
    for (const post of recentPosts()) {
      const now = config.now();
      const key = `${BACKFILL_STATE_PREFIX}${post.permalink}`;
      const last = Date.parse(admin.getState(key) ?? '');
      if (!Number.isNaN(last) && now.getTime() - last < BACKFILL_INTERVAL_MS) continue;
      // Stamped before reading, so a thread whose server fails is not asked
      // again on every sweep.
      admin.setState(key, now.toISOString());

      await backfill(level(conversation.thread(post).replies));
    }
  }

  /** The served posts younger than {@link BACKFILL_MAX_AGE_MS}, newest first. */
  function recentPosts(): Document[] {
    const now = config.now();
    const cutoff = now.getTime() - BACKFILL_MAX_AGE_MS;
    const recent: Document[] = [];
    for (let offset = 0; ; offset += POSTS_PAGE) {
      const posts = store.listAll({ type: 'post', draft: false, limit: POSTS_PAGE, offset });
      for (const post of posts) {
        const published = Date.parse(post.date ?? '');
        if (Number.isNaN(published)) continue;
        if (published < cutoff) return recent;
        if (isFederatedDocument(post, now)) recent.push(post);
      }
      if (posts.length < POSTS_PAGE) return recent;
    }
  }

  async function backfill(queue: { id: string; depth: number }[]): Promise<void> {
    for (let parent = queue.shift(); parent !== undefined; parent = queue.shift()) {
      let found: RepliesRead;
      try {
        found = await load(parent.id);
      } catch (thrown) {
        found = { kind: 'failed', reason: messageOf(thrown) };
      }

      if (found.kind === 'failed') {
        logger.warn(`Could not read the replies to ${parent.id}: ${found.reason}`);
        continue;
      }
      if (found.kind === 'gone') {
        await remove(createsOf(parent.id).filter((activity) => activity.fetched));
        continue;
      }

      for (const note of found.notes) {
        if (createsOf(note.id).length > 0) continue;
        await appendInboxActivity(records, createOf(note), {
          fetched: true,
          receivedAt: config.now().toISOString(),
        });
        options.heard?.(note.actorId);
        if (parent.depth < BACKFILL_DEPTH) queue.push({ id: note.id, depth: parent.depth + 1 });
      }

      if (found.complete) {
        await remove(
          fetchedRepliesTo(parent.id).filter(
            (activity) => activity.objectId !== null && !found.listed.has(activity.objectId),
          ),
        );
      }
    }
  }

  /** The logged `Create` rows carrying this note, delivered or fetched. */
  function createsOf(noteId: string): InboxActivity[] {
    return admin
      .listActivitiesAbout([noteId])
      .filter((activity) => activity.activityType === 'Create' && activity.objectId === noteId);
  }

  function fetchedRepliesTo(noteId: string): InboxActivity[] {
    return admin
      .listActivitiesAbout([noteId])
      .filter(
        (activity) =>
          activity.fetched && activity.activityType === 'Create' && activity.inReplyTo === noteId,
      );
  }

  /** Remove fetched replies and every fetched reply under them, which nothing would show. */
  async function remove(activities: readonly InboxActivity[]): Promise<void> {
    const gone = new Map<number, InboxActivity>();
    let frontier = [...activities];
    while (frontier.length > 0) {
      const next: InboxActivity[] = [];
      for (const activity of frontier) {
        if (gone.has(activity.id) || activity.objectId === null) continue;
        gone.set(activity.id, activity);
        next.push(...fetchedRepliesTo(activity.objectId));
      }
      frontier = next;
    }
    await removeInboxActivities(records, [...gone.values()]);
  }

  return {
    sweep() {
      const next = sweeping.then(sweepOnce).catch((thrown: unknown) => {
        logger.warn(`The reply backfill failed: ${messageOf(thrown)}`);
      });
      sweeping = next;
      return next;
    },

    start() {
      if (handle !== undefined) return;
      void this.sweep();
      handle = timers.set(() => void this.sweep(), BACKFILL_SWEEP_MS);
    },

    stop() {
      if (handle !== undefined) timers.clear(handle);
      handle = undefined;
    },

    async settled() {
      await sweeping;
    },
  };
}

/**
 * The fediverse replies a reader sees in a thread, shallowest first, each
 * with how far below the post it sits, down to {@link BACKFILL_DEPTH}.
 */
function level(replies: readonly ThreadReply[]): { id: string; depth: number }[] {
  const found: { id: string; depth: number }[] = [];
  let current = replies;
  for (let depth = 1; depth <= BACKFILL_DEPTH && current.length > 0; depth += 1) {
    for (const reply of current) {
      if ('source' in reply && reply.source === 'activitypub' && reply.kind === 'reply') {
        found.push({ id: reply.id, depth });
      }
    }
    current = current.flatMap((reply) => reply.replies);
  }
  return found;
}

/** The `Create` nobody delivered: the note, attributed to the author it names. */
function createOf(note: FetchedNote): string {
  const id = new URL(note.id);
  id.hash = 'fetched';
  return JSON.stringify({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: id.href,
    type: 'Create',
    actor: note.actorId,
    object: note.object,
  });
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
