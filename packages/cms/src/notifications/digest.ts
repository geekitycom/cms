import path from 'node:path';

import { listUsers } from '../admin/accounts.ts';
import { MODERATION_ACTIONS } from '../comments/moderate.ts';
import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import type { AdminStore, PostComment } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import type { ContentStore } from '../content/store.ts';
import type { MailService } from '../mail/service.ts';
import { COMMENTS_NOTIFICATION } from './comments.ts';
import { moderationLink } from './links.ts';
import {
  DELIVERY_WINDOW_MS,
  isBatchedMode,
  notificationMode,
  notificationRecipients,
} from './preferences.ts';

/**
 * One message a window instead of one message a comment.
 *
 * TASK-55 emails every moderator the moment something enters the queue, which
 * is right for a quiet site and wrong for a spam wave that Akismet let
 * through. A user who has chosen `hourly` or `daily` on `/admin/users` is sent
 * nothing when a comment arrives; instead this sends them one message per
 * window listing everything still waiting, each item with its own approve,
 * spam and delete links.
 *
 * Three decisions hold the whole thing up:
 *
 * - **A digest is derived, not queued.** It is built from what
 *   `admin.listComments({ status: 'pending' })` says right now, so an item
 *   somebody approved before the run is simply absent and there is no queue to
 *   keep true across a restart, a crash or a `geekity rebuild`. Nothing has to
 *   remember what it meant to send.
 * - **The only new state is when each user was last written to**, and it lives
 *   in `data/notification-digests.json` rather than in the database, because
 *   decision-9 says the database may be deleted whenever the site is stopped —
 *   and a forgotten timestamp would mean either a window silently skipped or a
 *   digest sent twice. It is its own file rather than a field in
 *   `data/users.json` because that file is the answer to "who may sign in",
 *   and a timestamp the sender rewrites every hour is bookkeeping rather than
 *   anything about the person.
 * - **Nothing is sent for an empty queue, and an empty run records nothing.**
 *   A user with nothing waiting is never emailed, and because their timestamp
 *   does not move, the first thing that does arrive goes out on the very next
 *   tick rather than waiting out a window that had nothing in it. The promise
 *   a mode makes is "at most one message per window", and that is kept.
 */

/** The message a batched user gets: everything still waiting, in one. */
export const COMMENT_DIGEST_TEMPLATE = 'comment-digest';

/** The file, relative to `dataDir`. */
export const DIGEST_TIMES_FILE = 'notification-digests.json';

/** Nobody but the site's own user reads it. */
export const DIGEST_TIMES_FILE_MODE = 0o600;

/**
 * How often the timer looks.
 *
 * A minute. The tick is not the window — each user's own mode decides whether
 * they are due — so this only sets how promptly a window that has come up is
 * noticed, and a minute's lag on an hourly digest is nothing while a busier
 * tick would be a query a minute for no one.
 */
export const DIGEST_TICK_MS = 60 * 1000;

/**
 * The most items one digest lists.
 *
 * A cap rather than "everything", because "everything" during a spam wave is a
 * message with thousands of entries and three signed links each, which no mail
 * provider would take and nobody could read. What is over the cap is counted
 * in a line at the bottom pointing at the moderation queue, and the next
 * window lists the next hundred.
 */
export const DIGEST_MAX_ITEMS = 100;

/** Where the digest times live for a given data directory. */
export function digestTimesFile(dataDir: string): string {
  return path.join(dataDir, DIGEST_TIMES_FILE);
}

/**
 * When each user last had a digest of each event, as
 * `{ [event]: { [userId]: instant } }`.
 *
 * Keyed by event as well as by user because the registry may grow a second
 * batched notice, and the two would then be on windows of their own. A file
 * that is missing, damaged or the wrong shape reads as nobody having had
 * anything — the same direction {@link readCommentOptOuts} fails in, and for
 * the same reason: the cost is a duplicate digest, and the alternative is a
 * site whose timer throws over a stray comma.
 */
export function readDigestTimes(dataDir: string): Record<string, Record<string, string>> {
  return digestTimesIn(readFileIfPresentSync(digestTimesFile(dataDir)));
}

/**
 * Write down that these users have just been sent a digest of this event.
 *
 * The read is inside the write, so two runs at once cannot lose one another's
 * timestamps.
 */
