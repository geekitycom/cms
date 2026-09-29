import type { AdminStore, CommentRecord, RedactedField } from '../admin/store.ts';
import { REDACTED_FIELDS } from '../admin/store.ts';
import { readSiteSettings, retentionPolicyOf } from '../admin/settings.ts';
import { commentSlugs, rewriteComments } from '../comments/records.ts';
import type { ResolvedConfig } from '../config.ts';
import {
  deleteContactMessage,
  listContactMessages,
  updateContactMessage,
} from '../contact/records.ts';
import type { ContactMessage } from '../contact/records.ts';
import { systemNotificationTimers } from '../notifications/digest.ts';
import type { NotificationTimers } from '../notifications/digest.ts';
import { outlived } from './policy.ts';
import type { RetentionPolicy } from './policy.ts';

/**
 * The retention sweep (TASK-135): what removes the personal data a site has
 * kept for longer than it said it would.
 *
 * The files are the truth (decision-9), so the sweep reads them rather than
 * the index: every comment file under `content/_data/comments/` and every
 * message under `data/contact/`, each rewritten inside the lock every other
 * writer of that file takes, and each comment it changes put back into the
 * index in the same step. Removing a value that is already gone is not a
 * change, so a sweep run twice, or run again after a crash halfway through,
 * finishes in the same place and writes nothing the second time.
 */

/** How often the sweep runs once the site serves. */
export const RETENTION_SWEEP_MS = 6 * 60 * 60 * 1000;

/** What one sweep changed. */
export interface RetentionReport {
  /** Comments that lost an email, an address hash or both. */
  readonly comments: number;
  /** Contact messages deleted for being older than the site keeps them. */
  readonly messagesDeleted: number;
  /** Contact messages that lost their address hash. */
  readonly messagesRedacted: number;
}

/**
 * One comment as the policy leaves it, or `undefined` when it has nothing to
 * give up. The email goes with the reply subscription it served, since there
 * is nowhere left to send one; the thread, the status and the words stay.
 */
export function expireComment(
  comment: CommentRecord,
  policy: RetentionPolicy,
  now: Date,
): CommentRecord | undefined {
  const email =
    comment.author.email !== null && outlived(comment.submitted, policy.commentEmailDays, now);
  const address =
    comment.addressHash !== null && outlived(comment.submitted, policy.addressHashDays, now);
  if (!email && !address) return undefined;

  return {
    ...comment,
    author: email ? { ...comment.author, email: null } : comment.author,
    addressHash: address ? null : comment.addressHash,
    notify: email ? false : comment.notify,
    redacted: withRedacted(comment.redacted, [
      ...(email ? (['email'] as const) : []),
      ...(address ? (['addressHash'] as const) : []),
    ]),
  };
}

/** What a contact message comes to under the policy. */
export type ContactExpiry =
  | { readonly kind: 'keep' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'redact'; readonly message: ContactMessage };

/**
 * One contact message under the policy: kept as it is, deleted outright, or
 * kept without the hash of the address it came from. A message is its
 * sender's words and address together, so it has no smaller form to shrink
 * to once its own period is up.
 */
export function expireContactMessage(
  message: ContactMessage,
  policy: RetentionPolicy,
  now: Date,
): ContactExpiry {
  if (outlived(message.received, policy.contactMessageDays, now)) return { kind: 'delete' };
  if (message.addressHash !== null && outlived(message.received, policy.addressHashDays, now)) {
    return { kind: 'redact', message: { ...message, addressHash: null } };
  }
  return { kind: 'keep' };
}

/** `held` with `added` joined in, in {@link REDACTED_FIELDS} order. */
export function withRedacted(
  held: readonly RedactedField[] | undefined,
  added: readonly RedactedField[],
): RedactedField[] {
  const all = new Set([...(held ?? []), ...added]);
  return REDACTED_FIELDS.filter((field) => all.has(field));
}

/** What {@link createRetentionService} needs. */
export interface CreateRetentionServiceOptions {
  /** The comment index the sweep keeps in step with the files. */
  readonly admin: AdminStore;
  /** Where the files are, and the clock the ages are measured by. */
  readonly config: Pick<ResolvedConfig, 'contentDir' | 'dataDir' | 'now'>;
  /** Defaults to the real interval timer. */
  readonly timers?: NotificationTimers | undefined;
  /** Defaults to `console`. */
  readonly logger?: { warn(message: string): void } | undefined;
}

/** The sweep, on a timer once the site serves. */
export interface RetentionService {
  /** Sweep now, queued behind any sweep already running, and say what changed. */
  sweep(): Promise<RetentionReport>;
  /** Sweep now and then every {@link RETENTION_SWEEP_MS}. Safe twice. */
  start(): void;
  /** Stop the timer. Safe before starting and safe twice. */
  stop(): void;
  /** Resolve once the sweep in flight has finished. */
  settled(): Promise<void>;
}

const NOTHING: RetentionReport = { comments: 0, messagesDeleted: 0, messagesRedacted: 0 };

/** Build the retention sweep for one site. */
export function createRetentionService(options: CreateRetentionServiceOptions): RetentionService {
  const { admin, config } = options;
  const timers = options.timers ?? systemNotificationTimers;
  const logger = options.logger ?? console;
  let sweeping: Promise<unknown> = Promise.resolve();
  let handle: unknown;

  async function sweepOnce(): Promise<RetentionReport> {
    // Read every time, so a period changed on the Discussion screen holds from
    // the next sweep without a restart.
    const policy = retentionPolicyOf(readSiteSettings(config.contentDir));
    const now = config.now();
    const records = { admin, contentDir: config.contentDir };

    let comments = 0;
    for (const slug of commentSlugs(config.contentDir)) {
      const changed = await rewriteComments(records, slug, (comment) =>
        expireComment(comment, policy, now),
      );
      comments += changed.length;
    }

    let messagesDeleted = 0;
    let messagesRedacted = 0;
    for (const listed of listContactMessages(config.dataDir)) {
      const expiry = expireContactMessage(listed, policy, now);
      if (expiry.kind === 'delete') {
        if (await deleteContactMessage(config.dataDir, listed.id)) messagesDeleted += 1;
      } else if (expiry.kind === 'redact') {
        let redacted = false;
        // Decided again on the message as the lock finds it, so a Mark read
        // that landed since the listing is kept.
        await updateContactMessage(config.dataDir, listed.id, (current) => {
          const again = expireContactMessage(current, policy, now);
          if (again.kind !== 'redact') return undefined;
          redacted = true;
          return again.message;
        });
        if (redacted) messagesRedacted += 1;
      }
    }

    return { comments, messagesDeleted, messagesRedacted };
  }

  return {
    sweep() {
      const next = sweeping.then(sweepOnce).catch((thrown: unknown) => {
        logger.warn(`The retention sweep failed: ${messageOf(thrown)}`);
        return NOTHING;
      });
      sweeping = next;
      return next;
    },

    start() {
      if (handle !== undefined) return;
      void this.sweep();
      handle = timers.set(() => void this.sweep(), RETENTION_SWEEP_MS);
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
