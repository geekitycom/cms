import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { COMMENT_KINDS, COMMENT_SOURCES, COMMENT_STATUSES } from '../admin/store.ts';
import type { AdminStore, CommentRecord, PostComment } from '../admin/store.ts';
import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';

/**
 * Native comments as the files that hold them.
 *
 * decision-9 makes the filesystem the source of truth for everything durable,
 * and a comment somebody typed into this site is exactly that: nothing else
 * holds it, and no other server can be asked for it again. So it lives under
 * `content/_data/comments/`, one JSON file per post, which puts it in git
 * beside the posts, hands it to an Eleventy build of the same directory, and
 * leaves SQLite holding nothing but an index — one rebuilt from these files on
 * every boot and deletable at rest.
 *
 * The two rules `federation/records.ts` follows apply here for the same
 * reasons, and are why every writer in this module goes through
 * {@link withFileLock}:
 *
 * - **The file first, the index inside the same step.** Two comments arriving
 *   at once cannot leave the index saying something the file does not.
 * - **The index is derived, never told.** A row is built from a file entry by
 *   {@link commentFrom} whether it is being written for the first time or
 *   rebuilt at boot.
 *
 * The entry shape is deliberately wider than a form submission. A webmention
 * (TASK-51) is somebody else's post pointing at this one: it has a `url` and no
 * email, it may be a like rather than a reply, and it belongs in the same file
 * and the same thread. So every entry says its `source` and its `kind`, and
 * nothing here assumes a person filled in a form.
 */

/** Where the comment files live, relative to the content directory. */
export const COMMENTS_DATA_DIRECTORY = '_data/comments';

/** The absolute path of one site's `content/_data/comments`. */
export function commentsDirectory(contentDir: string): string {
  return path.join(contentDir, ...COMMENTS_DATA_DIRECTORY.split('/'));
}

/**
 * The absolute path of one post's comment file.
 *
 * Named by the post's slug, which is what a post keeps for its whole life: the
 * editor gives an existing document the slug it already has, so the file that
 * holds a post's comments never has to move. A slug carrying anything a
 * filename should not is refused rather than sanitised, because two slugs that
 * sanitised to one name would silently share a thread.
 */
export function commentsFile(contentDir: string, slug: string): string {
  if (!SAFE_SLUG.test(slug)) {
    throw new Error(`"${slug}" is not a slug a comment file can be named after.`);
  }
  return path.join(commentsDirectory(contentDir), `${slug}.json`);
}

/** Slugs a file may be named after: what {@link slugify} produces, and no more. */
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A {@link CommentRecord} on its way in, before the store has named it. */
export type NewComment = Omit<CommentRecord, 'id'> & {
  /** The post it is on. */
  slug: string;
  /** That post's permalink, which the file records and the feeds link to. */
  permalink: string;
  /** Its id, when a caller has one. Minted when it does not. */
  id?: string | undefined;
};

/** What every writer here needs: the files it owns, and the index over them. */
export interface CommentRecords {
  /** The index the files are rebuilt into. */
  readonly admin: AdminStore;
  /** The content directory the files live under. */
  readonly contentDir: string;
}

/**
 * One post's comments, as its file says them, oldest first.
 *
 * A missing file is no comments, which is what almost every post has. Unlike
 * `followers.json`, an entry that will not parse is dropped rather than
 * throwing: a comment file is public, in git and editable by hand, and a typo
 * in one post's file should cost that entry rather than take the whole site
 * down on the next boot. Nothing irreplaceable is at stake — a comment that
 * cannot be read is one nobody could have shown either way.
 */
export function readComments(contentDir: string, slug: string): CommentRecord[] {
  const source = readFileIfPresentSync(commentsFile(contentDir, slug));
  if (source === undefined) return [];

  return commentsIn(source);
}

