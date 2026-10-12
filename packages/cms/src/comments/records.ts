import { randomBytes } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  COMMENT_KINDS,
  COMMENT_SOURCES,
  COMMENT_STATUSES,
  importedFields,
  REDACTED_FIELDS,
  rsvpField,
  viaField,
} from '../admin/store.ts';
import type { AdminStore, CommentRecord, PostComment } from '../admin/store.ts';
import type { Document } from '../content/document.ts';
import { slugForPermalink } from '../content/parser.ts';
import { rsvpValue } from '../content/rsvp.ts';
import type { RsvpValue } from '../content/rsvp.ts';
import type { ContentStore } from '../content/store.ts';
import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { nonEmptyStringOrNull } from '../util/forms.ts';
import { isRecord } from '../util/guards.ts';
import { isKey } from '../web/feed-source.ts';

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
 * **The email is not in the file.** Everything under `content/` is published
 * and goes into git, where a removed line stays in history until somebody
 * rewrites it, so a commenter's `author.email` and the `notify` that only
 * means anything beside it live in `data/comments/{slug}.json` instead (mode
 * `0600`), keyed by comment id. A record read here has both merged back in, and
 * a record written here is split again, so nothing outside this module and the
 * boot migrations knows there are two files (TASK-182).
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
 * Named by the post's slug. A slug carrying anything a filename should not is
 * refused rather than sanitised, because two slugs that sanitised to one name
 * would silently share a thread.
 */
export function commentsFile(contentDir: string, slug: string): string {
  return path.join(commentsDirectory(contentDir), `${fileNameOf(slug)}.json`);
}

function fileNameOf(slug: string): string {
  const name = encodeURIComponent(slug);
  if (!SAFE_NAME.test(name)) {
    throw new Error(`"${slug}" is not a slug a comment file can be named after.`);
  }
  return name;
}

function slugOfFileName(name: string): string | undefined {
  try {
    const slug = decodeURIComponent(name);
    return encodeURIComponent(slug) === name && SAFE_NAME.test(name) ? slug : undefined;
  } catch {
    return undefined;
  }
}

const SAFE_NAME = /^[A-Za-z0-9%][A-Za-z0-9._%-]*$/;

/** Where commenters' emails live, relative to the data directory. */
export const COMMENT_EMAILS_DIRECTORY = 'comments';

/** Nobody but the site's own user reads a commenter's email. */
export const COMMENT_EMAILS_FILE_MODE = 0o600;

/**
 * The absolute path of the private file holding one post's commenters' emails:
 * `data/comments/{slug}.json`, beside the post's own file in `content/` but
 * never published with it.
 */
export function commentEmailsFile(dataDir: string, slug: string): string {
  return path.join(dataDir, COMMENT_EMAILS_DIRECTORY, `${fileNameOf(slug)}.json`);
}

/** What `data/` holds about one comment: how to reach whoever wrote it. */
export interface CommentContact {
  email: string;
  notify: boolean;
}

/** A comment as `content/` spells it: everything but the email and `notify`. */
type PublishedComment = Omit<CommentRecord, 'author' | 'notify'> & {
  author: Omit<CommentRecord['author'], 'email'>;
};

/** A {@link CommentRecord} on its way in, before the store has named it. */
export type NewComment = Omit<CommentRecord, 'id'> & {
  /** The post it is on. */
  slug: string;
  /** That post's permalink, which the file records and the feeds link to. */
  permalink: string;
  /** Its key, when a caller has one. Minted when it does not. */
  id?: string | undefined;
};

/** What every writer here needs: the files it owns, and the index over them. */
export interface CommentRecords {
  /** The index the files are rebuilt into. */
  readonly admin: AdminStore;
  /** The content directory the files live under. */
  readonly contentDir: string;
  /** The data directory the commenters' emails live under. */
  readonly dataDir: string;
}

/**
 * One post's comments, as its files say them, oldest first.
 *
 * A missing file is no comments, which is what almost every post has. Unlike
 * `followers.json`, an entry that will not parse is dropped rather than
 * throwing: a comment file is public, in git and editable by hand, and a typo
 * in one post's file should cost that entry rather than take the whole site
 * down on the next boot. Nothing irreplaceable is at stake — a comment that
 * cannot be read is one nobody could have shown either way.
 */
