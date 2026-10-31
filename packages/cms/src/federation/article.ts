import type { Context } from '@fedify/fedify';
import {
  Add,
  Article,
  Audio,
  Create,
  Delete,
  Event,
  Hashtag,
  Image,
  InteractionPolicy,
  InteractionRule,
  LanguageString,
  Mention,
  Note,
  Place,
  PUBLIC_COLLECTION,
  Remove,
  Source,
  Tombstone,
  Update,
  Video,
} from '@fedify/vocab';
import { Temporal as TemporalPolyfill } from '@js-temporal/polyfill';
import path from 'node:path';

import { CITATION_VERBS, citationsOf, citedPageName } from '../content/citation.ts';
import type { CitedPageReader } from '../content/citation.ts';
import { reviewHtml, reviewOf } from '../content/review.ts';
import type { Review } from '../content/review.ts';
import { RSVP_PHRASES, rsvpOf } from '../content/rsvp.ts';
import type { Document } from '../content/document.ts';
import { eventOf } from '../content/event.ts';
import type { PostEvent } from '../content/event.ts';
import { enclosureOf, isUploadUrl, playsAsVideo } from '../content/enclosure.ts';
import { photoAlt, photosOf } from '../content/photo.ts';
import { placeWordList, shareLocation } from '../content/location.ts';
import type { SharedLocation } from '../content/location.ts';
import { postLocations } from '../content/locations.ts';
import { canonicalType, UPLOAD_MEDIA_TYPES } from '../files/upload-types.ts';
import { readAltTexts } from '../content/alt-text.ts';
import type { AltTextLibrary } from '../content/alt-text.ts';
import { imagesIn, uploadPath } from '../content/image-tags.ts';
import type { DocumentLookup } from '../content/store.ts';
import type { ResolvedConfig } from '../config.ts';
import { postLabel, postTypeOf, replyTarget } from '../content/post-type.ts';
import type { PostType } from '../content/post-type.ts';
import { htmlToText } from '../content/search.ts';
import { respellTags } from '../content/tags.ts';
import { visibilityOf } from '../content/visibility.ts';
import { permalinkBasesFromSettings } from '../site/settings.ts';
import { listUsers, primaryUser } from '../site/users.ts';
import type { User } from '../site/users.ts';
import { escapeAttribute, escapeText } from '../util/html.ts';
import { absoluteHtmlUrls } from '../util/absolute-urls.ts';
import { absoluteUrl } from '../util/url.ts';
import { userForAuthor } from '../content/authors.ts';
import { permalinkOfObjectId } from '../content/permalinks.ts';
import { postObjectId } from '../content/guids.ts';
import { feedExcerpt } from '../content/excerpt.ts';
import { canonicalLocale, DEFAULT_LOCALE, documentLanguage } from '../content/locale.ts';
import { categoryHref, tagHref } from '../content/taxonomy.ts';
import { actorId } from './actor.ts';
import type { CitedObject } from './citations.ts';
import type { FederationContextData } from './federation.ts';
import { mentionedAccounts } from './handles.ts';
import type { MentionedAccount } from './handles.ts';
import { currentObjectId, isObjectIdOf, naturalObjectId, readObjectIds } from './object-ids.ts';
import { createActivityId, deleteActivityId, pinActivityId, updateActivityId } from './paths.ts';
import { resolvedReplyTarget } from './reply-targets.ts';

/**
 * The user a post is announced by: the one its `author` names, and the site's
 * first account for one that names nobody.
 *
 * A post is attributed to a person rather than to the site, and
 * `userForAuthor` is the one rule that decides which — a username exactly, a
 * display name only when exactly one person answers to it. The
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

/**
 * Who a post, its `Create` and its `Update` are addressed to. A public post is
 * to Public with its author's followers in `cc`; an unlisted one swaps the
 * two, which is how Mastodon marks a post anybody may fetch but that stays off
 * public timelines.
 */
