import type { DatabaseSync } from 'node:sqlite';

import { rsvpValue } from '../content/rsvp.ts';
import type { RsvpValue } from '../content/rsvp.ts';
import type { ConversationWrite } from './conversation.ts';
import { countByStatus, inTransaction, NO_LIMIT, nullableText, oneOf } from './rows.ts';
import type { ListPageOptions } from './rows.ts';

/** Where a comment came from. */
export const COMMENT_SOURCES = ['comment', 'webmention', 'activitypub'] as const;

/**
 * One of {@link COMMENT_SOURCES}.
 *
 * `comment` is the form under the post. `webmention` is another site's post
 * pointing at this one (TASK-51), which lands in the same file with the same
 * shape and is told apart only by this. `activitypub` is a fediverse reply or
 * reaction a site received before it ran Geekity, brought across by an import:
 * one this site receives itself is logged in the inbox instead.
 */
export type CommentSource = (typeof COMMENT_SOURCES)[number];

/** What a comment is: something written, or a wordless pointer at the post. */
export const COMMENT_KINDS = ['reply', 'like', 'boost', 'mention', 'repost'] as const;

/**
 * One of {@link COMMENT_KINDS}. The same five a conversation knows.
 *
 * `reply`, `like` and `boost` are the fediverse's three. `repost` and
 * `mention` are the webmention vocabulary's two extra: a repost is a boost by
 * another name and is shown with them, and a mention is the one thing neither
 * of the others is — somebody's page pointing at this one without answering
 * it (TASK-51).
 */
export type CommentKind = (typeof COMMENT_KINDS)[number];

/** Where a comment stands with the moderator. */
export const COMMENT_STATUSES = ['pending', 'approved', 'spam'] as const;

/**
 * One of {@link COMMENT_STATUSES}.
 *
 * `pending` is waiting for somebody to look at it, and is the state almost
 * every comment starts in; `approved` is on the page and in the feeds; `spam`
 * is kept rather than deleted, so a checker can be told it was wrong and so a
 * mistake can be undone.
 */
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/** What a comment can have had removed from it for privacy (TASK-135). */
export const REDACTED_FIELDS = ['email', 'addressHash', 'author'] as const;

/**
 * One of {@link REDACTED_FIELDS}.
 *
 * `email` and `addressHash` are what the retention sweep removes once they
 * have outlived the site's periods. `author` is an erasure on request: the
 * name, website, picture and email all went at once.
 */
export type RedactedField = (typeof REDACTED_FIELDS)[number];

/** Who wrote a comment, as much as the site knows. */
export interface CommentAuthor {
  /** The name they gave, which is what the page shows. */
  name: string;
  /** Their website, or `null`. Shown, and marked `nofollow ugc` like any link. */
  url: string | null;
  /**
   * Their email, or `null`. **Never shown**: it is here for the moderator, for
   * the auto-approval rule, and for the spam checker.
   */
  email: string | null;
  /**
   * Their avatar, or `null`.
   *
   * A webmention has one out of the `u-photo` of the source page's `h-card`
   * (TASK-51), and an imported fediverse comment its actor's icon (TASK-338).
   * A form asks for no picture: one it did ask for would be a stranger's file
   * on somebody else's page. The page serves it through the avatar cache.
   */
  avatar: string | null;
}

/** What a comment says, in both the forms the site keeps. */
export interface CommentContent {
  /** What was typed, which is what a person wrote and the source of truth. */
  markdown: string;
  /** {@link CommentContent.markdown} through the restricted profile. */
  html: string;
}

/**
 * One comment, as its post's file under `content/_data/comments/` holds it.
 *
 * The shape is deliberately wider than a form submission. A webmention
 * (TASK-51) is somebody else's post pointing at this one: it has a `url` and no
 * email, it may be a like rather than a reply, and it belongs in the same file
 * and the same thread. So every entry says its `source` and its `kind`, and
 * nothing assumes a person filled in a form.
 */
