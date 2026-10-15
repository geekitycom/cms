import type { Document } from '../content/document.ts';
import { enclosureOf, isCaptions, playsAsVideo } from '../content/enclosure.ts';
import type { Enclosure, Transcript } from '../content/enclosure.ts';
import { photoAlt, photosOf } from '../content/photo.ts';
import type { SharedLocation } from '../content/location.ts';
import { citationsOf, shownInFull } from '../content/citation.ts';
import { originalOf } from '../content/original.ts';
import type { CitedImage, CitedPicture } from '../webmention/cited-picture.ts';
import type { Citation, CitedPageReader } from '../content/citation.ts';
import { READ_STATUS_LABELS, readLine, readOf, uidLabel } from '../content/read.ts';
import { eventOf } from '../content/event.ts';
import type { EventLocation } from '../content/event.ts';
import { RSVP_LABELS, rsvpLine, rsvpOf } from '../content/rsvp.ts';
import type { RsvpValue } from '../content/rsvp.ts';
import type { ReadOf, ReadStatus } from '../content/read.ts';
import { postLabel, postTypeOf, replyTarget, showsTitle } from '../content/post-type.ts';
import type { PostType } from '../content/post-type.ts';
import { readAltTexts } from '../content/alt-text.ts';
import { siteImageMarkup } from '../images/markup.ts';
import type { ImageLoading } from '../images/markup.ts';
import type { ImageConfig } from '../images/variants.ts';
import { escapeAttribute } from '../util/html.ts';
import type { AuthorContext } from '../site/authors.ts';
import { feedExcerpt, postExcerpt } from '../content/excerpt.ts';
import { documentLanguage } from '../content/locale.ts';
import { handSyndicationOf } from '../webmention/syndication.ts';

/**
 * What Eleventy calls `page`: the data about the document being rendered, as
 * opposed to the document's own front matter.
 */
export interface PageContext {
  /** The document's URL path. Always ends in `/`. */
  url: string;
  /** Publish date, absent for a document that has none. */
  date?: Date | undefined;
  /** The permalink's last segment, Eleventy's `page.fileSlug`. */
  fileSlug: string;
  /** The source file, relative to the content directory, Eleventy-style. */
  inputPath: string;
}

/**
 * One document as a template sees it.
 *
 * The shape mirrors what an Eleventy layout receives: the front matter at the
 * top level, the rendered body as `content`, and `page` alongside. Two keys
 * Eleventy puts on a collection item rather than on the page — `url` and
 * `tags` — are here too, so one shape serves both a rendered page and an entry
 * in a listing.
 */
