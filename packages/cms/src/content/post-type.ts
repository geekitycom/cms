import { citationsOf } from './citation.ts';
import type { CitationProperty } from './citation.ts';
import type { Document } from './document.ts';
import { photosOf } from './photo.ts';
import { isReadStatus, readLine, readOf } from './read.ts';
import { htmlToText } from './search.ts';

/**
 * Post Type Discovery (W3C Working Group Note, 18 January 2018; living spec at
 * ptd.spec.indieweb.org): what kind of post a post is, inferred from its own
 * properties rather than declared by its author.
 *
 * Repost, like, reply, photo and the note/article tail of the algorithm are
 * here. The spec's full order is event, rsvp, repost, like, reply, video,
 * photo, then the tail, and the order matters because the first branch that
 * matches wins: a reply with a photo is a reply. Each new type is a check in
 * {@link discoverPostType} in that order. granary's `mf2util` diverges from
 * the spec, putting reply ahead of repost and like and having no video
 * branch; this follows the spec.
 *
 * Bookmark is an IndieWeb extension the spec lists only as under
 * consideration, so the spec types a bookmark as a note or an article. It
 * sits after photo, just ahead of the tail (TASK-169): every post the spec
 * types as something else keeps that type, and a bookmark claims only what
 * the spec would have called a note or an article.
 */
export type PostType =
  'repost' | 'like' | 'reply' | 'photo' | 'read' | 'bookmark' | 'note' | 'article';

/** The mf2 properties the algorithm reads, each as its plain-text value. */
export interface PostProperties {
  name?: string | undefined;
  content?: string | undefined;
  summary?: string | undefined;
  'in-reply-to'?: string | undefined;
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

/**
 * Whether a page, a listing or a feed heads the post with its title: one the
 * author typed that is not just the opening words of its text. Unlike the
 * note/article tail of {@link discoverPostType}, a post with no text shows its
 * title (TASK-256), so a titled like, repost or bookmark is headed by it while
 * Post Type Discovery still types it by its citation.
 */
export function showsTitle(document: Pick<Document, 'title' | 'html' | 'description'>): boolean {
  const name = normalize(document.title);
  return name !== '' && !textOf(htmlToText(document.html), document.description).startsWith(name);
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
export function postLabel(
  document: Pick<Document, 'title' | 'html' | 'description' | 'extra'>,
): string {
  if (document.title !== '') return document.title;

  const html = readLine(readOf(document.extra)) + document.html;
  const text = normalize(htmlToText(html)) || normalize(document.description ?? '');
  if (text === '') return 'Untitled';

  const words = text.split(' ');
  return words.length <= LABEL_WORDS ? text : `${words.slice(0, LABEL_WORDS).join(' ')} …`;
}

function isNamedPost(properties: PostProperties): boolean {
  const content = textOf(properties.content, properties.summary);
  if (content === '') return false;

  const name = normalize(properties.name ?? '');
  if (name === '') return false;

  return !content.startsWith(name);
}

/** A post's text for comparing with its name: its content, else its summary. */
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