export function readComments(
  records: Pick<CommentRecords, 'contentDir' | 'dataDir'>,
  slug: string,
): CommentRecord[] {
  return readPost(records, slug).comments;
}

/**
 * One post's comments with their emails merged back in.
 *
 * `data/` wins over `content/`. An email still in a comment file is read too,
 * so a site that has not booted since upgrading loses nothing before
 * `migrateCommentEmails` moves it.
 */
function readPost(
  records: Pick<CommentRecords, 'contentDir' | 'dataDir'>,
  slug: string,
): { post: string; comments: CommentRecord[] } {
  const held = fileContents(readFileIfPresentSync(commentsFile(records.contentDir, slug)));
  const contacts = contactsIn(readFileIfPresentSync(commentEmailsFile(records.dataDir, slug)));
  return {
    post: held.post,
    comments: held.comments.map((comment) => {
      const contact = contacts.get(comment.id);
      if (contact === undefined) return comment;
      return {
        ...comment,
        author: { ...comment.author, email: contact.email },
        notify: contact.notify,
      };
    }),
  };
}

/**
 * Write one post's comments: the emails to `data/`, everything else to
 * `content/`. Called inside the lock on the post's comment file, which is the
 * lock on both, because nothing writes the private file but this.
 *
 * `data/` goes first, so a crash between the two writes leaves an email in
 * both places or in `data/` alone, and never in neither.
 */
function writePost(
  records: Pick<CommentRecords, 'contentDir' | 'dataDir'>,
  slug: string,
  permalink: string,
  comments: readonly CommentRecord[],
): void {
  const file = commentsFile(records.contentDir, slug);
  for (const comment of comments) {
    if (!isKey(comment.id)) {
      throw new Error(
        `${file}: comment id "${comment.id}" is not a key of 16 lowercase hex digits.`,
      );
    }
  }

  const contacts = new Map<string, CommentContact>();
  for (const comment of comments) {
    if (comment.author.email !== null) {
      contacts.set(comment.id, { email: comment.author.email, notify: comment.notify });
    }
  }

  const privateFile = commentEmailsFile(records.dataDir, slug);
  if (contacts.size > 0) {
    writeFileAtomicallySync(privateFile, contactsJson(contacts), {
      mode: COMMENT_EMAILS_FILE_MODE,
    });
  } else {
    rmSync(privateFile, { force: true });
  }

  writeFileAtomicallySync(file, commentsJson(permalink, comments.map(publishedEntryOf)));
}

/** The emails a private file holds, by comment id. A damaged file holds none. */
export function contactsIn(source: string | undefined): Map<string, CommentContact> {
  const contacts = new Map<string, CommentContact>();
  if (source === undefined) return contacts;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return contacts;
  }
  if (!isRecord(parsed) || !isRecord(parsed['comments'])) return contacts;

  for (const [id, value] of Object.entries(parsed['comments'])) {
    if (!isRecord(value)) continue;
    const email = nonEmptyStringOrNull(value['email']);
    if (email !== null) contacts.set(id, { email, notify: value['notify'] === true });
  }
  return contacts;
}

/** A private file's contents: indented, newline ended. */
export function contactsJson(contacts: ReadonlyMap<string, CommentContact>): string {
  return `${JSON.stringify({ comments: Object.fromEntries(contacts) }, null, 2)}\n`;
}

