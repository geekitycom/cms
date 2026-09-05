import path from 'node:path';

import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';

/**
 * The addresses this site has been told to stop writing to.
 *
 * A commenter who ticked "tell me about replies" and later changed their mind
 * clicks one link and is done, without a login and without answering anything.
 * That is the whole of what an unsubscribe has to be, and everything else here
 * follows from it:
 *
 * - **Site-wide, by address.** Not per post and not per thread. Somebody who
 *   presses Unsubscribe means "stop", and a site that then wrote to them about
 *   a different post would have been reading the button as "stop, on this page
 *   only". It also means one click settles every thread they are in, including
 *   the ones they have forgotten about.
 * - **In `data/`, not `content/`.** The list is a list of email addresses.
 *   `content/` is published with the site and goes into git; this is written
 *   0600 beside the password hashes, and no screen ever renders it.
 * - **Folded to lower case.** An address is case-insensitive in practice, and
 *   somebody who unsubscribed as `Grace@example.com` has unsubscribed.
 *
 * A comment keeps its `notify` flag either way. The opt-out is checked at the
 * moment of sending, so the list is the one thing that has to be right, and
 * nothing has to go back and rewrite comment files somebody may have in git.
 */

/** The file, relative to `dataDir`. */
export const COMMENT_OPTOUTS_FILE = 'comment-optouts.json';

/** Nobody but the site's own user reads it. */
export const COMMENT_OPTOUTS_FILE_MODE = 0o600;

/** Where the list lives for a given data directory. */
export function commentOptOutsFile(dataDir: string): string {
  return path.join(dataDir, COMMENT_OPTOUTS_FILE);
}

/**
 * Every address that has asked not to hear any more, folded to lower case.
 *
 * A file that is missing, damaged or not the shape it should be reads as an
 * empty list rather than throwing. That is the wrong direction to fail in and
 * it is chosen deliberately: the alternative is a site whose comment endpoint
 * throws because a JSON file has a stray comma in it.
 */
export function readCommentOptOuts(dataDir: string): Set<string> {
  return optOutsIn(readFileIfPresentSync(commentOptOutsFile(dataDir)));
}

/** Whether this site has been told to stop writing to that address. */
export function hasOptedOut(dataDir: string, email: string | null | undefined): boolean {
  if (email === null || email === undefined || email === '') return false;
  return readCommentOptOuts(dataDir).has(email.trim().toLowerCase());
}

/**
 * Stop writing to an address. Returns whether it was not already on the list.
 *
 * The read is inside the write, so two links clicked at once cannot lose one
 * another's address.
 */
export async function addCommentOptOut(dataDir: string, email: string): Promise<boolean> {
  const wanted = email.trim().toLowerCase();
  if (wanted === '') return false;

  let added = false;

  await updateFileAtomically(
    commentOptOutsFile(dataDir),
    (current) => {
      const held = optOutsIn(current);
      added = !held.has(wanted);
      held.add(wanted);
      return `${JSON.stringify({ addresses: [...held].sort() }, null, 2)}\n`;
    },
    { mode: COMMENT_OPTOUTS_FILE_MODE },
  );

  return added;
}

/** The addresses a file's bytes hold. */
function optOutsIn(source: string | undefined): Set<string> {
  if (source === undefined) return new Set();

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return new Set();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Set();

  const listed = (parsed as Record<string, unknown>)['addresses'];
  if (!Array.isArray(listed)) return new Set();

  const found = new Set<string>();
  for (const entry of listed) {
    if (typeof entry === 'string' && entry.trim() !== '') found.add(entry.trim().toLowerCase());
  }
  return found;
}