export interface CommentRecord {
  /** Its name, unique across the site, and what a reply puts in `inReplyTo`. */
  id: string;
  /** Where it came from. */
  source: CommentSource;
  /** What it is. */
  kind: CommentKind;
  /** Where it stands with the moderator. */
  status: CommentStatus;
  /** Who wrote it. */
  author: CommentAuthor;
  /** What it says. */
  content: CommentContent;
  /** When it was submitted, as an ISO 8601 instant. */
  submitted: string;
  /**
   * A salted hash of the address it came from, or `null`.
   *
   * The address itself is not kept: the file is published with the site and
   * goes into git, and an IP address there would be a reader's home written
   * into a public repository. The hash is enough to see that two comments came
   * from one place, which is what a moderator is actually asking.
   */
  addressHash: string | null;
  /** The comment it answers, or `null` for one answering the post itself. */
  inReplyTo: string | null;
  /**
   * Where it lives when it lives somewhere else: the source page of a
   * webmention, and `null` for a comment written on this site.
   *
   * It is what a later webmention from the same page is recognised by, which
   * is how one updates the comment it made before instead of adding a second,
   * and it is where the thread's permalink points for an entry this site did
   * not host.
   */
  url: string | null;
  /**
   * Whether whoever wrote it asked to hear about replies to it (TASK-55).
   *
   * Only ever true for a comment that carries an `author.email`, because there
   * would be nowhere to send it otherwise, and only ever set by somebody
   * ticking the box on the form — a webmention has nobody to ask. What it buys
   * is one message when a reply to this comment is approved, carrying an
   * unsubscribe link that needs no login.
   */
  notify: boolean;
  /**
   * What was removed from it for privacy, in the order {@link REDACTED_FIELDS}
   * lists them, when anything was (TASK-135). Absent rather than empty otherwise, so the files of a site
   * that has never swept stay byte for byte what they were.
   *
   * It is what tells an email that was taken away from one that was never
   * given: an author whose email was removed must not match the auto-approval
   * rule the way an author who gave none does, or anybody typing their name
   * would walk past the queue.
   */
  redacted?: readonly RedactedField[];
  /**
   * What a reply that is an RSVP says (TASK-198): the `p-rsvp` of the page a
   * webmention came from. Absent for every other comment, so the files of a
   * site that has had none stay byte for byte what they were.
   */
  rsvp?: RsvpValue;
  /**
   * The page whose entry carried it, for a webmention reply read out of
   * another webmention's source rather than sent on its own (a salmention,
   * TASK-320). Absent for every other comment.
   */
  via?: string;
  /**
   * Whether it was imported from another system (TASK-336), the word a
   * migrated post uses. It was published before the site came here, so it is
   * shown in its thread and carried by no feed. Absent for every other comment.
   */
  migrated?: true;
  /**
   * The name it has where it was first published, for a migrated comment
   * that has one: a fediverse note or activity id, or a webmention's source.
   * What the feeds call it when a native reply answers it, and what a later
   * delivery of the same thing is recognised by. Absent for every other comment.
   */
  origin?: string;
  /**
   * The site user who wrote it, by username, for a comment written by
   * somebody signed in to the system it was imported from (TASK-337). The
   * thread names them as it names their reply posts. Absent for every other
   * comment.
   */
  user?: string;
  /**
   * The fediverse actor who wrote it, by id, for a migrated fediverse comment
   * whose actor the export named (TASK-338). What tells their like here from
   * the same person's like delivered since, whatever profile page each names.
   * Absent for every other comment.
   */
  actor?: string;
}

/**
 * What a comment brought from the system it was imported from, as a record
 * carries it: each of {@link CommentRecord.migrated}, `origin`, `user` and
 * `actor` present only when set.
 */