/** One post's comment file as the post it names and the comments it holds. */
function fileContents(source: string): { post: string; comments: CommentRecord[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { post: '', comments: [] };
  }
  if (!isRecord(parsed)) return { post: '', comments: [] };

  const entries = parsed['comments'];
  return {
    post: typeof parsed['post'] === 'string' ? parsed['post'] : '',
    comments: Array.isArray(entries)
      ? entries.map(commentFrom).filter((entry) => entry !== undefined)
      : [],
  };
}

/** Just the comments, for the readers that have the post already. */
function commentsIn(source: string): CommentRecord[] {
  return fileContents(source).comments;
}

/**
 * One file entry as the record it is, or `undefined` when it is not one.
 *
 * An entry needs an id and a name and nothing else: everything a hand-written
 * file leaves out gets the value that means "the site was not told", so a
 * template printing it has something to print. An entry with no id is refused,
 * because an id is what a reply names and what a moderation action moves.
 */
function commentFrom(value: unknown): CommentRecord | undefined {
  if (!isRecord(value)) return undefined;

  const id = value['id'];
  if (typeof id !== 'string' || id === '') return undefined;

  const author = isRecord(value['author']) ? value['author'] : {};
  const content = isRecord(value['content']) ? value['content'] : {};
  const name = typeof author['name'] === 'string' ? author['name'] : '';
  if (name === '') return undefined;

  return {
    id,
    source: oneOf(value['source'], COMMENT_SOURCES, 'comment'),
    kind: oneOf(value['kind'], COMMENT_KINDS, 'reply'),
    // An entry that does not say where it stands is waiting: showing something
    // nobody approved would be the one mistake this cannot make.
    status: oneOf(value['status'], COMMENT_STATUSES, 'pending'),
    author: {
      name,
      url: optionalText(author['url']),
      email: optionalText(author['email']),
    },
    content: {
      markdown: typeof content['markdown'] === 'string' ? content['markdown'] : '',
      html: typeof content['html'] === 'string' ? content['html'] : '',
    },
    submitted: typeof value['submitted'] === 'string' ? value['submitted'] : '',
    addressHash: optionalText(value['addressHash']),
    inReplyTo: optionalText(value['inReplyTo']),
  };
}

/**
 * Record a comment: append it to its post's file and index it.
 *
 * The id is minted here unless the caller brought one, and it is a UUID rather
 * than a counter so two comments written at once on two machines holding the
 * same content directory can never be given the same name.
 */
export async function addComment(
  records: CommentRecords,
  comment: NewComment,
): Promise<PostComment> {
  const { admin, contentDir } = records;
  const file = commentsFile(contentDir, comment.slug);
  const stored: PostComment = {
    ...commentRecordOf(comment),
    slug: comment.slug,
    permalink: comment.permalink,
  };

  return await withFileLock(file, () => {
    const held = readCommentFile(file);
    writeFileAtomicallySync(file, commentsJson(comment.permalink, [...held, entryOf(stored)]));
    admin.putComment(stored);
    return stored;
  });
}

/**
 * Move a stored comment: approve it, mark it spam, put it back.
 *
 * Returns the comment as it now stands, or `undefined` when the index has no
 * such comment. The index is what says which post's file to open, which is the
 * one thing an id alone does not carry.
 */
export async function updateComment(
  records: CommentRecords,
  id: string,
  change: Partial<Pick<CommentRecord, 'status' | 'content' | 'author'>>,
): Promise<PostComment | undefined> {
  const { admin, contentDir } = records;
  const known = admin.getComment(id);
  if (known === undefined) return undefined;

  const file = commentsFile(contentDir, known.slug);

  return await withFileLock(file, () => {
    const held = readCommentFile(file);
    const at = held.findIndex((entry) => entry.id === id);
    if (at === -1) return undefined;

    const moved: PostComment = { ...known, ...(held[at] as CommentRecord), ...change };
    writeFileAtomicallySync(file, commentsJson(known.permalink, held.with(at, entryOf(moved))));
    admin.putComment(moved);
    return moved;
  });
}

