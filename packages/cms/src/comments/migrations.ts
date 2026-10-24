import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { COMMENT_PAGE_PREFIX, commentPageHref, repliesKey, isKey } from '../content/guids.ts';
import { readFileIfPresentSync, writeFileAtomicallySync } from '../files/atomic.ts';
import { nonEmptyStringOrNull } from '../util/forms.ts';
import { isRecord } from '../util/guards.ts';
import {
  COMMENT_EMAILS_FILE_MODE,
  commentEmailsFile,
  commentSlugs,
  commentsFile,
  contactsIn,
  contactsJson,
} from './records.ts';
import type { CommentContact, CommentRecords } from './records.ts';

/** What moving the emails out of `content/` changed. */
export interface CommentEmailMigrationReport {
  /** How many comment files were rewritten. */
  files: number;
}

/**
 * Move every email still in a comment file into `data/`.
 *
 * A site that kept comments before the emails moved has them in
 * `content/_data/comments/`, and a comment file somebody edits by hand may
 * gain one again. Boot calls this before `rebuildCommentIndexes`, so
 * both end up in the private file and out of the published one. It edits each
 * file's JSON as it finds it, taking off `author.email` and `notify` and
 * nothing else, so a key this version does not know and an entry it cannot
 * read survive it. An email `data/` already holds for that comment wins. A file
 * with nothing to take off is not written, so a second boot writes nothing.
 *
 * Synchronous, like the other boot migrations, and run before anything else
 * can be writing a comment.
 */
export function migrateCommentEmails(
  records: Pick<CommentRecords, 'contentDir' | 'dataDir'>,
): CommentEmailMigrationReport {
  let files = 0;

  for (const slug of commentSlugs(records.contentDir)) {
    const file = commentsFile(records.contentDir, slug);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileIfPresentSync(file) ?? '');
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed['comments'])) continue;

    const found = new Map<string, CommentContact>();
    let stripped = false;
    const entries = parsed['comments'].map((entry: unknown) => {
      if (!isRecord(entry)) return entry;
      const author = isRecord(entry['author']) ? entry['author'] : undefined;
      if (!('notify' in entry) && !(author !== undefined && 'email' in author)) return entry;

      stripped = true;
      const email = nonEmptyStringOrNull(author?.['email']);
      const id = entry['id'];
      if (typeof id === 'string' && id !== '' && email !== null) {
        found.set(id, { email, notify: entry['notify'] === true });
      }
      const kept = without(entry, 'notify');
      if (author !== undefined) kept['author'] = without(author, 'email');
      return kept;
    });
    if (!stripped) continue;

    const privateFile = commentEmailsFile(records.dataDir, slug);
    const contacts = contactsIn(readFileIfPresentSync(privateFile));
    for (const [id, contact] of found) if (!contacts.has(id)) contacts.set(id, contact);
    if (contacts.size > 0) {
      writeFileAtomicallySync(privateFile, contactsJson(contacts), {
        mode: COMMENT_EMAILS_FILE_MODE,
      });
    }
    writeFileAtomicallySync(file, `${JSON.stringify({ ...parsed, comments: entries }, null, 2)}\n`);
    files += 1;
  }

  return { files };
}

/** What giving the stored comments keys changed. */
export interface CommentKeyMigrationReport {
  /** How many comments were given a key. */
  comments: number;
}

/**
 * Give every stored comment whose id is not a key the key of that id:
 * the first 16 hex digits of its SHA-256, so every boot works
 * out the same one. A UUID a form comment or a webmention was given before
 * keys, and a URL an import wrote, both become keys this way.
 *
 * What names an old id follows it: a comment's `inReplyTo`, the email `data/`
 * keeps for it, and a document naming its old page or anchor, such as a reply
 * post's `in-reply-to`. The documents go first, then for each post the private
 * file with both keys, the comment file, and the private file with the new key
 * alone, so a boot stopped anywhere loses nothing and the next one finishes
 * the job. A site whose ids are all keys has its files read and none written.
 *
 * Synchronous, like the other boot migrations, and run before anything else
 * can be writing a comment.
 */
