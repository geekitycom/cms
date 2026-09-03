import type { Context } from '@fedify/fedify';
import {
  Article,
  Create,
  Delete,
  Hashtag,
  PUBLIC_COLLECTION,
  Source,
  Tombstone,
  Update,
} from '@fedify/vocab';
import { Temporal as TemporalPolyfill } from '@js-temporal/polyfill';

import type { Document } from '../content/document.ts';
import { isPublicDocument } from '../web/documents.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { tagHref } from '../web/routes.ts';
import type { FederationContextData } from './federation.ts';
import { SITE_ACTOR_IDENTIFIER } from './keys.ts';
import { createActivityId, deleteActivityId, updateActivityId } from './paths.ts';

/** The media type an `Article`'s `source` is labelled with. */
export const SOURCE_MEDIA_TYPE = 'text/markdown';

/**
 * Whether a document is one of the objects this site federates.
 *
 * doc-4 federates published posts and nothing else: pages are standing
 * content with no place in a timeline, and a draft or a trashed post is not
 * public at all. This is the one rule, so the object dispatcher, the outbox
 * and the permalink all agree about what exists.
 */
export function isFederatedDocument(document: Document): boolean {
  return document.type === 'post' && isPublicDocument(document);
}

/**
 * One post as the `Article` doc-4 describes.
 *
 * The id comes from the Fedify context rather than from string concatenation,
 * so it stays in step with the path the object dispatcher is registered under,
 * and it is built from the slug rather than from the permalink, so moving a
 * post does not mint a second object. `url` is the permalink, which is the
 * page a human should land on.
 *
 * `source` carries the Markdown the file holds, so a peer that wants to quote
 * or re-render the post has the text rather than only the rendering of it.
 */
export function postArticle(context: Context<FederationContextData>, document: Document): Article {
  const { baseUrl } = context.data.config;

  return new Article({
    id: articleObjectId(context, document),
    url: new URL(absoluteUrl(document.permalink, baseUrl)),
    name: document.title,
    content: document.html,
    source: new Source({ content: document.body, mediaType: SOURCE_MEDIA_TYPE }),
    published: toInstant(document.date) ?? null,
    updated: toInstant(document.updated) ?? null,
    attribution: context.getActorUri(SITE_ACTOR_IDENTIFIER),
    // Public addressing, as a blog post is: anybody may fetch it, and every
    // follower is told about it.
    to: PUBLIC_COLLECTION,
    cc: context.getFollowersUri(SITE_ACTOR_IDENTIFIER),
    tags: document.tags.map(
      (tag) =>
        new Hashtag({
          name: `#${tag}`,
          href: new URL(absoluteUrl(tagHref(tag, 0), baseUrl)),
        }),
    ),
  });
}

/**
 * The `Create` that announces a post: what the outbox lists, and what delivery
 * sends.
 *
 * Its addressing is the article's, because an activity a follower cannot see
 * is an object it will never learn about. The id is a fragment of the
 * article's, so the same post always produces the same activity id.
 */
export function postCreateActivity(
  context: Context<FederationContextData>,
  document: Document,
): Create {
  const article = postArticle(context, document);

  return new Create({
    id: createActivityId(articleObjectId(context, document)),
    actor: context.getActorUri(SITE_ACTOR_IDENTIFIER),
    object: article,
    published: toInstant(document.date) ?? null,
    to: PUBLIC_COLLECTION,
    cc: context.getFollowersUri(SITE_ACTOR_IDENTIFIER),
  });
}

/**
 * The `Update` that announces an edit to a post followers already hold.
 *
 * The whole article goes with it rather than a diff, because that is all
 * ActivityPub offers and all a peer can apply. Its id carries the document's
 * hash, so two edits are two activities and the same edit delivered twice is
 * one; see {@link updateActivityId}.
 */
export function postUpdateActivity(
  context: Context<FederationContextData>,
  document: Document,
): Update {
  const article = postArticle(context, document);

  return new Update({
    id: updateActivityId(articleObjectId(context, document), revisionOf(document)),
    actor: context.getActorUri(SITE_ACTOR_IDENTIFIER),
    object: article,
    published: toInstant(document.updated ?? document.date) ?? null,
    to: PUBLIC_COLLECTION,
    cc: context.getFollowersUri(SITE_ACTOR_IDENTIFIER),
  });
}

/**
 * The `Delete` that withdraws a post: a `Tombstone` where the `Article` was.
 *
 * doc-4 sends this when a post becomes a draft, is trashed or is deleted, and
 * all three look the same from outside — the object is gone and the copy every
 * follower holds should go with it. The `Tombstone` keeps the object's id and
 * says what it used to be, which is what lets a peer that never held the
 * article recognise what it is being told about.
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

  return new Delete({
    id: deleteActivityId(objectId, deleted),
    actor: context.getActorUri(SITE_ACTOR_IDENTIFIER),
    object: new Tombstone({
      id: objectId,
      formerType: Article,
      deleted: toInstant(deleted) ?? null,
    }),
    to: PUBLIC_COLLECTION,
    cc: context.getFollowersUri(SITE_ACTOR_IDENTIFIER),
  });
}

/**
 * A post's ActivityStreams object id: the one written into its front matter if
 * it has been federated, and the one its slug implies if it has not.
 *
 * The stored id is what makes a rename invisible to a follower. Ids are minted
 * from the slug, so a post renamed after it was announced would otherwise
 * become a second object and be delivered as a `Create` all over again; doc-4
 * asks the `activitypub.id` key to prevent exactly that. The object dispatcher
 * resolves a stored id back to its post, so the old URL keeps answering.
 */
export function articleObjectId(context: Context<FederationContextData>, document: Document): URL {
  const stored = document.activitypub?.id;
  if (stored !== undefined && stored !== '') {
    try {
      return new URL(stored);
    } catch {
      // A hand-written `activitypub.id` that is not a URL is not an id. Fall
      // back to the derived one rather than failing the delivery.
    }
  }
  return context.getObjectUri(Article, { slug: document.slug });
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