/** One post's comment file as the post it names and the comments it holds. */
function fileContents(source: string | undefined): { post: string; comments: CommentRecord[] } {
  if (source === undefined) return { post: '', comments: [] };

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
      url: nonEmptyStringOrNull(author['url']),
      email: nonEmptyStringOrNull(author['email']),
      avatar: nonEmptyStringOrNull(author['avatar']),
    },
    content: {
      markdown: typeof content['markdown'] === 'string' ? content['markdown'] : '',
      html: typeof content['html'] === 'string' ? content['html'] : '',
    },
    submitted: typeof value['submitted'] === 'string' ? value['submitted'] : '',
    addressHash: nonEmptyStringOrNull(value['addressHash']),
    inReplyTo: nonEmptyStringOrNull(value['inReplyTo']),
    url: nonEmptyStringOrNull(value['url']),
    // An entry that does not say means one that never asked: a comment file
    // written before TASK-55 shipped, or edited by hand, has nobody waiting on
    // it, and defaulting the other way would email people who never opted in.
    notify: value['notify'] === true,
    ...redactedIn(value['redacted']),
    ...rsvpField(rsvpValue(value['rsvp'])),
    ...viaField(nonEmptyStringOrNull(value['via'])),
    ...importedFields({
      migrated: value['migrated'] === true,
      origin: nonEmptyStringOrNull(value['origin']),
      user: nonEmptyStringOrNull(value['user']),
      actor: nonEmptyStringOrNull(value['actor']),
    }),
  };
}

/** An entry's `redacted` list, kept only when it names something this version knows. */
function redactedIn(value: unknown): Pick<CommentRecord, 'redacted'> {
  if (!Array.isArray(value)) return {};
  const fields = REDACTED_FIELDS.filter((field) => value.includes(field));
  return fields.length === 0 ? {} : { redacted: fields };
}

/**
 * Record a comment: append it to its post's file and index it.
 *
 * The key is minted here unless the caller brought one, and it is random
 * rather than a counter so two comments written at once on two machines
 * holding the same content directory are never given the same name.
 */
export async function addComment(
  records: CommentRecords,
  comment: NewComment,
): Promise<PostComment> {
  const file = commentsFile(records.contentDir, comment.slug);
  const stored: PostComment = {
    ...commentRecordOf(comment),
    slug: comment.slug,
    permalink: comment.permalink,
  };

  return await withFileLock(file, () => {
    const held = readPost(records, comment.slug).comments;
    writePost(records, comment.slug, comment.permalink, [...held, stored]);
    records.admin.putComment(stored);
    return stored;
  });
}

export async function putComments(
  records: CommentRecords,
  slug: string,
  permalink: string,
  comments: readonly CommentRecord[],
): Promise<void> {
  if (comments.length === 0) return;
  const file = commentsFile(records.contentDir, slug);

  await withFileLock(file, () => {
    const held = readPost(records, slug);
    const post = held.post === '' ? permalink : held.post;
    const next = [...held.comments];
    for (const comment of comments) {
      const at = next.findIndex((entry) => entry.id === comment.id);
      if (at === -1) next.push(comment);
      else next[at] = comment;
    }
    writePost(records, slug, post, next);
    for (const comment of comments) records.admin.putComment({ ...comment, slug, permalink: post });
  });
}

/**
 * Give comments on one post new ids: each one `renames` maps keeps its place
 * under its new id, its email in `data/` follows it, and every reply naming
 * its old id names the new one. Refuses a new id the post already holds.
 */
export async function renameComments(
  records: CommentRecords,
  slug: string,
  renames: ReadonlyMap<string, string>,
): Promise<void> {
  const file = commentsFile(records.contentDir, slug);

  await withFileLock(file, () => {
    const held = readPost(records, slug);
    const ids = new Set(held.comments.map((comment) => comment.id));
    const moved = new Map([...renames].filter(([from, to]) => from !== to && ids.has(from)));
    if (moved.size === 0) return;
    for (const [from, to] of moved) {
      if (ids.has(to)) {
        throw new Error(`${file}: comment "${from}" cannot take id "${to}", which another has.`);
      }
    }

    const changed: CommentRecord[] = [];
    const next = held.comments.map((entry) => {
      const id = moved.get(entry.id) ?? entry.id;
      const inReplyTo =
        entry.inReplyTo === null ? null : (moved.get(entry.inReplyTo) ?? entry.inReplyTo);
      if (id === entry.id && inReplyTo === entry.inReplyTo) return entry;
      const renamed = { ...entry, id, inReplyTo };
      changed.push(renamed);
      return renamed;
    });
    writePost(records, slug, held.post, next);
    for (const from of moved.keys()) records.admin.deleteComment(from);
    for (const comment of changed)
      records.admin.putComment({ ...comment, slug, permalink: held.post });
  });
}