export function migrateCommentKeys(
  records: Pick<CommentRecords, 'contentDir' | 'dataDir'>,
): CommentKeyMigrationReport {
  const keys = new Map<string, string>();
  const held: {
    slug: string;
    file: string;
    parsed: Record<string, unknown>;
    entries: unknown[];
  }[] = [];
  for (const slug of commentSlugs(records.contentDir)) {
    const file = commentsFile(records.contentDir, slug);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileIfPresentSync(file) ?? '');
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed['comments'])) continue;
    for (const entry of parsed['comments']) {
      const id = isRecord(entry) ? entry['id'] : undefined;
      if (typeof id === 'string' && id !== '' && !isKey(id)) keys.set(id, repliesKey(id));
    }
    held.push({ slug, file, parsed, entries: parsed['comments'] });
  }

  const renamed = renamer(keys);
  if (keys.size > 0) rewriteDocuments(records.contentDir, renamed);

  for (const { slug, file, parsed, entries } of held) {
    const rekeyed = entries.map((entry: unknown) => {
      if (!isRecord(entry)) return entry;
      const id = entry['id'];
      const inReplyTo = entry['inReplyTo'];
      return {
        ...entry,
        ...(typeof id === 'string' && keys.has(id) ? { id: keys.get(id) } : {}),
        ...(typeof inReplyTo === 'string'
          ? { inReplyTo: keys.get(inReplyTo) ?? renamed(inReplyTo) }
          : {}),
      };
    });
    const changed = JSON.stringify(rekeyed) !== JSON.stringify(entries);

    const privateFile = commentEmailsFile(records.dataDir, slug);
    const contacts = contactsIn(readFileIfPresentSync(privateFile));
    const keyed = new Map<string, CommentContact>();
    for (const [id, contact] of contacts) {
      const key = isKey(id) ? id : repliesKey(id);
      if (!keyed.has(key) || id === key) keyed.set(key, contact);
    }
    const stale = [...contacts.keys()].some((id) => !isKey(id));

    const writePrivate = (written: ReadonlyMap<string, CommentContact>): void => {
      writeFileAtomicallySync(privateFile, contactsJson(written), {
        mode: COMMENT_EMAILS_FILE_MODE,
      });
    };
    if (changed) {
      if (stale) writePrivate(new Map([...contacts, ...keyed]));
      writeFileAtomicallySync(
        file,
        `${JSON.stringify({ ...parsed, comments: rekeyed }, null, 2)}\n`,
      );
    }
    if (stale) writePrivate(keyed);
  }

  return { comments: keys.size };
}

/**
 * Text with every old comment page and anchor in it naming the comment by its
 * key. The longest ids go first, so an id that begins another cannot take a
 * piece of it.
 */
function renamer(keys: ReadonlyMap<string, string>): (text: string) => string {
  const swaps = [...keys]
    .sort(([left], [right]) => right.length - left.length)
    .flatMap(([id, key]) => [
      [`${COMMENT_PAGE_PREFIX}${encodeURIComponent(id)}/`, commentPageHref(key)],
      [`#comment-${id}`, `#comment-${key}`],
    ]);
  return (text) => swaps.reduce((said, [from = '', to = '']) => said.replaceAll(from, to), text);
}

/** Every Markdown file under the content directory, rewritten where `renamed` changes it. */
function rewriteDocuments(contentDir: string, renamed: (text: string) => string): void {
  let names: string[];
  try {
    names = readdirSync(contentDir, { recursive: true, encoding: 'utf8' });
  } catch {
    return;
  }
  for (const name of names) {
    if (!/\.(md|markdown)$/i.test(name) || name.split(path.sep).includes('node_modules')) continue;
    const file = path.join(contentDir, name);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const next = renamed(text);
    if (next !== text) writeFileAtomicallySync(file, next);
  }
}

/** A copy of a record without one key, every other key where it was. */
function without(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}
