/**
 * What a logged inbound activity means as a reply.
 *
 * The inbox keeps every `Create` it is sent whole (doc-4), and a reply is
 * simply one whose object answers something: `inReplyTo` naming a post's
 * ActivityStreams object id. Everything the comments feeds show is read back
 * out of that stored JSON-LD rather than out of columns, so the index can be
 * thrown away and rebuilt from the files TASK-32 writes.
 */

import type { InboxActivity } from '../admin/store.ts';

/** The activity type a reply arrives as. A comment is a note somebody created. */
export const REPLY_ACTIVITY_TYPE = 'Create';

/** One logged reply, as everything that shows a comment wants it. */
export interface Reply {
  /** The note's own id: its name in the fediverse, and the feed item's `guid`. */
  id: string;
  /** Where the note can be read — its `url`, else its id. */
  url: string;
  /** Who wrote it, as a name to show. */
  author: string;
  /** Who wrote it, as an id. */
  actorId: string;
  /**
   * What it says, as the remote server rendered it and *not* sanitised.
   *
   * Sanitising belongs to whatever publishes the reply, so there is one place
   * that has to be right rather than one per caller.
   */
  html: string;
  /** When the note says it was published, or when it arrived if it did not. */
  published: Date;
  /** The object it answers: a post's ActivityStreams id. */
  inReplyTo: string;
}

/**
 * A logged activity as the reply it is, or `undefined` when it is not one.
 *
 * Everything is read back out of the stored JSON-LD rather than out of columns
 * beside it, so what a comment shows survives the index being deleted.
 *
 * `nameFor` is the site's chance to name the author better than the activity
 * can: the actor document is not in the activity, so without it the best
 * available name is the `@user@host` the actor's own URL implies.
 */
export function replyFrom(
  activity: InboxActivity,
  nameFor?: (actorId: string) => string | undefined,
): Reply | undefined {
  if (activity.activityType !== REPLY_ACTIVITY_TYPE) return undefined;

  const object = activityObject(activity.json);
  if (object === undefined) return undefined;

  const inReplyTo = uriOf(object['inReplyTo']);
  const id = uriOf(object['id']) ?? activity.objectId;
  if (inReplyTo === null || id === null) return undefined;

  const actorId = activity.actorId;
  const published = new Date(textOf(object['published']) ?? '');

  return {
    id,
    url: uriOf(object['url']) ?? id,
    author: nameFor?.(actorId) ?? actorHandle(actorId) ?? actorId,
    actorId,
    html: textOf(object['content']) ?? languageText(object['contentMap']) ?? '',
    published: Number.isNaN(published.getTime()) ? new Date(activity.receivedAt) : published,
    inReplyTo,
  };
}

/**
 * `@user@host` for an actor URL, or `undefined` when the URL implies none.
 *
 * A guess, and deliberately so: naming the author properly would mean
 * dereferencing the actor, which is a network round trip per comment shown. A
 * follower the site already knows is named from its stored profile instead,
 * and this is the fallback for everybody else.
 */
export function actorHandle(actorId: string): string | undefined {
  let url: URL;
  try {
    url = new URL(actorId);
  } catch {
    return undefined;
  }

  const last = url.pathname
    .split('/')
    .filter((segment) => segment !== '')
    .pop();
  if (last === undefined || last === '') return undefined;
  return `@${last.replace(/^@/, '')}@${url.host}`;
}

/**
 * What a stored activity replies to, or `null` when it replies to nothing.
 *
 * This is the whole definition of the `in_reply_to` index column: it is
 * derived from the activity and never supplied, so a database rebuilt from the
 * inbox log holds exactly what the live one holds.
 *
 * JSON-LD lets `inReplyTo` be a string, a node object or an array of either,
 * and a compacted activity may carry the object as a bare id instead of
 * inlining it. Anything that is not a single absolute URI is no target.
 */
export function replyTargetOf(json: string): string | null {
  const object = activityObject(json);
  if (object === undefined) return null;
  return uriOf(object['inReplyTo']);
}

/** The inlined object of a stored activity, or `undefined` when there is none. */
function activityObject(json: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // A row whose JSON does not parse is not a reply. It is not anything.
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const object = parsed['object'];
  return isRecord(object) ? object : undefined;
}

/**
 * A JSON-LD value as the one absolute URI it names, or `null`.
 *
 * The three spellings a compacted document may use — a string, `{"id": …}`,
 * and either of those wrapped in an array — all mean the same thing here, and
 * the first of a list is the one that is kept: a note that answers several
 * things is shown under the first one it names.
 */
function uriOf(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = uriOf(item);
      if (found !== null) return found;
    }
    return null;
  }
  // A node object names its subject with `id`; a `Link` — which is how a note
  // often spells its `url` — names its target with `href`.
  if (isRecord(value)) return uriOf(value['id'] ?? value['@id'] ?? value['href']);
  if (typeof value !== 'string') return null;

  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

/** A JSON-LD value as the one string it holds, or `undefined`. */
function textOf(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = textOf(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isRecord(value)) return textOf(value['@value']);
  return typeof value === 'string' ? value : undefined;
}

/**
 * One value out of a language map, which is how a compacted document spells a
 * property that named its language. Which language is not worth choosing: a
 * note is written in one, and the map holds that one.
 */
function languageText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const entry of Object.values(value)) {
    const found = textOf(entry);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
