import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { COMMENT_KINDS, COMMENT_SOURCES, COMMENT_STATUSES } from '../admin/store.ts';
import type { AdminStore, CommentRecord, CommentStatus, PostComment } from '../admin/store.ts';
import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { hashClientAddress } from '../forms/protection.ts';
import type { CommentChecker, CommentSubmission, CommentVerdict } from './submission.ts';

/**
 * Native comments as the files that hold them, and the one door into them.
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
 *
 * Three things write comments — the form under a post, the webmention endpoint
 * and a moderator's reply on the admin screen — and they all go through
 * {@link intakeComment}, which is the whole of what happens between a proposed
 * comment and a comment existing: the address hashed, the approved-author rule,
 * the {@link CommentChecker}, one verdict-to-status rule, the write, and the
 * message to whoever was waiting to hear. What the callers keep is what is
 * really theirs — parsing a form and its cheap defences, fetching and verifying
 * a source, and knowing who is signed in.
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
      avatar: optionalText(author['avatar']),
    },
    content: {
      markdown: typeof content['markdown'] === 'string' ? content['markdown'] : '',
      html: typeof content['html'] === 'string' ? content['html'] : '',
    },
    submitted: typeof value['submitted'] === 'string' ? value['submitted'] : '',
    addressHash: optionalText(value['addressHash']),
    inReplyTo: optionalText(value['inReplyTo']),
    url: optionalText(value['url']),
    // An entry that does not say means one that never asked: a comment file
    // written before TASK-55 shipped, or edited by hand, has nobody waiting on
    // it, and defaulting the other way would email people who never opted in.
    notify: value['notify'] === true,
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

/** Who is proposing a comment, which is the one thing the rules differ on. */
export type CommentOrigin =
  /** Somebody filled in the form under a post (doc-6). */
  | 'form'
  /** Another page said it links here, and it was verified (doc-7). */
  | 'webmention'
  /** A moderator answered from the admin screen. */
  | 'moderator';

/**
 * A comment as its writer proposes it: everything but the three things the
 * intake decides — its name, where it stands, and where it came from.
 */
export type ProposedComment = Omit<PostComment, 'id' | 'status' | 'addressHash'>;

/**
 * Whoever is told about a comment that has just been written.
 *
 * Structural rather than the notifier's own type, so this module does not have
 * to know how a message is rendered or sent; `CommentNotifier` satisfies it.
 */
export interface CommentNotices {
  /** Something is waiting for a moderator. */
  pending(comment: PostComment): void;
  /** A reply is on the page, so whoever it answers may want to know. */
  replyApproved(reply: PostComment): void;
}

/** What {@link intakeComment} needs around a proposed comment. */
export interface IntakeCommentOptions {
  /** The files it is written into, and the index over them. */
  records: CommentRecords;
  /** Who is proposing it. */
  origin: CommentOrigin;
  /** The comment itself, as its writer proposes it. */
  comment: ProposedComment;
  /**
   * The post, as a checker is told it.
   *
   * The URL is passed rather than derived because the two callers know
   * different truths about it: a form knows the post's permalink against the
   * site's base URL, and a webmention knows the exact target its sender named.
   */
  post?: { title: string; url: string } | undefined;
  /** Where the address salt lives. */
  dataDir: string;
  /** The site's public origin. */
  baseUrl: string;
  /** The checker, when the site named one. */
  checker?: CommentChecker | undefined;
  /** Who to tell, when there is anybody to tell (TASK-55). */
  notices?: CommentNotices | undefined;
  /** Where the submission came from, **unhashed**. Only the checker sees it. */
  address?: string | undefined;
  /** The `User-Agent` it arrived with, for the checker. */
  userAgent?: string | undefined;
  /** The `Referer` it arrived with, for the checker. */
  referrer?: string | undefined;
  /** Where a checker that will not answer is reported. Defaults to `console`. */
  logger?: { warn(message: string): void } | undefined;
}

/** What became of one proposed comment. */
export type CommentIntakeOutcome =
  /**
   * It is in the file. `created` says whether it is new: a page re-sending its
   * webmention rewrites the entry it already made, which is not news.
   */
  | { readonly kind: 'stored'; readonly comment: PostComment; readonly created: boolean }
  /**
   * Nothing was stored, because a checker said to throw it away. `removed`
   * says whether it took a webmention this site was already holding with it.
   */
  | { readonly kind: 'discarded'; readonly removed: boolean }
  /** The entry it was going to rewrite went while this was deciding. */
  | { readonly kind: 'gone' };

/**
 * The one door into `content/_data/comments/`.
 *
 * Everything between a proposed comment and a comment existing happens here,
 * so the form, the webmention endpoint and the admin screen cannot drift into
 * three different answers to the same four questions.
 *
 * **Where the site would put it, before anybody judged it.** A form comment
 * whose name and email together have been approved before is approved again —
 * WordPress's rule, and the whole of the auto-approval decision. A webmention
 * waits, because a page linking here is as much a stranger's words as a form
 * submission is. A moderator's reply is approved, because the person writing it
 * is the person who would have approved it.
 *
 * **What the checker says.** Everything but a moderator's own words goes
 * through {@link CommentChecker}; a checker that is down or throws is no
 * opinion, so a service having a bad afternoon never stops a site taking
 * comments. A moderator's reply is not offered to it at all: a spam service has
 * no say in what the owner of the site says.
 *
 * **The one verdict-to-status rule.**
 *
 * | Verdict   | A new comment                        | A webmention sent again              |
 * | --------- | ------------------------------------ | ------------------------------------ |
 * | `discard` | Nothing is stored.                   | The held entry is deleted.           |
 * | `spam`    | Filed as spam.                       | Filed as spam.                       |
 * | `ham`     | Approved.                            | The moderator's decision stands.     |
 * | `unknown` | Where the site would have put it.    | The moderator's decision stands.     |
 *
 * A source re-sending its webmention must not take an approved mention back
 * into the queue, and must not quietly let a spam one out. A checker that has
 * changed its mind to `spam` is the one thing that moves it, because that is a
 * new fact about the content rather than a repeat of an old one.
 *
 * **Who hears about it.** A new entry that is waiting sends the moderation
 * notice, once. A webmention that was merely rewritten sends nothing — the
 * moderators heard the first time and it has been in the queue ever since —
 * and neither does one that was approved or filed as spam, because neither is
 * waiting for anybody. A new comment that is approved instead tells whoever it
 * answers, when they asked to be told.
 */