/**
 * Move a stored comment: approve it, mark it spam, put it back, or rewrite
 * what it says.
 *
 * The rewrite is what a webmention needs (TASK-51): a page that links here and
 * is then edited sends its webmention again, and what this site shows should
 * be what that page says now rather than what it said last month. Its id, the
 * post it is on and the source it came from never move, which is what makes it
 * the same comment.
 *
 * Returns the comment as it now stands, or `undefined` when the index has no
 * such comment. The index is what says which post's file to open, which is the
 * one thing an id alone does not carry.
 */
export async function updateComment(
  records: CommentRecords,
  id: string,
  change: Partial<
    Pick<CommentRecord, 'status' | 'content' | 'author' | 'kind' | 'submitted' | 'inReplyTo'>
  > & {
    /** What the comment now says it is going to, or `null` when it no longer says. */
    readonly rsvp?: RsvpValue | null;
    /** The page now carrying it, or `null` once it is sent on its own (TASK-320). */
    readonly via?: string | null;
  },
): Promise<PostComment | undefined> {
  const known = records.admin.getComment(id);
  if (known === undefined) return undefined;

  const file = commentsFile(records.contentDir, known.slug);

  return await withFileLock(file, () => {
    const held = readPost(records, known.slug).comments;
    const at = held.findIndex((entry) => entry.id === id);
    if (at === -1) return undefined;

    const { rsvp, via, ...fields } = change;
    const {
      rsvp: was,
      via: carried,
      ...merged
    }: PostComment = {
      ...known,
      ...(held[at] as CommentRecord),
      ...fields,
    };
    const moved: PostComment = {
      ...merged,
      ...rsvpField(rsvp === undefined ? was : (rsvp ?? undefined)),
      ...viaField(via === undefined ? carried : via),
    };
    writePost(records, known.slug, known.permalink, held.with(at, moved));
    records.admin.putComment(moved);
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
  const known = records.admin.getComment(id);
  if (known === undefined) return false;

  const file = commentsFile(records.contentDir, known.slug);

  return await withFileLock(file, () => {
    const held = readPost(records, known.slug).comments;
    const next = held.filter((entry) => entry.id !== id);
    if (next.length !== held.length) writePost(records, known.slug, known.permalink, next);

    const indexed = records.admin.deleteComment(id);
    return next.length !== held.length || indexed;
  });
}

/**
 * Rewrite one post's comments in place: `change` is shown each entry as the
 * file holds it and answers with the entry it should become, or `undefined`
 * to leave it alone.
 *
 * What the retention sweep and an erasure on request are built on (TASK-135).
 * The read, the change and the write happen inside the file's lock, so a
 * comment arriving or a moderator approving one in the same moment is never
 * written over, and the file is only written when something changed, so a
 * sweep that has nothing to do leaves it untouched. The ids of the entries
 * that changed come back, each already put into the index.
 */
export async function rewriteComments(
  records: CommentRecords,
  slug: string,
  change: (comment: CommentRecord) => CommentRecord | undefined,
): Promise<string[]> {
  const file = commentsFile(records.contentDir, slug);

  return await withFileLock(file, () => {
    const held = readPost(records, slug);
    const changed: PostComment[] = [];
    const next = held.comments.map((entry) => {
      const moved = change(entry);
      if (moved === undefined) return entry;
      changed.push({ ...moved, slug, permalink: held.post });
      return moved;
    });
    if (changed.length === 0) return [];

    writePost(records, slug, held.post, next);
    for (const comment of changed) records.admin.putComment(comment);
    return changed.map((comment) => comment.id);
  });
}

export async function followMovedComments(
  records: CommentRecords,
  store: ContentStore,
  document: Document,
): Promise<void> {
  for (const permalink of document.redirectFrom ?? []) {
    const from = slugForPermalink(permalink);
    if (from !== undefined && from !== document.slug) await follow(records, store, from);
  }
}

export async function followAllMovedComments(
  records: CommentRecords,
  store: ContentStore,
): Promise<void> {
  for (const slug of commentSlugs(records.contentDir)) await follow(records, store, slug);
}

async function follow(records: CommentRecords, store: ContentStore, from: string): Promise<void> {
  const to = permalinkOwner(store, readPost(records, from).post)?.slug;
  if (to === undefined || to === from) return;

  const [first = '', second = ''] = [
    commentsFile(records.contentDir, from),
    commentsFile(records.contentDir, to),
  ].sort();
  await withFileLock(first, () =>
    withFileLock(second, () => {
      followFile(records, store, from);
    }),
  );
}

function followFile(records: CommentRecords, store: ContentStore, from: string): void {
  const left = readPost(records, from);
  const owner = permalinkOwner(store, left.post);
  if (owner === undefined || owner.slug === from) return;

  const held = readPost(records, owner.slug).comments;
  const known = new Set(held.map((comment) => comment.id));
  const merged = [...held, ...left.comments.filter((comment) => !known.has(comment.id))];
  writePost(records, owner.slug, owner.permalink, merged);
  rmSync(commentEmailsFile(records.dataDir, from), { force: true });
  rmSync(commentsFile(records.contentDir, from), { force: true });

  const moved = new Set(left.comments.map((comment) => comment.id));
  for (const comment of merged) {
    if (!moved.has(comment.id)) continue;
    records.admin.putComment({ ...comment, slug: owner.slug, permalink: owner.permalink });
  }
}

/**
 * The document a URL of this site belongs to: the one at it, else the one
 * whose `redirect_from` names it.
 */
export function permalinkOwner(store: ContentStore, permalink: string): Document | undefined {
  if (permalink === '') return undefined;
  return store.getByPermalink(permalink) ?? store.getByFormerPermalink(permalink);
}

/** The slug of every post that has a comment file, in a stable order. */
export function commentSlugs(contentDir: string): string[] {
  return commentFiles(contentDir).flatMap(
    (file) => slugOfFileName(path.basename(file, '.json')) ?? [],
  );
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
  const comments: PostComment[] = [];

  for (const slug of commentSlugs(records.contentDir)) {
    const held = readPost(records, slug);
    for (const entry of held.comments) {
      comments.push({ ...entry, slug, permalink: held.post });
    }
  }

  records.admin.replaceComments(comments);
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
    .filter(
      (name) =>
        name.endsWith('.json') && slugOfFileName(name.slice(0, -'.json'.length)) !== undefined,
    )
    .sort()
    .map((name) => path.join(commentsDirectory(contentDir), name));
}

/** A new comment as the record it becomes, id and all. */
function commentRecordOf(comment: NewComment): CommentRecord {
  return {
    id: comment.id ?? randomBytes(8).toString('hex'),
    source: comment.source,
    kind: comment.kind,
    status: comment.status,
    author: { ...comment.author },
    content: { ...comment.content },
    submitted: comment.submitted,
    addressHash: comment.addressHash,
    inReplyTo: comment.inReplyTo,
    url: comment.url,
    notify: comment.notify,
    ...(comment.redacted === undefined ? {} : { redacted: [...comment.redacted] }),
    ...rsvpField(comment.rsvp),
    ...viaField(comment.via),
    ...importedFields(comment),
  };
}

/**
 * A row as `content/` spells it: the post it is on is the file's, not the
 * entry's, and the email and `notify` are `data/`'s.
 */
function publishedEntryOf(comment: CommentRecord): PublishedComment {
  return {
    id: comment.id,
    source: comment.source,
    kind: comment.kind,
    status: comment.status,
    author: { name: comment.author.name, url: comment.author.url, avatar: comment.author.avatar },
    content: { ...comment.content },
    submitted: comment.submitted,
    addressHash: comment.addressHash,
    inReplyTo: comment.inReplyTo,
    url: comment.url,
    ...(comment.redacted === undefined ? {} : { redacted: [...comment.redacted] }),
    ...rsvpField(comment.rsvp),
    ...viaField(comment.via),
    ...importedFields(comment),
  };
}

/** One post's comments as the file spells them: indented, newline ended. */
function commentsJson(permalink: string, comments: readonly PublishedComment[]): string {
  return `${JSON.stringify({ post: permalink, comments }, null, 2)}\n`;
}

/** A stored enumeration value, or the fallback for one this version does not know. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