export interface DocumentContext {
  /** Display title. Empty for an untitled post. */
  title: string;
  /**
   * `event`, `rsvp`, `repost`, `like`, `reply`, `photo`, `read`, `bookmark`,
   * `note` or `article`, discovered from the front matter, the title and the
   * body (Post Type Discovery) on every render rather than read from the file.
   */
  postType: PostType;
  /**
   * Whether the post shows its title: one the author gave that its text does
   * not open with, including on a post with no text at all (TASK-256). A theme
   * heads such a post with its title and draws any other by its content,
   * whatever its type: a reply or a like can be either.
   */
  named: boolean;
  /** The URL a reply answers, present only on a reply. */
  inReplyTo?: string | undefined;
  /**
   * What an RSVP says (TASK-198): its `rsvp` value, the words for it, and
   * `line`, the `p-rsvp` as the HTML its content opens with. Present only on
   * a post whose front matter names one of the four values.
   */
  rsvp?: { value: RsvpValue; label: string; line: string } | undefined;
  /**
   * When and where an event is (TASK-200): `start` and, when it has one,
   * `end`, as instants a theme formats in the site's zone, and `location`,
   * either `{ kind: 'place', name }` or `{ kind: 'virtual', url }`. Present
   * only on a post whose front matter has a readable `start`.
   */
  event?: { start: Date; end?: Date; location?: EventLocation } | undefined;
  /**
   * What the post reposts, likes or bookmarks (TASK-169): each valid
   * `repost-of`, `like-of` and `bookmark-of`, as its property and its URL, in
   * that order. Empty for a post that cites nothing.
   */
  citations: Citation[];
  /**
   * What a read post read (TASK-229): its `read-status` and the words for it,
   * its `read-of` with the words a page prints for the uid, and `line`, the
   * sentence as the HTML the feeds and the federated Note carry (TASK-233).
   * Present only on a post whose front matter names both.
   */
  read?:
    | {
        status: ReadStatus;
        statusLabel: string;
        of: ReadOf & { uidLabel?: string | undefined };
        line: string;
      }
    | undefined;
  /**
   * The language the document is written in, as a canonical BCP 47 tag, when
   * its front matter names one (TASK-154). A theme marks the article with it
   * where it is not the site's `language`. A value that is no tag is
   * `undefined` here, so a typo in one file never reaches an attribute.
   */
  lang?: string | undefined;
  /**
   * The words a link to the document says: its title, or an untitled post's
   * first words, or what a post with neither is.
   */
  label: string;
  /** Publish date, absent for a document that has none. */
  date?: Date | undefined;
  /** Taxonomy, in the order the file lists it. */
  tags: string[];
  /** The second taxonomy: what the document is filed under, in file order. */
  categories: string[];
  /** The Markdown body rendered to HTML. Templates print it with `| safe`. */
  content: string;
  /**
   * What the document is about in one line of plain text: the `description`
   * the author wrote, else an excerpt of the rendered body, else empty.
   *
   * The very string the feeds publish as a summary, from the same function, so
   * a feed item and the entry a listing prints for the same post cannot say
   * two different things (decision-16). Always present, empty included, so a
   * theme prints it without asking whether it is there.
   */
  summary: string;
  /**
   * The document's own words in one line: `summary` without a read post's
   * read line, which a listing prints after the headline instead.
   */
  excerpt: string;
  /** The document's URL path, the same value as `page.url`. */
  url: string;
  /** Eleventy's `page`. */
  page: PageContext;
  /** `post` or `page`. */
  type: string;
  /**
   * The post's recording (TASK-213), read once by `enclosureOf` over the raw
   * front matter, with what a player needs decided: whether it is played by a
   * `<video>` or an `<audio>`, and whether its transcript is timed captions.
   * Absent when the front matter describes none worth playing, so a theme
   * asks `{% if enclosure %}`.
   */
  enclosure?: EnclosureContext | undefined;
  /**
   * The post's photos (TASK-166), in the order its `photo` front matter lists
   * them, over the raw value. Empty when it has none.
   */
  photos: PhotoContext[];
  /**
   * The post's copies elsewhere, each printed as `u-syndication` (TASK-155):
   * the URLs its `syndication` front matter lists by hand, and on a post's own
   * page the copies its syndication targets answered with. Over the raw front
   * matter value, so a theme always reads this shape. Empty when there are none.
   */
  syndication: SyndicationLink[];
  /**
   * Where the post was first published, when that is elsewhere (TASK-293):
   * its `canonical_href` when that is an absolute http or https URL, and what a
   * link to it says: its `canonical_name` (TASK-316), else its host. A theme
   * makes it the page's canonical URL and links to it.
   */
  original?: SyndicationLink | undefined;
  /** Everything else from the front matter, including unmodelled keys. */
  [key: string]: unknown;
}

export interface LocationContext {
  type: 'h-card' | 'h-adr' | 'h-geo';
  words: readonly { property: string; text: string }[];
  geo?: { latitude: string; longitude: string } | undefined;
}

export function locationContext(shared: SharedLocation): LocationContext {
  const { place } = shared;
  const words = [
    ['p-name', place.name],
    ['p-locality', place.locality],
    ['p-region', place.region],
    ['p-country-name', place.country],
  ]
    .filter((pair): pair is [string, string] => pair[1] !== undefined)
    .map(([property, text]) => ({ property, text }));
  const type = place.name !== undefined ? 'h-card' : words.length > 0 ? 'h-adr' : 'h-geo';
  return {
    type,
    words,
    ...(shared.kind === 'exact'
      ? { geo: { latitude: String(shared.geo.latitude), longitude: String(shared.geo.longitude) } }
      : {}),
  };
}

/** One copy of a post elsewhere: its URL, and the host a link to it says. */
export interface SyndicationLink {
  url: string;
  label: string;
}

/** Copies as a theme links them, each URL once. */
export function syndicationLinks(urls: readonly string[]): SyndicationLink[] {
  return [...new Set(urls)].map(hostLink);
}

function hostLink(url: string): SyndicationLink {
  return { url, label: hostLabel(url) };
}

function hostLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

