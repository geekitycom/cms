import type { ActivityPubMetadata, Document, DocumentType } from '../document.ts';
import { feedGuid, postObjectId, repliesKey } from '../guids.ts';
import { dateSortKey, isTrashedPath } from '../store.ts';
import { stringOrUndefined } from './database.ts';
import type { Row } from './database.ts';

/** A {@link Document} as the columns of the `documents` table. */
export function toRow(document: Document): Record<string, string | number | null> {
  return {
    path: document.path,
    type: document.type,
    slug: document.slug,
    permalink: document.permalink,
    title: document.title,
    date: document.date ?? null,
    date_sort: dateSortKey(document.date),
    updated: document.updated ?? null,
    draft: document.draft ? 1 : 0,
    trashed: isTrashedPath(document.path) ? 1 : 0,
    description: document.description ?? null,
    author: document.author ?? null,
    in_reply_to: document.inReplyTo ?? null,
    activitypub: document.activitypub === undefined ? null : JSON.stringify(document.activitypub),
    extra: JSON.stringify(document.extra),
    body: document.body,
    html: document.html,
    hash: document.hash,
  };
}

/**
 * A row back into a {@link Document}.
 *
 * Optional fields are left off entirely when the column is NULL, so a document
 * that went through the index deep-equals the one that was parsed from the file.
 */
export function toDocument(row: Row, tags: string[], categories: string[]): Document {
  return {
    type: String(row['type']) as DocumentType,
    path: String(row['path']),
    slug: String(row['slug']),
    permalink: String(row['permalink']),
    title: String(row['title']),
    ...optional('date', stringOrUndefined(row['date'])),
    ...optional('updated', stringOrUndefined(row['updated'])),
    tags,
    categories,
    draft: row['draft'] === 1,
    ...optional('description', stringOrUndefined(row['description'])),
    ...optional('author', stringOrUndefined(row['author'])),
    ...optional('inReplyTo', stringOrUndefined(row['in_reply_to'])),
    ...optional('activitypub', json<ActivityPubMetadata>(row['activitypub'])),
    extra: json<Record<string, unknown>>(row['extra']) ?? {},
    body: String(row['body']),
    html: String(row['html']),
    hash: String(row['hash']),
  };
}

/**
 * The `/replies/` keys of a document (TASK-327): its feed guid's, and for a
 * reply post its object id's, which is what it is named by in the thread it
 * answers. The two differ only for a reply post with a stored `guid`. Both are
 * worked out against `baseUrl`, which is recorded beside them so a change of
 * site URL is noticed on the next open; with no base there are no keys.
 */
export function repliesKeysOf(
  document: Document,
  baseUrl: string | undefined,
): Record<'replies_key' | 'reply_post_key' | 'keys_base', string | null> {
  if (baseUrl === undefined) return { replies_key: null, reply_post_key: null, keys_base: null };
  const isReplyPost = document.type === 'post' && document.inReplyTo !== undefined;
  return {
    replies_key: repliesKey(feedGuid(document, baseUrl)),
    reply_post_key: isReplyPost ? repliesKey(postObjectId(document, baseUrl)) : null,
    keys_base: baseUrl,
  };
}

/** Rows of a side table grouped by the document they belong to, in row order. */
export function groupByPath(rows: Row[], value: (row: Row) => string): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const contentPath = String(row['path']);
    const values = grouped.get(contentPath);
    if (values === undefined) grouped.set(contentPath, [value(row)]);
    else values.push(value(row));
  }
  return grouped;
}

function json<T>(value: unknown): T | undefined {
  if (typeof value !== 'string') return undefined;
  return JSON.parse(value) as T;
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