export async function recordDigestTimes(
  dataDir: string,
  event: string,
  users: readonly number[],
  at: Date,
): Promise<void> {
  if (users.length === 0) return;

  await updateFileAtomically(
    digestTimesFile(dataDir),
    (current) => {
      const held = digestTimesIn(current);
      const forEvent = { ...held[event] };
      for (const id of users) forEvent[String(id)] = at.toISOString();
      return `${JSON.stringify({ ...held, [event]: forEvent }, null, 2)}\n`;
    },
    { mode: DIGEST_TIMES_FILE_MODE },
  );
}

/**
 * The timer the digest waits on, injected so a test can fire it rather than
 * wait for it. The shape {@link ScheduleTimers} has, for the same reason: a
 * repeating tick, unreferenced so it never holds the process open on its own.
 */
export interface NotificationTimers {
  set(callback: () => void, everyMs: number): unknown;
  clear(handle: unknown): void;
}

/** The real one. */
export const systemNotificationTimers: NotificationTimers = {
  set(callback, everyMs) {
    const handle = setInterval(callback, everyMs);
    handle.unref?.();
    return handle;
  },
  clear(handle) {
    clearInterval(handle as NodeJS.Timeout);
  },
};

/** Where a digest run reports what it could not do. `console` will do. */
export interface DigestLogger {
  warn(message: string): void;
}

/** What {@link createCommentDigest} needs. */
export interface CreateCommentDigestOptions {
  /** The comment index, which is what "still pending" is asked of. */
  admin: AdminStore;
  /** The content index, for the posts the items are on. */
  store: ContentStore;
  /** The one door out for email. */
  mail: MailService;
  /**
   * Config after defaults: the base URL the links are absolute against, the
   * data directory the signing secret and the record live in, and the clock.
   */
  config: Pick<ResolvedConfig, 'baseUrl' | 'dataDir' | 'now'>;
  /** The timer to tick on. Defaults to {@link systemNotificationTimers}. */
  timers?: NotificationTimers | undefined;
  /** How often it ticks. Defaults to {@link DIGEST_TICK_MS}. */
  tickMs?: number | undefined;
  /** The most items one message lists. Defaults to {@link DIGEST_MAX_ITEMS}. */
  maxItems?: number | undefined;
  /** Where failures are reported. Defaults to `console`. */
  logger?: DigestLogger | undefined;
}

/** Sends the batched notices. Never throws, and never waits on a provider. */
export interface CommentDigest {
  /**
   * Send a digest to every user who is due one and has something waiting.
   * Resolves with how many messages were handed to the mail service.
   */
  run(): Promise<number>;
  /** Start ticking. Safe twice. */
  start(): void;
  /** Stop ticking. Safe before starting and safe twice. */
  stop(): void;
  /** Resolve once the run in flight, if there is one, has finished. */
  settled(): Promise<void>;
}

