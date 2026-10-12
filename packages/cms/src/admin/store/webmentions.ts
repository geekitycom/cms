import type { DatabaseSync } from 'node:sqlite';

import { countByStatus, inTransaction, nullableText, oneOf } from './rows.ts';

/** How one webmention this site sent to one page ended. */
export const WEBMENTION_SEND_STATUSES = ['sent', 'none', 'failed'] as const;

/**
 * One of {@link WEBMENTION_SEND_STATUSES}.
 *
 * `sent` is an endpoint that accepted the notification. `none` is a page that
 * advertises no endpoint, which is most of the web and is not a failure —
 * recording it is what stops the sender asking the same page again on every
 * edit and what tells a person why nothing went. `failed` is an endpoint that
 * was there and refused, with the reason in the row.
 */
export type WebmentionSendStatus = (typeof WEBMENTION_SEND_STATUSES)[number];

/**
 * How one attempt to tell one page that a post links to it ended.
 *
 * The whole of what SQLite keeps about the webmentions a site has sent, and a
 * cache like every other outcome here (decision-9): the links are in the
 * post's file, so a database thrown away costs the record of how yesterday's
 * notification went and nothing else. One row per (post, target), because the
 * question it answers is "where does this post stand with that page" and a
 * resend moves that answer rather than adding a second one.
 */
export interface SentWebmention {
  /** The post the links were in. */
  readonly slug: string;
  /** The post's absolute URL, which is the `source` that was sent. */
  readonly source: string;
  /** The page that was linked to, which is the `target` that was sent. */
  readonly target: string;
  /** The endpoint it was sent to, or `null` when the target advertised none. */
  readonly endpoint: string | null;
  /** How it went. */
  readonly status: WebmentionSendStatus;
  /** Why it failed, or `null`. */
  readonly error: string | null;
  /** When the attempt was made, as an ISO 8601 instant. */
  readonly attemptedAt: string;
}

/** A {@link SentWebmention} before the store has timed it. */
export type NewSentWebmention = Omit<SentWebmention, 'attemptedAt'> & {
  attemptedAt?: string | undefined;
};

export interface WebmentionStore {
  /**
   * Record how one webmention to one page ended, replacing the previous
   * outcome for that (post, target): the table answers "where does this post
   * stand with that page", which a resend moves rather than adds to.
   */
  recordSentWebmention(sent: NewSentWebmention): SentWebmention;
  /** What one post's links came to, target by target, in target order. */
  listSentWebmentions(slug: string): SentWebmention[];
  /** How many of one post's targets stand at each status. */
  countSentWebmentionsByStatus(slug: string): Record<WebmentionSendStatus, number>;
  /** Every (post, source) the sent webmentions are recorded under. */
  listSentWebmentionSources(): Pick<SentWebmention, 'slug' | 'source'>[];
  /**
   * File what one post sent from one source under another post, as a post
   * whose slug changed is (TASK-332). Where both hold an outcome for one
   * target, the later attempt is the one kept.
   */
  moveSentWebmentions(from: Pick<SentWebmention, 'slug' | 'source'>, to: string): void;
}

export function openWebmentionStore(db: DatabaseSync): WebmentionStore {
  const statements = {
    recordSentWebmention: db.prepare(`
      INSERT INTO webmentions_sent (
        slug, source, target, endpoint, status, error, attempted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (slug, target) DO UPDATE SET
        source = excluded.source,
        endpoint = excluded.endpoint,
        status = excluded.status,
        error = excluded.error,
        attempted_at = excluded.attempted_at
      RETURNING *
    `),
    listSentWebmentions: db.prepare(
      'SELECT * FROM webmentions_sent WHERE slug = ? ORDER BY target',
    ),
    listSentWebmentionSources: db.prepare(
      'SELECT DISTINCT slug, source FROM webmentions_sent ORDER BY slug, source',
    ),
    copySentWebmentions: db.prepare(`
      INSERT INTO webmentions_sent (
        slug, source, target, endpoint, status, error, attempted_at
      )
      SELECT :to, source, target, endpoint, status, error, attempted_at
      FROM webmentions_sent WHERE slug = :slug AND source = :source
      ON CONFLICT (slug, target) DO UPDATE SET
        source = excluded.source,
        endpoint = excluded.endpoint,
        status = excluded.status,
        error = excluded.error,
        attempted_at = excluded.attempted_at
      WHERE excluded.attempted_at > webmentions_sent.attempted_at
    `),
    deleteSentWebmentions: db.prepare(
      'DELETE FROM webmentions_sent WHERE slug = :slug AND source = :source',
    ),
    countSentWebmentionsByStatus: db.prepare(`
      SELECT status, COUNT(*) AS count FROM webmentions_sent WHERE slug = ? GROUP BY status
    `),
  };
  return {
    recordSentWebmention(sent) {
      const row = statements.recordSentWebmention.get(
        sent.slug,
        sent.source,
        sent.target,
        sent.endpoint,
        sent.status,
        sent.error,
        sent.attemptedAt ?? new Date().toISOString(),
      ) as Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new Error(`The webmention to ${sent.target} could not be recorded.`);
      }
      return toSentWebmention(row);
    },

    listSentWebmentions(slug) {
      const rows = statements.listSentWebmentions.all(slug) as Record<string, unknown>[];
      return rows.map(toSentWebmention);
    },

    listSentWebmentionSources() {
      const rows = statements.listSentWebmentionSources.all() as Record<string, unknown>[];
      return rows.map((row) => ({ slug: String(row['slug']), source: String(row['source']) }));
    },

    moveSentWebmentions(from, to) {
      if (from.slug === to) return;
      inTransaction(db, () => {
        statements.copySentWebmentions.run({ ...from, to });
        statements.deleteSentWebmentions.run(from);
      });
    },

    countSentWebmentionsByStatus(slug) {
      const rows = statements.countSentWebmentionsByStatus.all(slug) as Record<string, unknown>[];
      return countByStatus(rows, WEBMENTION_SEND_STATUSES, webmentionSendStatus);
    },
  };
}

function toSentWebmention(row: Record<string, unknown>): SentWebmention {
  return {
    slug: String(row['slug']),
    source: String(row['source']),
    target: String(row['target']),
    endpoint: nullableText(row['endpoint']),
    status: webmentionSendStatus(row['status']),
    error: nullableText(row['error']),
    attemptedAt: String(row['attempted_at']),
  };
}

/** A stored send status, or `failed` for one this version does not know. */
function webmentionSendStatus(value: unknown): WebmentionSendStatus {
  return oneOf(value, WEBMENTION_SEND_STATUSES, 'failed');
}