export function importedFields(fields: {
  readonly migrated?: boolean | null | undefined;
  readonly origin?: string | null | undefined;
  readonly user?: string | null | undefined;
  readonly actor?: string | null | undefined;
}): Pick<CommentRecord, 'migrated' | 'origin' | 'user' | 'actor'> {
  const { migrated, origin, user, actor } = fields;
  return {
    ...(migrated === true ? { migrated: true } : {}),
    ...(origin ? { origin } : {}),
    ...(user ? { user } : {}),
    ...(actor ? { actor } : {}),
  };
}

/** A comment's {@link CommentRecord.rsvp} as a record carries it: present only when there is one. */
export function rsvpField(rsvp: RsvpValue | undefined): Pick<CommentRecord, 'rsvp'> {
  return rsvp === undefined ? {} : { rsvp };
}

/** A comment's {@link CommentRecord.via} as a record carries it: present only when there is one. */
export function viaField(via: string | null | undefined): Pick<CommentRecord, 'via'> {
  return via === undefined || via === null || via === '' ? {} : { via };
}

/**
 * A {@link CommentRecord} with the post it is on.
 *
 * The file it lives in is named after the post's slug and records the post's
 * permalink, so both are facts of the file rather than of the entry; the index
 * carries them on the row because a query by id has no file to read them from.
 */
export interface PostComment extends CommentRecord {
  /** The post's slug, which names the file the comment lives in. */
  slug: string;
  /** That post's permalink, for the moderation screen and the feeds. */
  permalink: string;
}

export interface CommentCount {
  readonly slug: string;
  readonly source: Exclude<CommentSource, 'activitypub'>;
  readonly count: number;
}

/** How {@link CommentStore.listComments} narrows and pages. */
export interface ListCommentsOptions extends ListPageOptions {
  /** Only comments at this status. Every status when it is not given. */
  status?: CommentStatus | undefined;
}

export interface CommentStore {
  /** One post's comments, oldest first, whatever status they are at. */
  listCommentsFor(slug: string): PostComment[];
  /**
   * Comments across the site, newest first, optionally of one status and one
   * page of them. What the moderation screen and the site-wide feed read.
   */
  listComments(options: ListCommentsOptions): PostComment[];
  listLatestCommentsExceptImportedFediverse(limit: number): PostComment[];
  countApprovedCommentsExceptImportedFediverseSince(since: string): CommentCount[];
  /** One comment by id, or `undefined`. */
  getComment(id: string): PostComment | undefined;
  /** The comments whose `url` is this one, whatever their status (TASK-300). */
  listCommentsAt(url: string): PostComment[];

  /** How many comments stand at each status. What the dashboard shows. */
  countCommentsByStatus(): Record<CommentStatus, number>;
  /**
   * Whether this name and email have had a comment approved before.
   *
   * WordPress's rule, and the whole of the auto-approval decision: somebody a
   * moderator has already let through does not queue again. Both have to
   * match, so a stranger typing a regular's name is still held.
   */
  hasApprovedAuthor(name: string, email: string | null): boolean;
  /** Store a comment, replacing whatever was known about that id. */
  putComment(comment: PostComment): PostComment;
  /** Forget a comment. Returns `false` when there was nothing to forget. */
  deleteComment(id: string): boolean;

  /**
   * Make the comment index say exactly this, in one transaction.
   *
   * What a rebuild from `content/_data/comments/` calls (decision-9): the
   * files are the source, so a row they do not carry is a comment that should
   * not be on the page. Nothing outside a rebuild should reach for it.
   */
  replaceComments(comments: readonly PostComment[]): void;
}

