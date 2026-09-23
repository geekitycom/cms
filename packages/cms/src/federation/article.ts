import type { Context } from '@fedify/fedify';
import {
  Article,
  Create,
  Delete,
  Hashtag,
  Note,
  PUBLIC_COLLECTION,
  Source,
  Tombstone,
  Update,
} from '@fedify/vocab';
import { Temporal as TemporalPolyfill } from '@js-temporal/polyfill';

import { listUsers, primaryUser } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import { readSiteSettings, taxonomyBasesFromSettings } from '../admin/settings.ts';
import type { Document } from '../content/document.ts';
import { postTypeOf, replyTarget } from '../content/post-type.ts';
import type { PostType } from '../content/post-type.ts';
import { htmlToText } from '../content/search.ts';
import { userForAuthor } from '../web/authors.ts';
import { isPublicDocument, postObjectId } from '../web/documents.ts';
import { feedExcerpt } from '../web/feed-item.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { categoryHref, tagHref } from '../web/taxonomy.ts';
import { actorId } from './actor.ts';
import type { FederationContextData } from './federation.ts';
import { createActivityId, deleteActivityId, updateActivityId } from './paths.ts';

/**
 * The user a post is announced by: the one its `author` names, and the site's
 * first account for one that names nobody.
 *
 * decision-14 attributes a post to a person rather than to the site, and
 * `userForAuthor` is the one rule that decides which — a username exactly, a
 * display name only when exactly one person answers to it (TASK-67). The
 * fallback matters because an `author` is free text in a file: a post that
 * names a person who has since been deleted, or names nobody at all, is still
 * a post this site has to be able to announce, and the first account is the
 * only actor that can be chosen without guessing between people.
 *
 * `undefined` only for a site with no accounts, which is one in first-run
 * setup and federates nothing.
 */
export function documentAuthor(
  context: Context<FederationContextData>,
  document: Document,
): User | undefined {
  const { dataDir } = context.data.config;
  return userForAuthor(listUsers(dataDir), document.author) ?? primaryUser(dataDir);
}

/**
 * The actor id and followers collection a post's activities are addressed
 * with, or a thrown error for a site with no accounts.
 *
 * Every activity in this module names the same two URLs, and they have to be
 * the same two: an `Article` attributed to one actor and `cc`'d to another's
 * followers would be a post nobody could place.
 */
function attribution(
  context: Context<FederationContextData>,
  document: Document,
): { actor: URL; followers: URL } {
  const user = documentAuthor(context, document);
  if (user === undefined) {
    throw new Error(
      `The post "${document.slug}" cannot be federated: the site has no accounts, ` +
        'and decision-14 makes a user the actor a post is announced by.',
    );
  }
  return { actor: actorId(context, user), followers: context.getFollowersUri(user.username) };
}

/** The media type an `Article`'s `source` is labelled with. */
export const SOURCE_MEDIA_TYPE = 'text/markdown';

/**
 * Whether a document is one of the objects this site federates.
 *
 * doc-4 federates published posts and nothing else: pages are standing
 * content with no place in a timeline, and a draft, a trashed post or one
 * whose date has not arrived is not public at all. This is the one rule, so
 * the object dispatcher, the outbox and the permalink all agree about what
 * exists.
 */
export function isFederatedDocument(document: Document, now: Date = new Date()): boolean {
  return document.type === 'post' && isPublicDocument(document, now);
}

/** The ActivityStreams object types a post can federate as, by name. */
const OBJECT_TYPES = { Note, Article } as const;

/** The name of an ActivityStreams object type a post can federate as. */
type PostObjectType = keyof typeof OBJECT_TYPES;

/**
 * The object type each discovered post type federates as: the rows of Post
 * Type Discovery's own AS2 mapping (section 6) that this site has post types
 * for. A reply is a `Note` even with a title of its own (decision-18).
 */
const OBJECT_TYPE_OF: Record<PostType, PostObjectType> = {
  reply: 'Note',
  note: 'Note',
  article: 'Article',
};

function isPostObjectType(value: string): value is PostObjectType {
  return Object.hasOwn(OBJECT_TYPES, value);
}

/**
 * The ActivityStreams type a post federates as: the one its front matter
 * names in `activitypub.type`, else the one its discovered post type maps to.
 *
 * A name this site cannot send is logged and ignored rather than refused, as
 * an unusable theme choice is: a typo in one file should not stop the post
 * reaching anybody.
 */