/** A post's recording as a theme plays it. See {@link DocumentContext.enclosure}. */
export interface EnclosureContext extends Omit<Enclosure, 'transcript'> {
  /** The element that plays it, the same answer the fediverse's attachment type gives. */
  player: 'audio' | 'video';
  transcript?: (Transcript & { captions: boolean }) | undefined;
}

/** One of a post's photos as a theme prints it. See {@link DocumentContext.photos}. */
export interface PhotoContext {
  /** As the front matter wrote it: an upload's site-relative URL, or a web address. */
  url: string;
  /** Its alt text: the post's own, else the media library's (TASK-141). Empty when nobody said. */
  alt: string;
  /**
   * `<img class="u-photo" src alt>`, the microformats2 photo of the h-entry,
   * as a responsive `<picture>` when the upload's variants exist, the same
   * rewrite `content` gets (decision-10).
   */
  html: string;
}

/**
 * One of a post's neighbours by date, as a theme links it: `previous` and
 * `next` under an entry.
 *
 * Two keys rather than the whole document, because that is what the link is —
 * the words on it and where it goes — and a theme that was handed a second
 * document context would be a theme that could print a second post by
 * accident.
 */
export interface NeighbourContext {
  /** What the link says: the neighbour's title, or a note's first words. */
  title: string;
  /** Its URL path. */
  url: string;
}

/**
 * One of the site's own posts or pages that links to the document, as a theme
 * lists it under "Linked from" (TASK-322): a link, and the date beside it.
 * A link rather than a document context, for the reason a neighbour is one.
 */
export interface BacklinkContext {
  /** What the link says: the linking document's title, or a note's first words. */
  title: string;
  /** Its URL path. */
  url: string;
  /** When it was published, absent for a page that has no date. */
  date?: Date | undefined;
}

/** A backlink as {@link BacklinkContext} has it. */
export function backlinkContext(document: Document, cited?: CitedPageReader): BacklinkContext {
  return {
    title: postLabel(document, cited),
    url: document.permalink,
    ...optional('date', toDate(document.date)),
  };
}

/**
 * A document as a template sees it.
 *
 * Front matter goes on first so the keys the CMS models always win: a file
 * with a stray `content` or `page` key cannot displace the rendered body or
 * the page data.
 *
 * `images` is the site's image config, and giving it is what turns an uploaded
 * picture in `content` into a `<picture>` with a `srcset` (decision-10). It is
 * an argument rather than something `renderMarkdown` does, because only the
 * theme's HTML may have it: the feeds, the JSON and Markdown representations
 * and the ActivityStreams `content` all read `document.html` directly and must
 * keep the plain `<img>` of the original.
 *
 * `author` is the profile behind the front matter's `author` (TASK-67), and it
 * is an argument for the reason `images` is: only something holding the site's
 * users can resolve a name to a person. Given one, the context's `author` is
 * that object rather than the raw string — `author.name` to print and
 * `author.url` to link — so a theme writes one thing whether the file names a
 * login, a display name from before decision-14, or somebody who has no
 * account here at all. Without one the file's own string is left where it was,
 * which is what a test over a single template renders.
 *
 * `loading` says whether this document opens the page it is printed on, and
 * so whether its first image is fetched at once rather than lazily.
 */
export function documentContext(
  document: Document,
  images?: ImageConfig,
  author?: AuthorContext,
  loading?: ImageLoading,
  cited?: CitedPageReader,
): DocumentContext {
  const date = toDate(document.date);
  const photos = photoContexts(document, images, loading);
  const { location: _frontMatterLocation, ...extra } = document.extra;
  const original = originalOf(document.extra);

  return {
    ...extra,
    permalink: document.permalink,
    slug: document.slug,
    draft: document.draft,
    ...optional('description', document.description),
    ...optional('author', author ?? document.author),
    ...optional('updated', toDate(document.updated)),
    ...optional('activitypub', document.activitypub),

    title: document.title,
    postType: postTypeOf(document),
    named: showsTitle(document),
    ...optional('inReplyTo', replyTarget(document)),
    rsvp: rsvpContext(document),
    event: eventContext(document),
    citations: citationsOf(document.extra),
    read: readContext(document, images),
    // Over the raw front-matter value the spread above put here.
    lang: documentLanguage(document),
    enclosure: enclosureContext(document),
    syndication: syndicationLinks(handSyndicationOf(document.extra)),
    original:
      original === undefined
        ? undefined
        : { url: original.url, label: original.name ?? hostLabel(original.url) },
    label: postLabel(document, cited),
    ...optional('date', date),
    tags: document.tags,
    categories: document.categories,
    photos,
    // The first photo opens a page that leads with this document, so the
    // body's images are only first when there are no photos.
    content:
      images === undefined
        ? document.html
        : siteImageMarkup(images, document.html, photos.length > 0 ? {} : loading),
    // The plain-text summary, taken off the document rather than off the
    // markup above: an excerpt is text, and the `<picture>` a site's image
    // config puts in the HTML is not something to cut words out of.
    summary: feedExcerpt(document),
    excerpt: postExcerpt(document),
    url: document.permalink,
    type: document.type,
    page: {
      url: document.permalink,
      ...optional('date', date),
      fileSlug: document.slug,
      inputPath: `./${document.path}`,
    },
  };
}

function toDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function photoContexts(
  document: Document,
  images: ImageConfig | undefined,
  loading: ImageLoading | undefined,
): PhotoContext[] {
  const photos = photosOf(document.extra);
  if (photos.length === 0) return [];
  const library = images === undefined ? new Map() : readAltTexts(images.contentDir);
  return photos.map((photo, index) => {
    const alt = photoAlt(photo, library) ?? '';
    const tag = `<img class="u-photo" src="${escapeAttribute(photo.url)}" alt="${escapeAttribute(alt)}">`;
    const html =
      images === undefined
        ? tag
        : siteImageMarkup(images, tag, { lead: index === 0 && loading?.lead === true });
    return { url: photo.url, alt, html };
  });
}

export interface CitedPhotoContext extends CitedImage {
  readonly imgHtml: string;
}

/** A cited author's photo, beside their name: decorative, since the name says who it is. */
export function citedPhotoContext(photo: CitedImage, images: ImageConfig): CitedPhotoContext {
  const tag =
    `<img class="u-photo cite-avatar" src="${escapeAttribute(photo.src)}" alt=""` +
    ` width="${String(photo.width)}" height="${String(photo.height)}" loading="lazy" decoding="async">`;
  return { ...photo, imgHtml: siteImageMarkup(images, tag) };
}

export interface CitedPictureContext extends CitedPicture {
  readonly shownInFull: boolean;
  readonly imgHtml: string;
}

export function citedPictureContext(
  picture: CitedPicture,
  property: string,
  alt: string,
  images: ImageConfig,
): CitedPictureContext {
  const tag =
    `<img class="u-photo" src="${escapeAttribute(picture.src)}" alt="${escapeAttribute(alt)}"` +
    ` width="${String(picture.width)}" height="${String(picture.height)}" loading="lazy" decoding="async">`;
  return {
    ...picture,
    shownInFull: shownInFull(property, picture),
    imgHtml: siteImageMarkup(images, tag),
  };
}

function enclosureContext(document: Document): EnclosureContext | undefined {
  const enclosure = enclosureOf(document.extra);
  if (enclosure === undefined) return undefined;
  const { transcript, ...rest } = enclosure;
  return {
    ...rest,
    player: playsAsVideo(enclosure.type) ? 'video' : 'audio',
    ...(transcript === undefined
      ? {}
      : { transcript: { ...transcript, captions: isCaptions(transcript) } }),
  };
}

function rsvpContext(document: Document): DocumentContext['rsvp'] {
  const value = rsvpOf(document.extra);
  if (value === undefined) return undefined;
  return { value, label: RSVP_LABELS[value], line: rsvpLine(value) };
}

function eventContext(document: Document): DocumentContext['event'] {
  const event = eventOf(document.extra);
  if (event === undefined) return undefined;
  return {
    start: new Date(event.start),
    ...(event.end === undefined ? {} : { end: new Date(event.end) }),
    ...(event.location === undefined ? {} : { location: event.location }),
  };
}

function readContext(document: Document, images: ImageConfig | undefined): DocumentContext['read'] {
  const read = readOf(document.extra);
  if (read === undefined) return undefined;
  const { uid } = read.of;
  return {
    status: read.status,
    statusLabel: READ_STATUS_LABELS[read.status],
    of: { ...read.of, uidLabel: uid === undefined ? undefined : uidLabel(uid) },
    line:
      images === undefined
        ? readLine(read)
        : siteImageMarkup(images, readLine(read, { library: readAltTexts(images.contentDir) })),
  };
}
