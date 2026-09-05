import type { Hono } from 'hono';

import {
  countContactMessagesByStatus,
  countUnreadContactMessages,
  deleteContactMessage,
  listContactMessages,
  setContactMessageRead,
} from '../contact/records.ts';
import type { ContactMessage, ContactStatus } from '../contact/records.ts';
import type { GeekityEnv } from '../env.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { formatInTimezone } from './formatting.ts';
import { ADMIN_PREFIX } from './session.ts';
import { readSiteSettings } from './settings.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/**
 * The inbox: what the contact form left behind (TASK-56).
 *
 * A message is a file under `data/contact/` and nothing else — there is no
 * index, because this screen reads every file to sort them anyway and a second
 * copy of the truth would only be a second thing to keep true. So the two
 * actions here are a rewrite and an unlink, and the screen is a view of the
 * directory as it is at that moment (decision-9).
 *
 * Two lists rather than one. A checker's `spam` is an opinion about a message
 * somebody may really have sent, so it is kept rather than thrown away — but a
 * run of it must not bury the messages a person actually has to answer.
 */

/** Where the Messages screen lives. */
export const MESSAGES_PATH = `${ADMIN_PREFIX}/messages`;

/** The navigation section it marks as current. */
export const MESSAGES_SECTION = 'messages';

/** Where the Mark read and Mark unread buttons post. */
export const MESSAGES_READ_PATH = `${MESSAGES_PATH}/read`;

/** Where the Delete button posts. */
export const MESSAGES_DELETE_PATH = `${MESSAGES_PATH}/delete`;

/** The fields the forms on this screen submit. */
export const MESSAGE_FIELDS = {
  /** Which message a button is about. */
  id: 'id',
  /** Whether Mark read means read or unread. Empty is unread. */
  read: 'read',
  /** Which list to go back to afterwards. */
  status: 'status',
} as const;

/** How many messages one page of a list shows. */
export const MESSAGES_PER_PAGE = 25;

/** The two lists, in the order the screen offers them. */
export const MESSAGE_TABS: readonly { status: ContactStatus; label: string }[] = [
  { status: 'received', label: 'Inbox' },
  { status: 'spam', label: 'Spam' },
];

/** One message as the screen shows it. */
export interface MessageRow {
  /** Its id, which the buttons carry. */
  id: string;
  /** Where it stands. */
  status: ContactStatus;
  /** Whether somebody has read it. */
  read: boolean;
  /** The name they gave. */
  author: string;
  /** Their address, which is what a reply goes to. */
  email: string;
  /** What it is about, or the empty string. */
  subject: string;
  /** What it says, as plain text. */
  message: string;
  /** When it arrived, in the site's own time zone. */
  received: string;
  /** A short form of the address hash, for spotting one machine's run of them. */
  address: string | null;
  /** The page the form was on. */
  page: string;
  /** Where that page can be read, or `null` when it has no permalink. */
  pageUrl: string | null;
  /** A `mailto:` that answers this message with its subject already filled in. */
  replyUrl: string;
}

