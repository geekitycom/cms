import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { NOTIFICATION_LOG, dataPath } from '../files/data-files.ts';
import {
  NOTIFICATION_EVENTS,
  isBatchedMode,
  notificationMode,
  notificationRecipients,
} from '../site/notification-preferences.ts';
import type { NotificationEvent } from '../site/notification-preferences.ts';
import { listUsers } from '../site/users.ts';

/**
 * What happened, kept until the digest that lists it has gone out.
 *
 * The moderation queue is a list of what is waiting, so the digest of it is
 * built from the queue at send time. A like, a quote or a new follower is not
 * waiting for anything: it happened, and once it is in the past nothing else
 * remembers it. So an event that is not the queue is written down here at the
 * moment it happens, once, for each user who takes it in an hourly or a daily
 * digest, and each user is crossed off an item when a digest carrying it has
 * been handed to the mail service.
 *
 * - **It is a file**, because the database may be deleted whenever the site
 *   is stopped, and an item that is only in the database is one a restart
 *   loses.
 * - **An item names its users** rather than leaving the digest to work out who
 *   has had it from timestamps, so a user who switches to a digest is not sent
 *   what they were already told about as it arrived, and two items stamped the
 *   same millisecond cannot be told apart wrongly.
 * - **An item is keyed** within its event, so the same activity delivered
 *   twice is listed once, and an Undo can take it back by the same key. An
 *   item everybody has had stays as a key until it ages out, so a late retry
 *   of it is still recognised.
 */

/** One thing that happened, as the event's source describes it. */
export interface NoticeItem {
  /**
   * What makes it this thing and no other within its event: an activity id,
   * an actor id. Recording a key the log already holds does nothing, and
   * {@link withdrawNotice} takes an item back by it.
   */
  readonly key: string;
  /** Who did it, linked when they have somewhere to link to. */
  readonly actor: { readonly name: string; readonly url?: string | undefined };
  /** What they did, as the words after their name: `quoted`, `followed the site`. */
  readonly action: string;
  /** The post they did it to, when there is one. */
  readonly post?: { readonly title: string; readonly url: string } | undefined;
  /** What they said, as plain text, when they said anything. */
  readonly text?: string | undefined;
  /** Where the thing itself is: the quote, the reply. */
  readonly url?: string | undefined;
}

/** An item as the log holds it: when it happened, and who has yet to be sent it. */
export interface LoggedNotice extends NoticeItem {
  /** When it was recorded, as an ISO instant. */
  readonly at: string;
  /** The users a digest has still to carry it to. Empty once everybody has had it. */
  readonly for: readonly number[];
}

/** Nobody but the site's own user reads it. */
export const NOTICE_LOG_FILE_MODE = 0o600;

/**
 * How long an item is kept, sent or not.
 *
 * A week: longer than the longest window by enough to cover a site that was
 * down for days, and long enough for a sender's retries to have stopped, so a
 * key is still known when the last retry of it arrives.
 */
export const NOTICE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Where the log lives for a given data directory. */
export function noticeLogFile(dataDir: string): string {
  return dataPath(dataDir, NOTIFICATION_LOG);
}

/** The whole log, `{ [event]: LoggedNotice[] }`. A missing or damaged file reads as empty. */
export function readNoticeLog(dataDir: string): Record<string, LoggedNotice[]> {
  return noticeLogIn(readFileIfPresentSync(noticeLogFile(dataDir)));
}

/**
 * Write down that something happened, for every user who takes that event in
 * an hourly or a daily digest.
 *
 * A user who takes it as it arrives is not written down: telling them is the
 * event source's own message, sent now. When nobody takes it in a digest, the
 * file is not touched.
 */