function postObjectType(document: Document): PostObjectType {
  const derived = OBJECT_TYPE_OF[postTypeOf(document)];
  const chosen = document.activitypub?.type;
  if (chosen === undefined || isPostObjectType(chosen)) return chosen ?? derived;

  console.warn(
    `${document.path} names activitypub.type "${chosen}", which is not one of ` +
      `${Object.keys(OBJECT_TYPES).join(', ')}. It is federated as ${derived} instead.`,
  );
  return derived;
}

/**
 * One post as the `Note` or `Article` doc-4 describes, whichever
 * {@link postObjectType} says it is.
 *
 * Its `id` and its `url` are the same URL — the permalink — because
 * decision-13 gives a post one name for both audiences: a browser asking for
 * HTML gets the page, a peer asking for ActivityStreams gets this. The
 * exception is a post whose file already names an `activitypub.id`, which
 * keeps it; see {@link articleObjectId}.
 *
 * The two types are not one object with two labels, because Mastodon reads
 * them differently. An `Article`'s status is built from `name`, `summary` and
 * `url`, and `content` is dropped, so it carries the excerpt the feeds print
 * ({@link feedExcerpt}) as its `summary`. A `Note`'s status is its `content`,
 * `name` is never read and `summary` is shown as a content warning, so a note
 * sends neither and carries its title, when its text does not already start
 * with it, at the top of its `content`.
 *
 * `source` carries the Markdown the file holds, so a peer that wants to quote
 * or re-render the post has the text rather than only the rendering of it.
 *
 * `attributedTo` is the actor of the user the post's `author` names
 * (decision-14), and `cc` is that user's followers: a post belongs to a person
 * on this site, not to the site.
 */
export function postObject(
  context: Context<FederationContextData>,
  document: Document,
): Article | Note {
  const { baseUrl } = context.data.config;
  const { actor, followers } = attribution(context, document);
  // The archives an activity points at are wherever the site currently serves
  // them, which is a setting rather than a constant (TASK-36).
  const bases = taxonomyBasesFromSettings(readSiteSettings(context.data.config.contentDir));

  const inReplyTo = replyTarget(document);
  const common = {
    id: articleObjectId(context, document),
    // On either type, so an activitypub.type override never breaks a thread.
    replyTarget: inReplyTo === undefined ? null : new URL(inReplyTo),
    url: new URL(absoluteUrl(document.permalink, baseUrl)),
    source: new Source({ content: document.body, mediaType: SOURCE_MEDIA_TYPE }),
    published: toInstant(document.date) ?? null,
    updated: toInstant(document.updated) ?? null,
    attribution: actor,
    // Public addressing, as a blog post is: anybody may fetch it, and every
    // follower of its author is told about it.
    to: PUBLIC_COLLECTION,
    cc: followers,
    // Both taxonomies become hashtags: a relay or a search that keys on a
    // hashtag has no reason to care which of the two a term came from, and
    // each one points at the archive the site serves for it.
    tags: [
      ...document.tags.map((tag) => hashtag(tag, tagHref(tag, 0, bases), baseUrl)),
      ...document.categories.map((category) =>
        hashtag(category, categoryHref(category, 0, bases), baseUrl),
      ),
    ],
  };

  if (postObjectType(document) === 'Note') {
    return new Note({ ...common, content: noteContent(document) });
  }

  const summary = feedExcerpt(document);
  return new Article({
    ...common,
    name: document.title === '' ? null : document.title,
    summary: summary === '' ? null : summary,
    content: document.html,
  });
}

