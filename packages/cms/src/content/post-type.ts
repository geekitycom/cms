import { CITATION_VERBS, citationOf, citationsOf, citedPageName } from './citation.ts';
import type { CitationProperty, CitedPageReader } from './citation.ts';
import type { Document } from './document.ts';
import { eventOf, instantOf } from './event.ts';
import { photosOf } from './photo.ts';
import { isReadStatus, readLine, readOf } from './read.ts';
import { RSVP_PHRASES, rsvpOf, rsvpValue } from './rsvp.ts';
import { htmlToText } from './search.ts';

/**
 * Post Type Discovery (W3C Working Group Note, 18 January 2018; living spec at
 * ptd.spec.indieweb.org): what kind of post a post is, inferred from its own
 * properties rather than declared by its author.
 *
 * Event, RSVP, repost, like, reply, photo and the note/article tail of the
 * algorithm are here. The spec's full order is event, rsvp, repost, like,
 * reply, video, photo, then the tail, and the order matters because the first
 * branch that matches wins: a reply with a photo is a reply. The spec's event
 * is a post of type h-event; a file has no such type, so an event is a post
 * with a readable `start`, the property an h-event cannot do without
 * (TASK-200). Each new type is a check in {@link discoverPostType} in that
 * order. granary's `mf2util` diverges from the spec, putting reply ahead of
 * repost and like and having no video branch; this follows the spec.
 *
 * Bookmark is an IndieWeb extension the spec lists only as under
 * consideration, so the spec types a bookmark as a note or an article. It
 * sits after photo, just ahead of the tail (TASK-169): every post the spec
 * types as something else keeps that type, and a bookmark claims only what
 * the spec would have called a note or an article.
 */
export type PostType =
  | 'event'
  | 'rsvp'
  | 'repost'
  | 'like'
  | 'reply'
  | 'photo'
  | 'read'
  | 'bookmark'
  | 'note'
  | 'article';

/** The mf2 properties the algorithm reads, each as its plain-text value. */
export interface PostProperties {
  name?: string | undefined;
  content?: string | undefined;
  summary?: string | undefined;
  'in-reply-to'?: string | undefined;
  start?: string | undefined;
  rsvp?: string | undefined;
  /** Each photo's address. */
  photo?: readonly string[] | undefined;
  'repost-of'?: string | undefined;
  'like-of'?: string | undefined;
  'bookmark-of'?: string | undefined;
  'read-of'?: string | undefined;
  'read-status'?: string | undefined;
}

/** The type of a post with these properties. */
export function discoverPostType(properties: PostProperties): PostType {
  if (instantOf(properties.start) !== undefined) return 'event';
  if (rsvpValue(properties.rsvp) !== undefined) return 'rsvp';
  if (validUrl(properties['repost-of']) !== undefined) return 'repost';
  if (validUrl(properties['like-of']) !== undefined) return 'like';
  if (validUrl(properties['in-reply-to']) !== undefined) return 'reply';
  if ((properties.photo ?? []).length > 0) return 'photo';
  if ((properties['read-of'] ?? '') !== '' && isReadStatus(properties['read-status'])) {
    return 'read';
  }
  if (validUrl(properties['bookmark-of']) !== undefined) return 'bookmark';
  return isNamedPost(properties) ? 'article' : 'note';
}

/**
 * The type of a document, derived every time it is asked for rather than
 * stored, so the file stays the only thing that decides it (decision-1).
 */
export function postTypeOf(document: PostDocument): PostType {
  return discoverPostType(propertiesOf(document));
}

export function showsTitle(document: Pick<Document, 'title' | 'html' | 'description'>): boolean {
  const text = textOf(htmlToText(document.html), document.description);
  return titleIsMoreThanOpeningWords(document.title, text);
}

/**
 * The URL a post replies to: its `in-reply-to` when that is an absolute http
 * or https URL, and `undefined` otherwise, which is also when it is no reply.
 */
export function replyTarget(document: Pick<Document, 'inReplyTo'>): string | undefined {
  return validUrl(document.inReplyTo);
}

/** The parts of a document Post Type Discovery reads. */
type PostDocument = Pick<Document, 'title' | 'html' | 'description' | 'inReplyTo' | 'extra'>;

function propertiesOf(document: PostDocument): PostProperties {
  const read = readOf(document.extra);
  return {
    name: document.title,
    content: htmlToText(document.html),
    summary: document.description,
    'in-reply-to': document.inReplyTo,
    start: eventOf(document.extra)?.start,
    rsvp: rsvpOf(document.extra),
    // Only addresses {@link photosOf} accepts, the spec's "valid URL" for a
    // file whose uploads are site-relative.
    photo: photosOf(document.extra).map((photo) => photo.url),
    ...Object.fromEntries(
      citationsOf(document.extra).map(({ property, url }): [CitationProperty, string] => [
        property,
        url,
      ]),
    ),
    'read-of': read?.of.name,
    'read-status': read?.status,
  };
}

/** How many words of an untitled post's text {@link postLabel} keeps. */
const LABEL_WORDS = 10;

/**
 * The words a link to a document says: its title, or for an untitled post the
 * first words of its text, so a note is never an empty link.
 */
export function postLabel(document: PostDocument, cited?: CitedPageReader): string {
  if (document.title !== '') return document.title;

  const html = readLine(readOf(document.extra)) + document.html;
  const text = normalize(htmlToText(html)) || normalize(document.description ?? '');
  if (text === '') return wordlessLabel(document, cited);

  return firstWords(text);
}

function firstWords(text: string): string {
  const words = text.split(' ');
  return words.length <= LABEL_WORDS ? text : `${words.slice(0, LABEL_WORDS).join(' ')} …`;
}

function wordlessLabel(document: PostDocument, cited: CitedPageReader | undefined): string {
  const type = postTypeOf(document);
  if (type === 'photo') {
    const alt = normalize(photosOf(document.extra)[0]?.alt ?? '');
    return alt === '' ? 'Photo' : firstWords(alt);
  }
  const citing = (verb: string, url: string): string => {
    const context = cited?.(url);
    const name = citedPageName(url, context);
    const author = context?.name === undefined ? context?.author?.name : undefined;
    return author === undefined ? `${verb} ${name}` : `${verb} ${name} by ${author}`;
  };
  if (type === 'reply' || type === 'rsvp') {
    const url = replyTarget(document);
    const rsvp = rsvpOf(document.extra);
    const verb = rsvp === undefined ? 'Reply to' : RSVP_PHRASES[rsvp];
    if (url !== undefined) return citing(verb, url);
  }
  if (type === 'repost' || type === 'like' || type === 'bookmark') {
    const property = `${type}-of` as const;
    const url = citationOf(document, property);
    if (url !== undefined) return citing(CITATION_VERBS[property], url);
  }
  return 'Untitled';
}

function isNamedPost(properties: PostProperties): boolean {
  const text = textOf(properties.content, properties.summary);
  const hasText = text !== '';
  return hasText && titleIsMoreThanOpeningWords(properties.name ?? '', text);
}

function titleIsMoreThanOpeningWords(title: string, text: string): boolean {
  const name = normalize(title);
  return name !== '' && !text.startsWith(name);
}

function textOf(content: string | undefined, summary: string | undefined): string {
  return normalize(content ?? '') || normalize(summary ?? '');
}

/** The spec's "valid URL", as a web page can be one: absolute, http or https. */
function validUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
}

/** Trim, and collapse every run of internal whitespace to one space. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