/**
 * Forget a comment altogether.
 *
 * Returns whether there was anything to forget. The index is emptied of the id
 * whether or not the file held it, so a row left over from a file somebody
 * edited by hand cannot go on being shown.
 */
export async function deleteComment(records: CommentRecords, id: string): Promise<boolean> {
  const { admin, contentDir } = records;
  const known = admin.getComment(id);
  if (known === undefined) return false;

  const file = commentsFile(contentDir, known.slug);

  return await withFileLock(file, () => {
    const held = readCommentFile(file);
    const next = held.filter((entry) => entry.id !== id);
    if (next.length !== held.length) {
      writeFileAtomicallySync(file, commentsJson(known.permalink, next));
    }

    const indexed = admin.deleteComment(id);
    return next.length !== held.length || indexed;
  });
}

/** What a rebuild put in the index. */
export interface CommentIndexReport {
  /** How many comments the files held. */
  comments: number;
}

/**
 * Rebuild the comment index from the files.
 *
 * This is what makes `data/geekity.db` disposable for comments (decision-9):
 * the table holds nothing but what these files say, so every boot throws away
 * what it holds and reads them again. Editing a comment file by hand and
 * restarting is therefore a supported thing to do, and a database deleted at
 * rest costs a site nothing.
 *
 * Exported so `geekity rebuild` can call the very function boot calls, and
 * synchronous because both callers are.
 */
export function rebuildCommentIndexes(records: CommentRecords): CommentIndexReport {
  const { admin, contentDir } = records;
  const comments: PostComment[] = [];

  for (const file of commentFiles(contentDir)) {
    const source = readFileIfPresentSync(file);
    if (source === undefined) continue;

    const slug = path.basename(file, '.json');
    const held = fileContents(source);
    for (const entry of held.comments) {
      comments.push({ ...entry, slug, permalink: held.post });
    }
  }

  admin.replaceComments(comments);
  return { comments: comments.length };
}

/** Every comment file a site has, in a stable order. */
function commentFiles(contentDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(commentsDirectory(contentDir));
  } catch {
    // No directory is no comments, which is what a site nobody has answered
    // has. Every other way this can fail fails again on the next boot.
    return [];
  }

  return entries
    .filter((name) => name.endsWith('.json') && SAFE_SLUG.test(name.slice(0, -'.json'.length)))
    .sort()
    .map((name) => path.join(commentsDirectory(contentDir), name));
}

/** One file's comments, read inside a lock the caller already holds. */
function readCommentFile(file: string): CommentRecord[] {
  const source = readFileIfPresentSync(file);
  return source === undefined ? [] : commentsIn(source);
}

/** A new comment as the record it becomes, id and all. */
function commentRecordOf(comment: NewComment): CommentRecord {
  return {
    id: comment.id ?? randomUUID(),
    source: comment.source,
    kind: comment.kind,
    status: comment.status,
    author: { ...comment.author },
    content: { ...comment.content },
    submitted: comment.submitted,
    addressHash: comment.addressHash,
    inReplyTo: comment.inReplyTo,
  };
}

/** A row as the file spells it: the post it is on is the file's, not the entry's. */
function entryOf(comment: PostComment): CommentRecord {
  return {
    id: comment.id,
    source: comment.source,
    kind: comment.kind,
    status: comment.status,
    author: { ...comment.author },
    content: { ...comment.content },
    submitted: comment.submitted,
    addressHash: comment.addressHash,
    inReplyTo: comment.inReplyTo,
  };
}

/** One post's comments as the file spells them: indented, newline ended. */
function commentsJson(permalink: string, comments: readonly CommentRecord[]): string {
  return `${JSON.stringify({ post: permalink, comments }, null, 2)}\n`;
}

/** A value the file may have left out, as the text it holds or `null`. */
function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** A stored enumeration value, or the fallback for one this version does not know. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