/** A note's HTML: its title first when its text does not already open with it. */
function noteContent(document: Document): string {
  const title = document.title.trim();
  if (title === '' || collapse(htmlToText(document.html)).startsWith(collapse(title))) {
    return document.html;
  }
  const heading = `<p>${escapeHtml(title)}</p>`;
  return document.html === '' ? heading : `${heading}\n${document.html}`;
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** One taxonomy term as a `Hashtag` pointing at its archive. */
function hashtag(term: string, href: string, baseUrl: string): Hashtag {
  return new Hashtag({ name: `#${term}`, href: new URL(absoluteUrl(href, baseUrl)) });
}

/**
 * The `Create` that announces a post: what the outbox lists, and what delivery
 * sends.
 *
 * Its addressing is the object's, because an activity a follower cannot see
 * is an object it will never learn about. The id is a fragment of the
 * object's, so the same post always produces the same activity id.
 */
export function postCreateActivity(
  context: Context<FederationContextData>,
  document: Document,
): Create {
  const object = postObject(context, document);
  const { actor, followers } = attribution(context, document);

  return new Create({
    id: createActivityId(articleObjectId(context, document)),
    actor,
    object,
    published: toInstant(document.date) ?? null,
    to: PUBLIC_COLLECTION,
    cc: followers,
  });
}

/**
 * The `Update` that announces an edit to a post followers already hold.
 *
 * The whole object goes with it rather than a diff, because that is all
 * ActivityPub offers and all a peer can apply. Its id carries the document's
 * hash, so two edits are two activities and the same edit delivered twice is
 * one; see {@link updateActivityId}.
 *
 * `revision` overrides that. A resend (decision-9) is asking for a revision
 * the followers have already been offered to be offered again, and an activity
 * id a peer has seen is one it is entitled to drop, so a resend passes the
 * moment instead of the hash. Everything else about the activity is the same,
 * which is what makes a resent `Update` and a saved one the same shape.
 */
export function postUpdateActivity(
  context: Context<FederationContextData>,
  document: Document,
  revision: string = revisionOf(document),
): Update {
  const object = postObject(context, document);
  const { actor, followers } = attribution(context, document);

  return new Update({
    id: updateActivityId(articleObjectId(context, document), revision),
    actor,
    object,
    published: toInstant(document.updated ?? document.date) ?? null,
    to: PUBLIC_COLLECTION,
    cc: followers,
  });
}

/**
 * The `Delete` that withdraws a post: a `Tombstone` where its object was.
 *
 * doc-4 sends this when a post becomes a draft, is trashed or is deleted, and
 * all three look the same from outside — the object is gone and the copy every
 * follower holds should go with it. The `Tombstone` keeps the object's id and
 * says what it used to be, which is what lets a peer that never held the
 * object recognise what it is being told about.
 *
 * The document is the one as it was before it went, because after a delete
 * there is no other.
 */
export function postDeleteActivity(
  context: Context<FederationContextData>,
  document: Document,
  deleted: string,
): Delete {
  const objectId = articleObjectId(context, document);
  const { actor, followers } = attribution(context, document);

  return new Delete({
    id: deleteActivityId(objectId, deleted),
    actor,
    object: new Tombstone({
      id: objectId,
      formerType: OBJECT_TYPES[postObjectType(document)],
      deleted: toInstant(deleted) ?? null,
    }),
    to: PUBLIC_COLLECTION,
    cc: followers,
  });
}

/**
 * A post's ActivityStreams object id, off the Fedify context: its permalink,
 * or the id its file already names (decision-13).
 *
 * A thin wrapper over {@link postObjectId} so everything in this module reads
 * the id the same way and off the same base URL the object's `url` is built
 * on. The rule itself lives in `web/documents.ts`, because the page, the feed
 * item and the object are one identity now rather than three.
 */
export function articleObjectId(context: Context<FederationContextData>, document: Document): URL {
  return new URL(postObjectId(document, context.data.config.baseUrl));
}

/**
 * Which revision of a document an `Update` is announcing.
 *
 * The content hash: it changes with every real edit and with nothing else, so
 * it names the revision without a clock and without a counter to keep.
 */
function revisionOf(document: Document): string {
  return document.hash.slice(0, 16);
}

/**
 * An ISO 8601 date as the `Temporal.Instant` the vocabulary takes, or
 * `undefined` when there is no usable date.
 *
 * The value comes from `@js-temporal/polyfill` because Node does not ship
 * `Temporal` yet, and Fedify recognises a polyfilled instant by its
 * `Symbol.toStringTag` rather than by its class. The cast is the one place
 * that costs: the polyfill's declarations and TypeScript's `esnext.temporal`
 * lib describe the same object with types that are not assignable to one
 * another.
 */
export function toInstant(value: string | undefined): Temporal.Instant | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return TemporalPolyfill.Instant.fromEpochMilliseconds(
    date.getTime(),
  ) as unknown as Temporal.Instant;
}
