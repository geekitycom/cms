import type { CommentRecord } from '../store/admin-store.ts';
import { commentSlugs, readComments, rewriteComments } from '../comments/records.ts';
import type { CommentRecords } from '../comments/records.ts';
import { deleteContactMessage, listContactMessages } from '../contact/records.ts';
import { hasOptedOut, removeCommentOptOut } from '../notifications/optouts.ts';
import { messageOf } from '../util/errors.ts';
import { withRedacted } from './retention.ts';

/**
 * Erasing one person's personal data when they ask.
 *
 * A person is found by the email they gave, because that is the one thing
 * they can prove is theirs: a name is anybody's to type. Their comments stay
 * where they are in the thread, with their status and their words, under the
 * name {@link ERASED_NAME} and with nothing else of theirs left on them; a
 * comment deleted outright would take every reply to it out of the thread,
 * and the Comments screen is there for a comment whose words have to go too.
 * Their contact messages are deleted, because a message is nothing but what
 * they wrote and where to answer them, and the opt-out list forgets their
 * address.
 */

/** What an erased comment is signed with. */
export const ERASED_NAME = 'Anonymous';

/** What was found for an address, or what was erased for it. */
export interface PersonalDataReport {
  /** Comments carrying the address. */
  readonly comments: number;
  /** Contact messages sent from it. */
  readonly messages: number;
  /** Whether it is on the list of addresses not to email about replies. */
  readonly optedOut: boolean;
  /**
   * The posts whose comment or email file does not parse, so their comments
   * were neither counted nor erased. Each is named in a warning too.
   */
  readonly unreadable: readonly string[];
}

/** Where a person's data can be. */
export interface PersonalDataStores {
  /** The comment files and the index over them. */
  readonly records: CommentRecords;
  /** The data directory the contact messages and the opt-out list live in. */
  readonly dataDir: string;
}

/** An address as it is compared: trimmed and folded, as the opt-out list keeps it. */
function folded(email: string): string {
  return email.trim().toLowerCase();
}

/** Whether a comment was left under `email`. */
function isTheirs(comment: CommentRecord, email: string): boolean {
  return comment.author.email !== null && folded(comment.author.email) === email;
}

/** A comment with everything that says who wrote it taken off. */
export function eraseCommentAuthor(comment: CommentRecord): CommentRecord {
  return {
    ...comment,
    author: { name: ERASED_NAME, url: null, email: null, avatar: null },
    addressHash: null,
    notify: false,
    redacted: withRedacted(comment.redacted, [
      'email',
      ...(comment.addressHash === null ? [] : (['addressHash'] as const)),
      'author',
    ]),
  };
}

/**
 * `visit` run on every post with a comment file, and the posts it threw on:
 * one file that does not parse costs its own post, not every post after it.
 */
async function eachPost(
  contentDir: string,
  visit: (slug: string) => Promise<void> | void,
): Promise<string[]> {
  const unreadable: string[] = [];
  for (const slug of commentSlugs(contentDir)) {
    try {
      await visit(slug);
    } catch (error) {
      console.warn(`Comments not searched for personal data: ${messageOf(error)}`);
      unreadable.push(slug);
    }
  }
  return unreadable;
}

/** What the site holds under `email`, without changing any of it. */
export async function findPersonalData(
  stores: PersonalDataStores,
  email: string,
): Promise<PersonalDataReport> {
  const wanted = folded(email);
  let comments = 0;
  const unreadable = await eachPost(stores.records.contentDir, (slug) => {
    comments += readComments(stores.records, slug).filter((comment) =>
      isTheirs(comment, wanted),
    ).length;
  });
  const messages = listContactMessages(stores.dataDir).filter(
    (message) => folded(message.from.email) === wanted,
  ).length;
  return { comments, messages, optedOut: hasOptedOut(stores.dataDir, wanted), unreadable };
}

/**
 * Erase everything the site holds under `email`, and say what was erased.
 *
 * Both this and {@link findPersonalData} read the files rather than the index,
 * so a comment written by hand since the last boot is counted and erased.
 */
export async function erasePersonalData(
  stores: PersonalDataStores,
  email: string,
): Promise<PersonalDataReport> {
  const wanted = folded(email);
  if (wanted === '') return { comments: 0, messages: 0, optedOut: false, unreadable: [] };

  let comments = 0;
  const unreadable = await eachPost(stores.records.contentDir, async (slug) => {
    const changed = await rewriteComments(stores.records, slug, (comment) =>
      isTheirs(comment, wanted) ? eraseCommentAuthor(comment) : undefined,
    );
    comments += changed.length;
  });

  let messages = 0;
  for (const message of listContactMessages(stores.dataDir)) {
    if (folded(message.from.email) !== wanted) continue;
    if (await deleteContactMessage(stores.dataDir, message.id)) messages += 1;
  }

  const optedOut = await removeCommentOptOut(stores.dataDir, wanted);
  return { comments, messages, optedOut, unreadable };
}
