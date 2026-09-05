import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import {
  readFileIfPresentSync,
  withFileLock,
  writeFileAtomically,
  writeFileAtomicallySync,
} from '../files/atomic.ts';

/**
 * A contact message as the file that holds it.
 *
 * decision-9 makes the filesystem the source of truth for everything durable,
 * and a message somebody typed into this site is exactly that: nothing else
 * holds it, and no other server can be asked for it again. So it is written to
 * disk **before** anything is emailed, which is the point — a provider that is
 * down, a key that has expired, an address that bounces, and the message is
 * still on the Messages screen tomorrow.
 *
 * Two things separate this from the comment files:
 *
 * - **It lives under `data/`, not under `content/`.** A message carries the
 *   sender's email address and was never meant to be published; `content/` is
 *   in git and is copied to the public site by an Eleventy build.
 * - **There is no SQLite index.** A contact inbox is tens or hundreds of
 *   files, the screen reads all of them to sort them anyway, and an index
 *   would be a second thing to keep true for no query it makes faster. Files
 *   are truth here with nothing derived from them at all.
 *
 * One JSON file per message, named by its id, which starts with the instant it
 * arrived — so `ls` is the inbox in order, and so no two messages can collide.
 */

/** Where the messages live, relative to the data directory. */
export const CONTACT_DATA_DIRECTORY = 'contact';

/** The absolute path of one site's `data/contact`. */
export function contactDirectory(dataDir: string): string {
  return path.join(dataDir, CONTACT_DATA_DIRECTORY);
}

/**
 * What became of a submission, as the file records it.
 *
 * `spam` is a checker's opinion rather than a person's, and the message is
 * kept and shown on a list of its own rather than thrown away: a false
 * positive on a contact form is a customer whose message vanished, which is a
 * worse failure than a spam list somebody has to glance at. Nothing else is
 * ever written — a submission the honeypot, the clock or the rate limit
 * refused leaves no file at all, because storing those would hand an anonymous
 * caller a way to fill the disk.
 */
export type ContactStatus = 'received' | 'spam';

/** One contact message, as its file says it. */
export interface ContactMessage {
  /** Its id, which is its filename and starts with the instant it arrived. */
  id: string;
  /** When it arrived, as a UTC instant. */
  received: string;
  /** Whether a checker thought it was spam. */
  status: ContactStatus;
  /** Whether somebody has read it on the Messages screen. */
  read: boolean;
  /** The page the form was on. */
  page: {
    /** Its slug. */
    slug: string;
    /** Its permalink, so the screen can link to where the form was. */
    permalink: string;
    /** Its title at the time, so a page since renamed still reads sensibly. */
    title: string;
  };
  /** Who sent it. */
  from: {
    /** The name they gave. */
    name: string;
    /** The address they gave, which the message replies to. */
    email: string;
  };
  /** What it is about. May be empty. */
  subject: string;
  /** The message itself, as plain text. */
  message: string;
  /**
   * A salted hash of the address it came from, or `null` when the site could
   * not tell. The same hash a comment keeps, so a run from one machine is
   * visible across both.
   */
  addressHash: string | null;
}

/** A message on its way in, before it has been given an id. */
export type NewContactMessage = Omit<ContactMessage, 'id' | 'read'> & {
  /** Whether it has been read. Defaults to no, which is what a new one is. */
  read?: boolean | undefined;
};

/**
 * Ids a file may be named after: the instant, a dash and eight hex characters.
 *
 * Checked on the way in as well as on the way out, so an id off a form can
 * never name a path — there is no separator, no dot and no letter outside the
 * set in anything that matches.
 */
const SAFE_ID = /^[0-9]{8}T[0-9]{9}Z-[0-9a-f]{8}$/;

/**
 * The id a message received at this instant gets.
 *
 * The instant first, compacted so it is one filename-safe token, and then
 * enough randomness that two messages in the same millisecond cannot collide.
 */
export function contactMessageId(received: Date): string {
  const stamp = received.toISOString().replace(/[-:.]/g, '');
  return `${stamp}-${randomBytes(4).toString('hex')}`;
}

/** The absolute path of one message's file. */
export function contactMessageFile(dataDir: string, id: string): string {
  if (!SAFE_ID.test(id)) {
    throw new Error(`"${id}" is not an id a contact message file can be named after.`);
  }
  return path.join(contactDirectory(dataDir), `${id}.json`);
}

/**
 * Write a message, and hand back what was written.
 *
 * The id is minted here rather than by the caller, so the only thing that
 * decides what a message is called is the thing that stores it.
 */