function addressing(
  document: Document,
  followers: URL,
  replyTo: CitedObject | undefined,
  mentioned: readonly MentionedAccount[],
): { tos: URL[]; ccs: URL[] } {
  const ids = new Set<string>();
  const author = replyTo?.author?.id;
  if (author != null) ids.add(author.href);
  for (const { account } of mentioned) ids.add(account.actor);
  const also = [...ids].map((id) => new URL(id));
  return visibilityOf(document) === 'unlisted'
    ? { tos: [followers], ccs: [PUBLIC_COLLECTION, ...also] }
    : { tos: [PUBLIC_COLLECTION], ccs: [followers, ...also] };
}

/**
 * A `Mention` of the author a reply answers and of each account the post names
 * by handle, which is what makes Mastodon notify them.
 */
function mentions(
  replyTo: CitedObject | undefined,
  mentioned: readonly MentionedAccount[],
): Mention[] {
  const found: Mention[] = [];
  const named = new Set<string>();
  const author = replyTo?.author;
  if (author?.id != null) {
    const username = author.preferredUsername?.toString();
    named.add(author.id.href);
    found.push(
      new Mention({
        href: author.id,
        name: username === undefined ? null : `@${username}@${author.id.host}`,
      }),
    );
  }
  for (const { handle, account } of mentioned) {
    if (named.has(account.actor)) continue;
    named.add(account.actor);
    found.push(new Mention({ href: new URL(account.actor), name: `@${handle}` }));
  }
  return found;
}

/** The media type an `Article`'s `source` is labelled with. */
export const SOURCE_MEDIA_TYPE = 'text/markdown';

/**
 * The post an ActivityStreams object id names, federated or not.
 *
 * Either the post whose file stores that id, or the one at the permalink the
 * id spells — and then only when that post's id really is this URL, so a
 * migrated post is not found a second time under its permalink. A revision of
 * either names the post only when the post was federated under it: a like of
 * `?v=7` is about nothing here when the post has only ever been `?v=2`.
 */
export function postByObjectId(
  store: DocumentLookup,
  objectId: string,
  { baseUrl, contentDir }: Pick<ResolvedConfig, 'baseUrl' | 'contentDir'>,
): Document | undefined {
  const natural = naturalObjectId(objectId);
  const permalink = permalinkOfObjectId(natural, baseUrl);
  const document =
    store.getByStoredObjectId(natural) ??
    (permalink === undefined ? undefined : store.getByPermalink(permalink));
  if (document?.type !== 'post' || postObjectId(document, baseUrl) !== natural) return undefined;
  return isObjectIdOf(readObjectIds(contentDir), natural, objectId) ? document : undefined;
}

/** The ActivityStreams object types a post can federate as, by name. */
const OBJECT_TYPES = { Note, Article, Event } as const;

/** The name of an ActivityStreams object type a post can federate as. */
type PostObjectType = keyof typeof OBJECT_TYPES;

/**
 * The object type each discovered post type federates as: the rows of Post
 * Type Discovery's own AS2 mapping (section 6) that this site has post types
 * for. A reply is a `Note` even with a title of its own, and so
 * is a photo post, whose photos are its attachments.
 */
