import type { Document } from './document.ts';
import { htmlToText } from './search.ts';

/**
 * Post Type Discovery (W3C Working Group Note, 18 January 2018; living spec at
 * ptd.spec.indieweb.org): what kind of post a post is, inferred from its own
 * properties rather than declared by its author.
 *
 * Only the note/article tail of the algorithm is here. The spec's full order
 * is event, rsvp, repost, like, reply, video, photo, then this tail, and the
 * order matters because the first branch that matches wins: each new type is
 * a check in front of {@link noteOrArticle} in {@link discoverPostType}, in
 * that order. granary's `mf2util` diverges from the spec, putting reply ahead
 * of repost and like and having no video branch; this follows the spec.
 */
export type PostType = 'note' | 'article';

/** The mf2 properties the algorithm reads, each as its plain-text value. */
export interface PostProperties {
  name?: string | undefined;
  content?: string | undefined;
  summary?: string | undefined;
}

/** The type of a post with these properties. */
export function discoverPostType(properties: PostProperties): PostType {
  return noteOrArticle(properties);
}

/**
 * The type of a document, derived every time it is asked for rather than
 * stored, so the file stays the only thing that decides it (decision-1).
 */
export function postTypeOf(document: Pick<Document, 'title' | 'html' | 'description'>): PostType {
  return discoverPostType({
    name: document.title,
    content: htmlToText(document.html),
    summary: document.description,
  });
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

function noteOrArticle(properties: PostProperties): PostType {
  const content = normalize(properties.content ?? '') || normalize(properties.summary ?? '');
  if (content === '') return 'note';

  const name = normalize(properties.name ?? '');
  if (name === '') return 'note';

  return content.startsWith(name) ? 'note' : 'article';
}

/** Trim, and collapse every run of internal whitespace to one space. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