export async function addContactMessage(
  dataDir: string,
  message: NewContactMessage,
): Promise<ContactMessage> {
  const stored: ContactMessage = {
    ...message,
    id: contactMessageId(new Date(message.received)),
    read: message.read ?? false,
  };

  await writeFileAtomically(
    contactMessageFile(dataDir, stored.id),
    `${JSON.stringify(stored, null, 2)}\n`,
    // The sender's address is in here, so the file is the site's own to read
    // and nobody else's, exactly like the credentials beside it.
    { mode: 0o600 },
  );

  return stored;
}

/**
 * Every message the directory holds, newest first.
 *
 * A file that will not parse is skipped rather than thrown over: a directory
 * somebody has been editing by hand should cost that message rather than take
 * the Messages screen down, and the file is still there to be looked at.
 */
export function listContactMessages(
  dataDir: string,
  options: { status?: ContactStatus | undefined } = {},
): ContactMessage[] {
  const messages: ContactMessage[] = [];

  for (const id of contactMessageIds(dataDir)) {
    const message = readContactMessage(dataDir, id);
    if (message === undefined) continue;
    if (options.status !== undefined && message.status !== options.status) continue;
    messages.push(message);
  }

  // By id, which begins with the instant, so the order is chronological
  // without a date having to be parsed for every comparison.
  return messages.sort((one, other) => (one.id < other.id ? 1 : one.id > other.id ? -1 : 0));
}

/** How many messages are waiting to be read, which is the number on the dashboard. */
export function countUnreadContactMessages(dataDir: string): number {
  return listContactMessages(dataDir).filter((message) => !message.read).length;
}

/** How many messages each list holds, for the tabs on the Messages screen. */
export function countContactMessagesByStatus(dataDir: string): Record<ContactStatus, number> {
  const counts: Record<ContactStatus, number> = { received: 0, spam: 0 };
  for (const message of listContactMessages(dataDir)) counts[message.status] += 1;
  return counts;
}

/** One message, or `undefined` for an id nothing is filed under. */
export function readContactMessage(dataDir: string, id: string): ContactMessage | undefined {
  if (!SAFE_ID.test(id)) return undefined;

  const raw = readFileIfPresentSync(contactMessageFile(dataDir, id));
  if (raw === undefined) return undefined;

  return messageFrom(raw, id);
}

/**
 * Mark a message read, or unread again, and hand back what it now says.
 *
 * The file is re-read inside the write, so two admins with the screen open
 * cannot make one of them undo the other's delete by writing back a message
 * that is not there any more.
 */
export async function setContactMessageRead(
  dataDir: string,
  id: string,
  read: boolean,
): Promise<ContactMessage | undefined> {
  if (!SAFE_ID.test(id)) return undefined;

  const file = contactMessageFile(dataDir, id);

  // The read, the change and the write inside one lock, with the writer that
  // does not queue: a message deleted while this screen was open must not be
  // written back by a Mark read that arrived a moment later.
  return await withFileLock(file, () => {
    const current = readFileIfPresentSync(file);
    if (current === undefined) return undefined;

    const message = messageFrom(current, id);
    if (message === undefined) return undefined;

    const updated: ContactMessage = { ...message, read };
    writeFileAtomicallySync(file, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
    return updated;
  });
}

/** Delete a message. `false` when there was nothing of that id to delete. */
export async function deleteContactMessage(dataDir: string, id: string): Promise<boolean> {
  if (!SAFE_ID.test(id)) return false;

  const file = contactMessageFile(dataDir, id);
  return await withFileLock(file, async () => {
    if (readFileIfPresentSync(file) === undefined) return false;
    await rm(file, { force: true });
    return true;
  });
}

/** Every id the directory holds, unsorted. A missing directory is no messages. */
function contactMessageIds(dataDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(contactDirectory(dataDir));
  } catch {
    return [];
  }

  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((id) => SAFE_ID.test(id));
}

/**
 * One file's bytes as the message it names, or `undefined` when they are not
 * one.
 *
 * Read key by key and tolerantly, like every other file this CMS treats as
 * truth: a message missing a field it should have is shown with that field
 * empty rather than taking the screen down.
 */
function messageFrom(source: string, id: string): ContactMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;

  const file = parsed as Record<string, unknown>;
  const page = record(file['page']);
  const from = record(file['from']);
  const status = file['status'];
  const addressHash = file['addressHash'];

  return {
    id,
    received: text(file['received']),
    status: status === 'spam' ? 'spam' : 'received',
    read: file['read'] === true,
    page: {
      slug: text(page['slug']),
      permalink: text(page['permalink']),
      title: text(page['title']),
    },
    from: { name: text(from['name']), email: text(from['email']) },
    subject: text(file['subject']),
    message: text(file['message']),
    addressHash: typeof addressHash === 'string' && addressHash !== '' ? addressHash : null,
  };
}

/** One value as a string, or the empty one. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** One value as an object, or an empty one. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
