import { decodeEntities } from '../util/html.ts';
import type { Document } from './document.ts';
import { readLine, readOf } from './read.ts';

/**
 * How many words of the rendered text an excerpt keeps when a post carries no
 * `description`. WordPress's own excerpt length, so a migrated site's feed
 * reads the same.
 */
export const EXCERPT_WORDS = 55;

/**
 * The plain-text summary a feed carries for a post.
 *
 * The `description` front matter when the post has one — it is what the author
 * wrote for exactly this — and otherwise the first paragraph of the rendered
 * body, stripped to text and cut where WordPress cuts an excerpt. A read post's
 * first paragraph is its read line, so its summary says the current status. Never the
 * whole post: the content element is where the whole post goes, and a reader
 * that shows both should have something to choose between.
 */
export function feedExcerpt(document: Document): string {
  if (document.description !== undefined) return document.description;
  return excerptFromHtml(readLine(readOf(document.extra)) + document.html);
}

/**
 * The post's own words in one line: the `description`, else the first
 * paragraph of the body. {@link feedExcerpt} without the read line, for a
 * listing that prints the read line itself after the headline (TASK-395).
 */
export function postExcerpt(document: Document): string {
  return document.description ?? excerptFromHtml(document.html);
}

/**
 * The first paragraph of some HTML as plain text, cut where WordPress cuts an
 * excerpt. What a post falls back to when it carries no `description`, and
 * what a comment — which never carries one — always uses.
 */
export function excerptFromHtml(html: string): string {
  // Tags are dropped rather than replaced by a space: the markup inside a
  // paragraph is inline, and "now</span>," is one word followed by a comma.
  // What separates the words is the whitespace the renderer already put
  // between its block tags, which the collapse below turns into single spaces.
  const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? html;
  const text = decodeEntities(paragraph.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return '';

  const words = text.split(' ');
  return words.length <= EXCERPT_WORDS ? text : `${words.slice(0, EXCERPT_WORDS).join(' ')} …`;
}
