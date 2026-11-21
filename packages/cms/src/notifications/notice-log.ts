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

export interface NoticeItem {
  readonly key: string;
  readonly actor: { readonly name: string; readonly url?: string | undefined };
  readonly action: string;
  readonly post?: { readonly title: string; readonly url: string } | undefined;
  readonly text?: string | undefined;
  readonly url?: string | undefined;
}

export interface LoggedNotice extends NoticeItem {
  readonly at: string;
  readonly for: readonly number[];
}

export const NOTICE_LOG_FILE_MODE = 0o600;

/**
 * How long an item is kept, sent or not.
 *
 * A week: longer than the longest window by enough to cover a site that was
 * down for days, and long enough for a sender's retries to have stopped, so a
 * key is still known when the last retry of it arrives.
 */
export const NOTICE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function noticeLogFile(dataDir: string): string {
  return dataPath(dataDir, NOTIFICATION_LOG);
}

export function readNoticeLog(dataDir: string): Record<string, LoggedNotice[]> {
  return noticeLogIn(readFileIfPresentSync(noticeLogFile(dataDir)));
}

export async function recordNotice(input: {
  dataDir: string;
  event: string;
  item: NoticeItem;
  now: Date;
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

export function noticesFor(
  log: Record<string, readonly LoggedNotice[]>,
  event: string,
  userId: number,
): LoggedNotice[] {
  return (log[event] ?? []).filter((item) => item.for.includes(userId));
}

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