export async function intakeComment(options: IntakeCommentOptions): Promise<CommentIntakeOutcome> {
  const { records, origin, comment } = options;

  // What this site would do about it on its own, which is both what a checker
  // is shown and what `unknown` falls back to.
  const proposed: Omit<PostComment, 'id'> = {
    ...comment,
    status: siteStatusFor(origin, records, comment),
    addressHash: hashClientAddress(options.dataDir, options.address),
  };

  const held =
    origin === 'webmention' ? heldWebmention(records, comment.slug, comment.url) : undefined;

  const verdict = origin === 'moderator' ? 'unknown' : await ask(options, proposed);

  if (verdict === 'discard') {
    if (held === undefined) return { kind: 'discarded', removed: false };
    await deleteComment(records, held.id);
    return { kind: 'discarded', removed: true };
  }

  const status = statusFor(verdict, proposed.status, held);

  if (held !== undefined) {
    // Its id, its post and its source never move: that is what makes it the
    // same comment. What the page now says about itself replaces what it said.
    const moved = await updateComment(records, held.id, {
      kind: comment.kind,
      status,
      author: comment.author,
      content: comment.content,
      submitted: comment.submitted,
    });
    return moved === undefined
      ? { kind: 'gone' }
      : { kind: 'stored', comment: moved, created: false };
  }

  const stored = await addComment(records, { ...proposed, status });
  announce(options.notices, stored);
  return { kind: 'stored', comment: stored, created: true };
}

/**
 * The webmention this site already holds from that page, if any.
 *
 * The source URL is a webmention's identity (doc-7), so this is what stops a
 * blog post that is edited and re-sent adding a second entry — and what the
 * endpoint asks before it fetches, so a source that has stopped linking here
 * knows what to take away.
 */
export function heldWebmention(
  records: CommentRecords,
  slug: string,
  source: string | null,
): PostComment | undefined {
  if (source === null || source === '') return undefined;

  return records.admin
    .listCommentsFor(slug)
    .find((comment) => comment.source === 'webmention' && comment.url === source);
}

/** Where this site's own rules put a comment, before a checker has spoken. */
function siteStatusFor(
  origin: CommentOrigin,
  records: CommentRecords,
  comment: ProposedComment,
): CommentStatus {
  if (origin === 'moderator') return 'approved';
  if (origin === 'webmention') return 'pending';
  return records.admin.hasApprovedAuthor(comment.author.name, comment.author.email)
    ? 'approved'
    : 'pending';
}

/** The verdict-to-status rule, in the one place it is written. */
function statusFor(
  verdict: CommentVerdict,
  site: CommentStatus,
  held: PostComment | undefined,
): CommentStatus {
  if (verdict === 'spam') return 'spam';
  if (held !== undefined) return held.status;
  return verdict === 'ham' ? 'approved' : site;
}

/** Ask the checker, if there is one, and treat a broken one as no opinion. */
async function ask(
  options: IntakeCommentOptions,
  comment: Omit<PostComment, 'id'>,
): Promise<CommentVerdict> {
  const checker = options.checker;
  if (checker === undefined) return 'unknown';

  const post = options.post;
  const submission: CommentSubmission = {
    comment,
    post: {
      slug: comment.slug,
      title: post?.title ?? comment.slug,
      url: post?.url ?? absolute(comment.permalink, options.baseUrl),
    },
    address: options.address,
    userAgent: options.userAgent,
    referrer: options.referrer,
    baseUrl: options.baseUrl,
  };

  try {
    return await checker.check(submission);
  } catch (error) {
    // A checker that is down must not stop a site taking comments; the comment
    // falls back to whatever the site's own rules said about it.
    const logger = options.logger ?? console;
    logger.warn(`The comment checker refused to answer: ${messageOf(error)}`);
    return 'unknown';
  }
}

/** Tell whoever was waiting on a comment that has just been written. */
function announce(notices: CommentNotices | undefined, stored: PostComment): void {
  if (notices === undefined) return;

  // Only `pending`: one a checker filed as spam is not waiting for anybody,
  // and one it said to discard was never stored at all.
  if (stored.status === 'pending') notices.pending(stored);
  // A comment the site let straight through is on the page already, so
  // whoever it answers hears about it now rather than at a moderator's hand.
  else if (stored.status === 'approved') notices.replyApproved(stored);
}

/** A site-root path as an absolute URL. */
function absolute(pathname: string, baseUrl: string): string {
  try {
    return new URL(pathname, baseUrl).href;
  } catch {
    return pathname;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  change: Partial<Pick<CommentRecord, 'status' | 'content' | 'author' | 'kind' | 'submitted'>>,
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
    url: comment.url,
    notify: comment.notify,
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
    url: comment.url,
    notify: comment.notify,
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