const OBJECT_TYPE_OF: Record<PostType, PostObjectType> = {
  event: 'Event',
  // A like or a repost of a fediverse object goes as a `Like` or an
  // `Announce` instead; this is the object its permalink serves.
  rsvp: 'Note',
  repost: 'Note',
  like: 'Note',
  bookmark: 'Note',
  reply: 'Note',
  review: 'Note',
  photo: 'Note',
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
 * One post as the `Note`, `Article` or `Event` it federates as, whichever
 * {@link postObjectType} says it is.
 *
 * Its `id` and its `url` are the same URL — the permalink — because a post
 * has one name for both audiences: a browser asking for
 * HTML gets the page, a peer asking for ActivityStreams gets this. The
 * exception is a post whose file already names an `activitypub.id`, which
 * keeps it; see {@link articleObjectId}.
 *
 * The two types are not one object with two labels, because Mastodon reads
 * them differently. An `Article`'s status is built from `name`, `summary` and
 * `url`, and `content` is dropped, so it carries the excerpt the feeds print
 * ({@link feedExcerpt}), escaped, as its `summary`, which is HTML. A `Note`'s
 * status is its `content`, `name` is never read and `summary` is shown as a
 * content warning, so a note sends neither and carries its title, when its
 * text does not already start with it, at the top of its `content`.
 *
 * `source` carries the Markdown the file holds, so a peer that wants to quote
 * or re-render the post has the text rather than only the rendering of it.
 *
 * `attributedTo` is the actor of the user the post's `author` names,
 * and `cc` is that user's followers: a post belongs to a person
 * on this site, not to the site.
 */
export function postObject(
  context: Context<FederationContextData>,
  document: Document,
  replyTo?: CitedObject,
): Article | Note | Event {
  const { baseUrl } = context.data.config;
  const { actor, followers } = attribution(context, document);
  // The archives an activity points at are wherever the site currently serves
  // them, which is a setting rather than a constant.
  const settings = context.data.site;
  const bases = permalinkBasesFromSettings(settings);
  // The language a client filters and translates the post by: its own, else
  // the site's.
  const language =
    documentLanguage(document) ?? canonicalLocale(settings.language) ?? DEFAULT_LOCALE;

  const siteSpelledTags = respellTags(document.tags, (tag) =>
    context.data.store.tagSpelling(tag),
  ).tags;
  const inReplyTo = replyTarget(document);
  const mentioned = mentionedAccounts(document.body, context.data.config.contentDir);
  let library: AltTextLibrary | undefined;
  const altTexts = (): AltTextLibrary => (library ??= readAltTexts(context.data.config.contentDir));
  const review = reviewOf(document.extra);
  const permalink = absoluteUrl(document.permalink, baseUrl);
  // Mastodon drops a link whose href is not absolute, and a wiki link is
  // always written root-relative.
  const html = absoluteHtmlUrls(document.html, permalink, baseUrl);
  const common = {
    id: articleObjectId(context, document),
    // On either type, so an activitypub.type override never breaks a thread.
    replyTarget:
      replyTo?.id ?? (inReplyTo === undefined ? null : replyTargetId(context, inReplyTo)),
    url: new URL(permalink),
    source: new Source({ content: document.body, mediaType: SOURCE_MEDIA_TYPE }),
    published: toInstant(document.date) ?? null,
    updated: toInstant(document.updated) ?? null,
    attribution: actor,
    ...addressing(document, followers, replyTo, mentioned),
    // FEP-044f: a post with no policy is one Mastodon lets nobody quote. Every
    // post that federates names Public, so anybody may quote it, and
    // the inbox approves each QuoteRequest on the same rule.
    interactionPolicy: QUOTABLE_BY_ANYONE,
    attachments: [
      ...recordingAttachment(document, baseUrl, context.data.cited),
      ...itemAttachment(review, baseUrl, altTexts),
      ...photoAttachments(document, context.data.config.baseUrl, altTexts),
      ...imageAttachments(document, context.data.config.baseUrl, altTexts),
    ],
    location: place(
      shareLocation(
        postLocations(context.data.config.dataDir).read(document.permalink),
        settings.location_sharing,
      ),
    ),
    // Both taxonomies become hashtags: a relay or a search that keys on a
    // hashtag has no reason to care which of the two a term came from, and
    // each one points at the archive the site serves for it.
    tags: [
      ...mentions(replyTo, mentioned),
      ...siteSpelledTags.map((tag) => hashtag(tag, tagHref(tag, 0, bases), baseUrl)),
      ...document.categories.map((category) =>
        hashtag(category, categoryHref(category, 0, bases), baseUrl),
      ),
    ],
  };

  const reviewed = reviewHtml(review, {
    library: review?.item.photo === undefined ? undefined : altTexts(),
    baseUrl,
  });
  if (postObjectType(document) === 'Note') {
    return new Note({
      ...common,
      contents: inLanguage(
        citing(document, context.data.cited) + headed(noteHeading(document), reviewed + html),
        language,
      ),
    });
  }

  const summary = feedExcerpt(document);
  const event = eventOf(document.extra);
  if (postObjectType(document) === 'Event' && event !== undefined) {
    return new Event({
      ...common,
      name: document.title === '' ? null : document.title,
      summaries: summary === '' ? [] : inLanguage(escapeText(summary), language),
      contents: inLanguage(html, language),
      startTime: toInstant(event.start) ?? null,
      endTime: toInstant(event.end) ?? null,
      location: eventPlace(event) ?? common.location,
    });
  }

  return new Article({
    ...common,
    name: document.title === '' ? null : document.title,
    summaries: summary === '' ? [] : inLanguage(escapeText(summary), language),
    contents: inLanguage(citing(document, context.data.cited) + reviewed + html, language),
  });
}

/**
 * A text as a plain value and again under its language: `content` beside a
 * `contentMap` keyed by the tag. Mastodon reads the language off the map and
 * the text off whichever it finds, so both go.
 */
function inLanguage(text: string, language: string): (string | LanguageString)[] {
  return [text, new LanguageString(text, language)];
}

function eventPlace(event: PostEvent): Place | undefined {
  const where = event.location;
  if (where === undefined) return undefined;
  if (where.kind === 'place') return new Place({ name: where.name });
  return new Place({ name: where.url, url: new URL(where.url) });
}

function place(shared: SharedLocation | undefined): Place | null {
  if (shared === undefined) return null;
  const words = placeWordList(shared.place);
  const name = words.length === 0 ? null : words.join(', ');
  if (shared.kind === 'place') return new Place({ name });
  const { latitude, longitude, accuracy } = shared.geo;
  return new Place({
    name,
    latitude,
    longitude,
    ...(accuracy === undefined ? {} : { accuracy, units: 'm' }),
  });
}

/**
 * The post's recording, as the `Audio` or `Video` Mastodon plays in the
 * timeline, or nothing for a post without one.
 *
 * It goes before the images on purpose. Mastodon shows a status's media by
 * the type of its first attachment, a player for audio or video and a gallery
 * otherwise, and keeps only the first four, so a recording after the pictures
 * could be shown as a broken tile or dropped. Only the main file goes: it is
 * always an upload, while an alternate version may be a link to another host
 * whose type this site cannot check, and a remote server fetches and
 * re-encodes whatever it is given.
 */
function recordingAttachment(
  document: Document,
  baseUrl: string,
  cited: CitedPageReader,
): (Audio | Video)[] {
  const enclosure = enclosureOf(document.extra);
  if (enclosure === undefined) return [];
  const values = {
    url: new URL(absoluteUrl(enclosure.url, baseUrl)),
    mediaType: enclosure.type,
    name: postLabel(document, cited),
  };
  return [playsAsVideo(enclosure.type) ? new Video(values) : new Audio(values)];
}

/**
 * Each of the post's photos, as an `Image` whose `name` is its alt
 * text, the media library's when the post gives none.
 *
 * They go after the recording and before the body's images, because they are
 * what a photo post is. A photo from another site is attached without a media
 * type, which this site cannot check.
 */
function photoAttachments(
  document: Document,
  baseUrl: string,
  altTexts: () => AltTextLibrary,
): Image[] {
  return photosOf(document.extra).map((photo) => {
    const media = isUploadUrl(photo.url)
      ? UPLOAD_MEDIA_TYPES.get(path.extname(photo.url).toLowerCase())
      : undefined;
    const alt = photoAlt(photo, altTexts()) ?? '';
    return new Image({
      url: new URL(absoluteUrl(photo.url, baseUrl)),
      mediaType: media?.kind === 'image' ? canonicalType(media) : null,
      name: alt === '' ? null : alt,
    });
  });
}

function itemAttachment(
  review: Review | undefined,
  baseUrl: string,
  altTexts: () => AltTextLibrary,
): Image[] {
  const picture = review?.item.photo;
  if (picture === undefined) return [];
  const media = isUploadUrl(picture.url)
    ? UPLOAD_MEDIA_TYPES.get(path.extname(picture.url).toLowerCase())
    : undefined;
  const alt = photoAlt(picture, altTexts()) ?? '';
  return [
    new Image({
      url: new URL(absoluteUrl(picture.url, baseUrl)),
      mediaType: media?.kind === 'image' ? canonicalType(media) : null,
      name: alt === '' ? null : alt,
    }),
  ];
}

/**
 * Each image the post shows from the site's own uploads, as an `Image` whose
 * `name` is its alt text.
 *
 * Mastodon strips `<img>` out of `content` and shows attachments instead, so
 * this is how a post's pictures reach a timeline, and `name` is where it reads
 * their description from.
 */
function imageAttachments(
  document: Document,
  baseUrl: string,
  altTexts: () => AltTextLibrary,
): Image[] {
  const attached = new Set(photosOf(document.extra).map((photo) => photo.url));
  return imagesIn(document.html)
    .filter((image) => !attached.has(image.src))
    .flatMap((image) => uploadedImage(image.src, image.alt, baseUrl, altTexts));
}

/**
 * A decorative image is left out: it is not part of what the post says. An
 * image from another site is left out too, since its media type is a guess
 * this site cannot check.
 */
function uploadedImage(
  src: string,
  alt: string | undefined,
  baseUrl: string,
  altTexts: () => AltTextLibrary,
): Image[] {
  const source = uploadPath(src);
  if (source === undefined || altTexts().get(source)?.kind === 'decorative') return [];
  const media = UPLOAD_MEDIA_TYPES.get(path.extname(source).toLowerCase());
  if (media?.kind !== 'image') return [];
  const name = alt?.trim() ?? '';
  return [
    new Image({
      url: new URL(absoluteUrl(src, baseUrl)),
      mediaType: canonicalType(media),
      name: name === '' ? null : name,
    }),
  ];
}

const QUOTABLE_BY_ANYONE = new InteractionPolicy({
  canQuote: new InteractionRule({ automaticApproval: PUBLIC_COLLECTION }),
});

/**
 * What an RSVP answers and what a like, a repost or a bookmark cites, as a
 * line linking each page: the words a peer shows,
 * since a `Note` has no field for it. The anchor stays plain: Mastodon
 * builds no link card from one with a `u-url` or `h-card` class or a
 * `rel=tag`.
 */
function citing(document: Document, cited: CitedPageReader): string {
  const rsvp = rsvpOf(document.extra);
  const event = replyTarget(document);
  const lines = citationsOf(document.extra).map(({ property, url }) => ({
    verb: CITATION_VERBS[property],
    url,
  }));
  if (rsvp !== undefined && event !== undefined) {
    lines.unshift({ verb: RSVP_PHRASES[rsvp], url: event });
  }
  return lines
    .map(({ verb, url }) => {
      const href = escapeAttribute(url);
      const name = escapeText(citedPageName(url, cited(url)));
      return `<p>${verb} <a href="${href}">${name}</a></p>\n`;
    })
    .join('');
}

function noteHeading(document: Document): string {
  const title = document.title.trim();
  if (title === '' || collapse(htmlToText(document.html)).startsWith(collapse(title))) {
    return '';
  }
  return `<p>${escapeText(title)}</p>`;
}

function headed(heading: string, html: string): string {
  if (heading === '') return html;
  return html === '' ? heading : `${heading}\n${html}`;
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
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
  replyTo?: CitedObject,
): Create {
  const object = postObject(context, document, replyTo);
  const { actor, followers } = attribution(context, document);

  return new Create({
    id: createActivityId(articleObjectId(context, document)),
    actor,
    object,
    published: toInstant(document.date) ?? null,
    ...addressing(
      document,
      followers,
      replyTo,
      mentionedAccounts(document.body, context.data.config.contentDir),
    ),
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
 * `revision` overrides that. A resend is asking for a revision
 * the followers have already been offered to be offered again, and an activity
 * id a peer has seen is one it is entitled to drop, so a resend passes the
 * moment instead of the hash. Everything else about the activity is the same,
 * which is what makes a resent `Update` and a saved one the same shape.
 */
export function postUpdateActivity(
  context: Context<FederationContextData>,
  document: Document,
  revision: string = revisionOf(document),
  replyTo?: CitedObject,
): Update {
  const object = postObject(context, document, replyTo);
  const { actor, followers } = attribution(context, document);

  return new Update({
    id: updateActivityId(articleObjectId(context, document), revision),
    actor,
    object,
    published: toInstant(document.updated ?? document.date) ?? null,
    ...addressing(
      document,
      followers,
      replyTo,
      mentionedAccounts(document.body, context.data.config.contentDir),
    ),
  });
}

/**
 * The `Delete` that withdraws a post: a `Tombstone` where its object was.
 *
 * The site sends this when a post becomes a draft, is trashed or is deleted,
 * and all three look the same from outside — the object is gone and the copy
 * every follower holds should go with it. The `Tombstone` keeps the object's id
 * and says what it used to be, which is what lets a peer that never held the
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
  const { actor, followers } = attribution(context, document);

  return new Delete({
    id: deleteActivityId(articleObjectId(context, document), deleted),
    actor,
    object: postTombstone(context, document, deleted),
    to: PUBLIC_COLLECTION,
    cc: followers,
  });
}

/**
 * The `Tombstone` where a post's object was: what a `Delete` carries, and what
 * a peer that fetches a deleted post's id is answered with. Nothing
 * records when a post was trashed, so a fetched one carries no `deleted`.
 */
export function postTombstone(
  context: Context<FederationContextData>,
  document: Document,
  deleted?: string,
): Tombstone {
  return new Tombstone({
    id: articleObjectId(context, document),
    formerType: OBJECT_TYPES[postObjectType(document)],
    deleted: toInstant(deleted) ?? null,
  });
}

/**
 * The `Add` that pins a post, or the `Remove` that unpins it: the post's id
 * moved in or out of its author's featured collection.
 *
 * Mastodon acts on one only when the `target` is exactly the `featured` URL
 * the actor publishes, and fetches the object by its id when it does not hold
 * it yet, so the object goes as a bare id, as Mastodon sends its own. The
 * revision makes each pin and each unpin an activity of its own.
 */
export function postPinActivity(
  context: Context<FederationContextData>,
  document: Document,
  change: PinChange,
  revision: string,
): Add | Remove {
  const user = documentAuthor(context, document);
  if (user === undefined) {
    throw new Error(
      `The post "${document.slug}" cannot be pinned: the site has no accounts, ` +
        'and decision-14 makes a user the actor a post is announced by.',
    );
  }
  const objectId = articleObjectId(context, document);
  const values = {
    id: pinActivityId(objectId, change, revision),
    actor: actorId(context, user),
    object: objectId,
    target: context.getFeaturedUri(user.username),
    to: PUBLIC_COLLECTION,
    cc: context.getFollowersUri(user.username),
  };
  return change === 'pin' ? new Add(values) : new Remove(values);
}

/** Whether a post went into its author's featured collection or out of it. */
export type PinChange = 'pin' | 'unpin';

/**
 * A post's ActivityStreams object id, off the Fedify context: its permalink,
 * or the id its file already names, or the id it was federated
 * under after a `Delete` of that one.
 *
 * A thin wrapper over {@link postObjectId} so everything in this module reads
 * the id the same way and off the same base URL the object's `url` is built
 * on. The rule itself lives in `content/permalinks.ts`, because the page, the feed
 * item and the object are one identity now rather than three.
 */
function replyTargetId(context: Context<FederationContextData>, inReplyTo: string): URL | null {
  const { config, store } = context.data;
  const permalink = permalinkOfObjectId(inReplyTo, config.baseUrl);
  const target =
    (permalink === undefined ? undefined : store.getByPermalink(permalink)) ??
    postByObjectId(store, inReplyTo, config);
  if (target?.type === 'post') return articleObjectId(context, target);
  const resolved = resolvedReplyTarget(config.contentDir, inReplyTo);
  if (resolved === null) return null;
  return new URL(resolved ?? inReplyTo);
}

export function articleObjectId(context: Context<FederationContextData>, document: Document): URL {
  const { baseUrl, contentDir } = context.data.config;
  return new URL(currentObjectId(readObjectIds(contentDir), postObjectId(document, baseUrl)));
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