/** What {@link mountMessagesScreen} needs from the admin around it. */
export interface MountMessagesScreenOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/** Register the Messages screen. */
export function mountMessagesScreen(
  app: Hono<GeekityEnv>,
  options: MountMessagesScreenOptions,
): void {
  const { render } = options;

  app.get(MESSAGES_PATH, (c) => {
    const { dataDir, contentDir } = c.var.config;
    const status = statusOf(c.req.query('status'));
    const page = Math.max(1, Math.trunc(Number(c.req.query('page') ?? '1')) || 1);

    const counts = countContactMessagesByStatus(dataDir);
    const timezone = readSiteSettings(contentDir).timezone;
    const rows = listContactMessages(dataDir, { status })
      .slice((page - 1) * MESSAGES_PER_PAGE, page * MESSAGES_PER_PAGE)
      .map((message) => messageRow(message, timezone));

    const pages = Math.max(1, Math.ceil(counts[status] / MESSAGES_PER_PAGE));

    return render(c, ADMIN_TEMPLATES.messages, {
      section: MESSAGES_SECTION,
      heading: 'Messages',
      status,
      counts,
      unread: countUnreadContactMessages(dataDir),
      tabs: MESSAGE_TABS.map((tab) => ({
        ...tab,
        url: listUrl(tab.status),
        count: counts[tab.status],
        current: tab.status === status,
      })),
      rows,
      fields: MESSAGE_FIELDS,
      readUrl: MESSAGES_READ_PATH,
      deleteUrl: MESSAGES_DELETE_PATH,
      page,
      pages,
      previousUrl: page > 1 ? listUrl(status, page - 1) : undefined,
      nextUrl: page < pages ? listUrl(status, page + 1) : undefined,
    });
  });

  app.post(MESSAGES_READ_PATH, async (c) => {
    const body = await c.req.parseBody();
    const back = listUrl(statusOf(text(body[MESSAGE_FIELDS.status])));
    // A checkbox submits nothing at all when it is clear, which is what the
    // empty string here means: this button marks the message unread again.
    const read = text(body[MESSAGE_FIELDS.read]) !== '';

    const updated = await setContactMessageRead(
      c.var.config.dataDir,
      text(body[MESSAGE_FIELDS.id]),
      read,
    );

    if (updated === undefined) {
      flash(c, 'error', 'That message is not here any more.');
      return c.redirect(back, 303);
    }

    flash(
      c,
      'notice',
      read
        ? `Marked ${updated.from.name}’s message read.`
        : `Marked ${updated.from.name}’s message unread.`,
    );
    return c.redirect(back, 303);
  });

  app.post(MESSAGES_DELETE_PATH, async (c) => {
    const body = await c.req.parseBody();
    const back = listUrl(statusOf(text(body[MESSAGE_FIELDS.status])));
    const id = text(body[MESSAGE_FIELDS.id]);

    // Read before it goes, so the flash can say whose message it was. An id
    // that is not one never reaches the filesystem: the records module refuses
    // anything but the shape it mints.
    const held = listContactMessages(c.var.config.dataDir).find((message) => message.id === id)
      ?.from.name;

    if (!(await deleteContactMessage(c.var.config.dataDir, id))) {
      flash(c, 'error', 'That message is not here any more.');
      return c.redirect(back, 303);
    }

    flash(c, 'notice', `Deleted ${held ?? 'the'} message.`);
    return c.redirect(back, 303);
  });
}

/** How many messages are waiting to be read, which is the number on the dashboard. */
export function unreadMessages(dataDir: string): number {
  return countUnreadContactMessages(dataDir);
}

/** Where one list of the inbox lives. */
export function listUrl(status: ContactStatus, page = 1): string {
  const query = page > 1 ? `&page=${String(page)}` : '';
  return `${MESSAGES_PATH}?status=${status}${query}`;
}

/** A requested status, or the inbox for anything else. */
function statusOf(value: string | undefined): ContactStatus {
  return value === 'spam' ? 'spam' : 'received';
}

/** One stored message as the screen shows it. */
function messageRow(message: ContactMessage, timezone: string): MessageRow {
  const subject = message.subject === '' ? `A message from ${message.from.name}` : message.subject;

  return {
    id: message.id,
    status: message.status,
    read: message.read,
    author: message.from.name,
    email: message.from.email,
    subject: message.subject,
    message: message.message,
    received: formatInTimezone(message.received, timezone),
    // The first eight characters are enough to see that two messages came from
    // one place, which is the only question the hash is there to answer.
    address: message.addressHash === null ? null : message.addressHash.slice(0, 8),
    page: message.page.title === '' ? message.page.slug : message.page.title,
    pageUrl: message.page.permalink === '' ? null : message.page.permalink,
    // Answering from here rather than from a mail client is one click; the
    // subject comes back with `Re:` on it the way a reply would.
    replyUrl: `mailto:${encodeURIComponent(message.from.email)}?subject=${encodeURIComponent(`Re: ${subject}`)}`,
  };
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