/** Build the digest sender for one site. */
export function createCommentDigest(options: CreateCommentDigestOptions): CommentDigest {
  const { admin, store, mail, config } = options;
  const timers = options.timers ?? systemNotificationTimers;
  const tickMs = options.tickMs ?? DIGEST_TICK_MS;
  const maxItems = options.maxItems ?? DIGEST_MAX_ITEMS;
  const logger = options.logger ?? console;

  let handle: unknown;
  let running: Promise<unknown> = Promise.resolve();

  /** The post an item is on, as a message names it. */
  function postOf(comment: PostComment): { title: string; url: string } {
    const document = store.getBySlug(comment.slug);
    return {
      title: document?.title ?? comment.slug,
      url: absolute(comment.permalink, config.baseUrl),
    };
  }

  /**
   * One item of the digest: the comment as a message prints it, the post it is
   * on, and its three links.
   *
   * The links are minted per recipient rather than once for the run, because a
   * moderation link is spent the first time it is used: two moderators sharing
   * one link would mean the second of them clicking a dead one.
   */
  function itemFor(comment: PostComment, now: Date): Record<string, unknown> {
    const context = { dataDir: config.dataDir, baseUrl: config.baseUrl, now };
    return {
      comment: {
        author: comment.author.name,
        // The website they gave, never their email: the message goes to a
        // moderator, but it also goes through a third party's servers.
        website: comment.author.url,
        source: comment.source,
        kind: comment.kind,
        text: comment.content.markdown,
        html: comment.content.html,
        submitted: comment.submitted,
        url: comment.url,
      },
      post: postOf(comment),
      actions: MODERATION_ACTIONS.map((action) => ({
        action,
        label: action === 'approve' ? 'Approve' : action === 'spam' ? 'Spam' : 'Delete',
        url: moderationLink(context, comment.id, action),
      })),
    };
  }

  async function send(): Promise<number> {
    // Asked before anything else, so a site that sends no mail never mints a
    // signing secret it would have no use for and never writes a record of
    // digests it did not send.
    if (!mail.configured()) return 0;

    const now = config.now();
    // Read per run rather than held, so a record written by another process —
    // or one restored with the rest of `data/` — is what this run goes on.
    const sentAt = readDigestTimes(config.dataDir)[COMMENTS_NOTIFICATION] ?? {};
    const due = notificationRecipients(listUsers(config.dataDir), COMMENTS_NOTIFICATION).filter(
      (recipient) => {
        const mode = notificationMode(recipient.user, COMMENTS_NOTIFICATION);
        if (!isBatchedMode(mode)) return false;
        return elapsed(sentAt[String(recipient.user.id)], now) >= DELIVERY_WINDOW_MS[mode];
      },
    );
    if (due.length === 0) return 0;

    // One query for the whole run: everybody due is due the same list, because
    // a digest is what is waiting rather than what has happened since.
    const pending = admin.listComments({ status: 'pending' });
    if (pending.length === 0) return 0;

    const listed = pending.slice(0, maxItems);
    const queueUrl = absolute('/admin/comments', config.baseUrl);

    for (const recipient of due) {
      void mail.send({
        to: recipient.email,
        template: COMMENT_DIGEST_TEMPLATE,
        data: {
          items: listed.map((comment) => itemFor(comment, now)),
          total: pending.length,
          more: pending.length - listed.length,
          mode: notificationMode(recipient.user, COMMENTS_NOTIFICATION),
          queueUrl,
        },
      });
    }

    // After the sends rather than before, because `send` never rejects: a
    // message the provider refuses is retried by the mail service itself, and
    // a run that recorded nothing would send the whole digest again next tick.
    await recordDigestTimes(
      config.dataDir,
      COMMENTS_NOTIFICATION,
      due.map((recipient) => recipient.user.id),
      now,
    );

    return due.length;
  }

  /** One run, and the thing `settled()` waits on. */
  function runOnce(): Promise<number> {
    const started = send();
    running = started;
    return started;
  }

  return {
    async run() {
      return await runOnce();
    },

    start() {
      if (handle !== undefined) return;
      handle = timers.set(() => {
        running = runOnce().catch((error: unknown) => {
          // A tick that fails is a line in the log and nothing else: the
          // record was not written, so the next tick tries the same window
          // again.
          logger.warn(`A comment digest could not be sent: ${messageOf(error)}`);
        });
      }, tickMs);
    },

    stop() {
      if (handle !== undefined) timers.clear(handle);
      handle = undefined;
    },

    async settled() {
      await running.catch(ignore);
    },
  };
}

/** How long ago that instant was, or `Infinity` for one that was never. */
function elapsed(instant: string | undefined, now: Date): number {
  if (instant === undefined) return Number.POSITIVE_INFINITY;
  const at = Date.parse(instant);
  // A timestamp nobody can read is a timestamp there is no reason to trust,
  // and treating it as "never" costs one duplicate digest at most.
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return now.getTime() - at;
}

/** The record a file's bytes hold. */
function digestTimesIn(source: string | undefined): Record<string, Record<string, string>> {
  if (source === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const found: Record<string, Record<string, string>> = {};
  for (const [event, times] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof times !== 'object' || times === null || Array.isArray(times)) continue;
    const forEvent: Record<string, string> = {};
    for (const [id, at] of Object.entries(times as Record<string, unknown>)) {
      if (typeof at === 'string' && at !== '') forEvent[id] = at;
    }
    if (Object.keys(forEvent).length > 0) found[event] = forEvent;
  }

  return found;
}

/** A site-root path as an absolute URL. */
function absolute(pathname: string, baseUrl: string): string {
  try {
    return new URL(pathname, baseUrl).href;
  } catch {
    return pathname;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ignore(): void {
  // A failed run is already logged; waiting for it must not throw.
}
