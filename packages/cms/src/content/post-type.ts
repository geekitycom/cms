import type { Document } from './document.ts';
import { htmlToText } from './search.ts';

/**
 * Post Type Discovery (W3C Working Group Note, 18 January 2018; living spec at
 * ptd.spec.indieweb.org): what kind of post a post is, inferred from its own
 * properties rather than declared by its author.
 *
 * Reply and the note/article tail of the algorithm are here. The spec's full
 * order is event, rsvp, repost, like, reply, video, photo, then the tail, and
 * the order matters because the first branch that matches wins: a reply with
 * a photo is a reply. Each new type is a check in {@link discoverPostType} in
 * that order. granary's `mf2util` diverges from the spec, putting reply ahead
 * of repost and like and having no video branch; this follows the spec.
 */
export type PostType = 'reply' | 'note' | 'article';

/** The mf2 properties the algorithm reads, each as its plain-text value. */
export interface PostProperties {
  name?: string | undefined;
  content?: string | undefined;
  summary?: string | undefined;
  'in-reply-to'?: string | undefined;
}

/** The type of a post with these properties. */
export function discoverPostType(properties: PostProperties): PostType {
  if (validUrl(properties['in-reply-to']) !== undefined) return 'reply';
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
 * Whether a post has a name of its own: a title its text does not open with.
 * The note/article tail's test, asked on its own because a reply can be
 * either, and a theme heads a named post with its title whatever its type.
 */
export function isNamed(document: PostDocument): boolean {
  return isNamedPost(propertiesOf(document));
}

/**
 * The URL a post replies to: its `in-reply-to` when that is an absolute http
 * or https URL, and `undefined` otherwise, which is also when it is no reply.
 */
export function replyTarget(document: Pick<Document, 'inReplyTo'>): string | undefined {
  return validUrl(document.inReplyTo);
}

/** The parts of a document Post Type Discovery reads. */
type PostDocument = Pick<Document, 'title' | 'html' | 'description' | 'inReplyTo'>;

function propertiesOf(document: PostDocument): PostProperties {
  return {
    name: document.title,
    content: htmlToText(document.html),
    summary: document.description,
    'in-reply-to': document.inReplyTo,
  };
}

/** How many words of an untitled post's text {@link postLabel} keeps. */
const LABEL_WORDS = 10;

/**
 * The words a link to a document says: its title, or for an untitled post the
 * first words of its text, so a note is never an empty link.
 */
export function postLabel(document: Pick<Document, 'title' | 'html' | 'description'>): string {
  if (document.title !== '') return document.title;

  const text = normalize(htmlToText(document.html)) || normalize(document.description ?? '');
  if (text === '') return 'Untitled';

  const words = text.split(' ');
  return words.length <= LABEL_WORDS ? text : `${words.slice(0, LABEL_WORDS).join(' ')} …`;
}

function isNamedPost(properties: PostProperties): boolean {
  const content = normalize(properties.content ?? '') || normalize(properties.summary ?? '');
  if (content === '') return false;

  const name = normalize(properties.name ?? '');
  if (name === '') return false;

  return !content.startsWith(name);
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