export async function recordNotice(input: {
  dataDir: string;
  /** The event's name in the registry. */
  event: string;
  item: NoticeItem;
  now: Date;
  /** The registry, for a test that brings its own. */
  events?: readonly NotificationEvent[] | undefined;
}): Promise<void> {
  const events = input.events ?? NOTIFICATION_EVENTS;
  const batched = notificationRecipients(listUsers(input.dataDir), input.event, events)
    .filter((recipient) => isBatchedMode(notificationMode(recipient.user, input.event, events)))
    .map((recipient) => recipient.user.id);
  if (batched.length === 0) return;

  await changeLog(input.dataDir, input.now, (log) => {
    const items = log[input.event] ?? [];
    if (items.some((logged) => logged.key === input.item.key)) return log;
    const logged: LoggedNotice = { ...input.item, at: input.now.toISOString(), for: batched };
    return { ...log, [input.event]: [...items, logged] };
  });
}

/** Take back what was recorded under that key, as an Undo does. Nothing if there is none. */
export async function withdrawNotice(input: {
  dataDir: string;
  event: string;
  key: string;
}): Promise<void> {
  if (readNoticeLog(input.dataDir)[input.event]?.some((item) => item.key === input.key) !== true)
    return;

  await changeLog(input.dataDir, undefined, (log) => ({
    ...log,
    [input.event]: (log[input.event] ?? []).filter((item) => item.key !== input.key),
  }));
}

/** The items of that event a digest has still to carry to that user, oldest first. */
export function noticesFor(
  log: Record<string, readonly LoggedNotice[]>,
  event: string,
  userId: number,
): LoggedNotice[] {
  return (log[event] ?? []).filter((item) => item.for.includes(userId));
}

/** Cross a user off the items a digest has just carried to them. */
export async function markNoticesSent(
  dataDir: string,
  sent: readonly { userId: number; event: string; keys: readonly string[] }[],
  now: Date,
): Promise<void> {
  if (sent.every((one) => one.keys.length === 0)) return;

  await changeLog(dataDir, now, (log) => {
    const next = { ...log };
    for (const { userId, event, keys } of sent) {
      next[event] = (next[event] ?? []).map((item) =>
        keys.includes(item.key) ? { ...item, for: item.for.filter((id) => id !== userId) } : item,
      );
    }
    return next;
  });
}

/**
 * Read, change and write the log under its lock, dropping what has aged out
 * on the way when there is a clock to age it by.
 */
async function changeLog(
  dataDir: string,
  now: Date | undefined,
  change: (log: Record<string, LoggedNotice[]>) => Record<string, LoggedNotice[]>,
): Promise<void> {
  await updateFileAtomically(
    noticeLogFile(dataDir),
    (current) => {
      const changed = change(noticeLogIn(current));
      const kept: Record<string, LoggedNotice[]> = {};
      for (const [event, items] of Object.entries(changed)) {
        const fresh =
          now === undefined
            ? items
            : items.filter((item) => now.getTime() - Date.parse(item.at) < NOTICE_RETENTION_MS);
        if (fresh.length > 0) kept[event] = fresh;
      }
      return `${JSON.stringify(kept, null, 2)}\n`;
    },
    { mode: NOTICE_LOG_FILE_MODE },
  );
}

/** The log a file's bytes hold, keeping only the items that have the shape of one. */
function noticeLogIn(source: string | undefined): Record<string, LoggedNotice[]> {
  if (source === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  const found: Record<string, LoggedNotice[]> = {};
  for (const [event, items] of Object.entries(parsed)) {
    if (!Array.isArray(items)) continue;
    const valid = items.filter(isLoggedNotice);
    if (valid.length > 0) found[event] = valid;
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLoggedNotice(value: unknown): value is LoggedNotice {
  if (!isRecord(value)) return false;
  const { key, at, action, actor } = value;
  return (
    typeof key === 'string' &&
    typeof at === 'string' &&
    !Number.isNaN(Date.parse(at)) &&
    typeof action === 'string' &&
    isRecord(actor) &&
    typeof actor['name'] === 'string' &&
    Array.isArray(value['for']) &&
    value['for'].every((id) => typeof id === 'number')
  );
}