export function openCommentStore(
  db: DatabaseSync,
  written: (change: ConversationWrite) => void,
): CommentStore {
  const statements = {
    listCommentsFor: db.prepare(`
      SELECT * FROM comments WHERE slug = ? ORDER BY submitted_at, id
    `),
    latestComments: db.prepare(`
      SELECT * FROM comments WHERE status != 'spam' AND source != 'activitypub'
      ORDER BY submitted_at DESC, id DESC
      LIMIT ?
    `),
    approvedCommentCounts: db.prepare(`
      SELECT slug, source, COUNT(*) AS count FROM comments
      WHERE status = 'approved' AND source != 'activitypub' AND submitted_at >= ?
      GROUP BY slug, source
    `),
    commentById: db.prepare('SELECT * FROM comments WHERE id = ?'),
    commentsAt: db.prepare('SELECT * FROM comments WHERE url = ? ORDER BY submitted_at'),

    countCommentsByStatus: db.prepare(
      'SELECT status, COUNT(*) AS count FROM comments GROUP BY status',
    ),
    hasApprovedAuthor: db.prepare(`
      SELECT 1 FROM comments
      WHERE status = 'approved' AND author_name = ? AND author_email IS ?
        AND NOT EXISTS (SELECT 1 FROM json_each(comments.redacted) WHERE value = 'email')
      LIMIT 1
    `),
    putComment: db.prepare(`
      INSERT INTO comments (
        id, slug, permalink, source, kind, status,
        author_name, author_url, author_email,
        markdown, html, submitted_at, address_hash, in_reply_to, url, author_avatar, notify,
        redacted, rsvp, via, migrated, origin, user, actor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        slug = excluded.slug,
        permalink = excluded.permalink,
        source = excluded.source,
        kind = excluded.kind,
        status = excluded.status,
        author_name = excluded.author_name,
        author_url = excluded.author_url,
        author_email = excluded.author_email,
        markdown = excluded.markdown,
        html = excluded.html,
        submitted_at = excluded.submitted_at,
        address_hash = excluded.address_hash,
        in_reply_to = excluded.in_reply_to,
        url = excluded.url,
        author_avatar = excluded.author_avatar,
        notify = excluded.notify,
        redacted = excluded.redacted,
        rsvp = excluded.rsvp,
        via = excluded.via,
        migrated = excluded.migrated,
        origin = excluded.origin,
        user = excluded.user,
        actor = excluded.actor
    `),
    deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
    clearComments: db.prepare('DELETE FROM comments'),
  };
  return {
    listCommentsFor(slug) {
      return (statements.listCommentsFor.all(slug) as Record<string, unknown>[]).map(toComment);
    },

    listComments(options = {}) {
      // Prepared here rather than beside the others because the `WHERE` is not
      // fixed: the screen asks for one status and the site-wide feed asks for
      // approved comments across every post.
      const where = options.status === undefined ? '' : 'WHERE status = ?';
      const parameters = options.status === undefined ? [] : [options.status];
      const rows = db
        .prepare(
          `SELECT * FROM comments ${where}
           ORDER BY submitted_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...parameters, options.limit ?? NO_LIMIT, options.offset ?? 0) as Record<
        string,
        unknown
      >[];
      return rows.map(toComment);
    },

    getComment(id) {
      const row = statements.commentById.get(id) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : toComment(row);
    },

    listLatestCommentsExceptImportedFediverse(limit) {
      return (statements.latestComments.all(limit) as Record<string, unknown>[]).map(toComment);
    },

    countApprovedCommentsExceptImportedFediverseSince(since) {
      const rows = statements.approvedCommentCounts.all(since) as Record<string, unknown>[];
      return rows.map((row) => ({
        slug: String(row['slug']),
        source: row['source'] === 'webmention' ? 'webmention' : 'comment',
        count: Number(row['count']),
      }));
    },

    listCommentsAt(url) {
      return (statements.commentsAt.all(url) as Record<string, unknown>[]).map(toComment);
    },

    countCommentsByStatus() {
      const rows = statements.countCommentsByStatus.all() as Record<string, unknown>[];
      return countByStatus(rows, COMMENT_STATUSES, commentStatus);
    },

    hasApprovedAuthor(name, email) {
      // `IS` rather than `=`, so an author who gave no email is matched by the
      // rows that gave none either instead of matching nothing.
      return statements.hasApprovedAuthor.get(name, email) !== undefined;
    },

    putComment(comment) {
      const before = statements.commentById.get(comment.id) as Record<string, unknown> | undefined;
      statements.putComment.run(...commentColumns(comment));
      written({
        kind: 'comment',
        slug: comment.slug,
        id: comment.id,
        approved: comment.status === 'approved' && before?.['status'] !== 'approved',
      });
      return comment;
    },

    deleteComment(id) {
      const row = statements.commentById.get(id) as Record<string, unknown> | undefined;
      const slug = row === undefined ? undefined : String(row['slug']);
      const deleted = statements.deleteComment.run(id).changes > 0;
      if (slug !== undefined) written({ kind: 'comment', slug, id, approved: false });
      return deleted;
    },

    replaceComments(comments) {
      inTransaction(db, () => {
        statements.clearComments.run();
        for (const comment of comments) {
          statements.putComment.run(...commentColumns(comment));
        }
      });
    },
  };
}

function toComment(row: Record<string, unknown>): PostComment {
  return {
    id: String(row['id']),
    slug: String(row['slug']),
    permalink: String(row['permalink']),
    source: oneOf(row['source'], COMMENT_SOURCES, 'comment'),
    kind: oneOf(row['kind'], COMMENT_KINDS, 'reply'),
    status: commentStatus(row['status']),
    author: {
      name: String(row['author_name']),
      url: nullableText(row['author_url']),
      email: nullableText(row['author_email']),
      avatar: nullableText(row['author_avatar']),
    },
    content: { markdown: String(row['markdown']), html: String(row['html']) },
    submitted: String(row['submitted_at']),
    addressHash: nullableText(row['address_hash']),
    inReplyTo: nullableText(row['in_reply_to']),
    url: nullableText(row['url']),
    notify: Number(row['notify'] ?? 0) === 1,
    ...redactedOf(row['redacted']),
    ...rsvpField(rsvpValue(row['rsvp'])),
    ...viaField(nullableText(row['via'])),
    ...importedFields({
      migrated: Number(row['migrated'] ?? 0) === 1,
      origin: nullableText(row['origin']),
      user: nullableText(row['user']),
      actor: nullableText(row['actor']),
    }),
  };
}

/** A comment's {@link CommentRecord.redacted} as its column holds it: JSON, or `NULL`. */
function redactedColumn(redacted: readonly RedactedField[] | undefined): string | null {
  return redacted === undefined || redacted.length === 0 ? null : JSON.stringify(redacted);
}

/** The column read back, as the key a record carries only when something was removed. */
function redactedOf(value: unknown): { redacted?: readonly RedactedField[] } {
  if (typeof value !== 'string') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  const fields = Array.isArray(parsed)
    ? REDACTED_FIELDS.filter((field) => parsed.includes(field))
    : [];
  return fields.length === 0 ? {} : { redacted: fields };
}

/**
 * A stored comment status, or `pending` for one this version does not know.
 *
 * Pending is the safe reading: showing a comment nobody approved is the one
 * mistake a moderation queue cannot make, and the screen is right there for
 * the row.
 */
function commentStatus(value: unknown): CommentStatus {
  return oneOf(value, COMMENT_STATUSES, 'pending');
}

/** A comment as the values of the comments table's columns, in the order `putComment` names them. */
function commentColumns(comment: PostComment): (string | number | null)[] {
  return [
    comment.id,
    comment.slug,
    comment.permalink,
    comment.source,
    comment.kind,
    comment.status,
    comment.author.name,
    comment.author.url,
    comment.author.email,
    comment.content.markdown,
    comment.content.html,
    comment.submitted,
    comment.addressHash,
    comment.inReplyTo,
    comment.url,
    comment.author.avatar,
    comment.notify ? 1 : 0,
    redactedColumn(comment.redacted),
    comment.rsvp ?? null,
    comment.via ?? null,
    comment.migrated === true ? 1 : 0,
    comment.origin ?? null,
    comment.user ?? null,
    comment.actor ?? null,
  ];
}
