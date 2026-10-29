/**
 * How a `[[wiki link]]` is written, shared by the markdown-it rule that
 * renders one and the admin editor that highlights one, so the two cannot
 * disagree about what is a link or which page it names. It imports nothing but
 * the slug function, because the editor bundle takes it too.
 */
import { slugify } from './slug.ts';

/** One `[[Target#Heading|text]]` as written at a position. */
export interface WikiLink {
  /** Where the closing `]]` ends. */
  readonly end: number;
  /** The target's slug, which is the wiki page's file name. */
  readonly slug: string;
  /** The heading's slug, or `''` when there is none. */
  readonly anchor: string;
  /** The words the link shows. */
  readonly text: string;
}

/** A wiki link in a run of text, from its `[[` to the end of its `]]`. */
export interface WikiLinkSpan {
  readonly from: number;
  readonly to: number;
  readonly slug: string;
}

const WIKI_LINK = /^\[\[([^[\]\n]*)\]\]/;

/**
 * The wiki link written at `pos` in `src`, or `undefined` when there is none
 * or its target slugifies to nothing. The target is the page's title, which
 * slugifies to its file name; a `#Heading` slugifies as `headingAnchors` makes
 * a heading's id, and the text after a `|` replaces the target as the words.
 */
export function wikiLinkAt(src: string, pos: number): WikiLink | undefined {
  const match = WIKI_LINK.exec(src.slice(pos));
  if (match === null) return undefined;
  const [written, inner = ''] = match;

  const bar = inner.indexOf('|');
  const destination = bar === -1 ? inner : inner.slice(0, bar);
  const label = bar === -1 ? '' : inner.slice(bar + 1).trim();
  const hash = destination.indexOf('#');
  const target = (hash === -1 ? destination : destination.slice(0, hash)).trim();
  const heading = hash === -1 ? '' : destination.slice(hash + 1);

  const slug = slugify(target);
  if (slug === '') return undefined;
  return {
    end: pos + written.length,
    slug,
    anchor: slugify(heading),
    text: label === '' ? target : label,
  };
}

/**
 * Every wiki link in `text`, in order. A `[` after an odd run of backslashes
 * is escaped, as markdown-it's escape rule takes it, so it opens nothing.
 * Whether the text is code is the caller's to know.
 */
export function wikiLinksIn(text: string): WikiLinkSpan[] {
  const spans: WikiLinkSpan[] = [];
  let pos = text.indexOf('[[');
  while (pos !== -1) {
    const link = escaped(text, pos) ? undefined : wikiLinkAt(text, pos);
    if (link === undefined) {
      pos = text.indexOf('[[', pos + 1);
    } else {
      spans.push({ from: pos, to: link.end, slug: link.slug });
      pos = text.indexOf('[[', link.end);
    }
  }
  return spans;
}

function escaped(text: string, pos: number): boolean {
  let backslashes = 0;
  while (pos - backslashes > 0 && text[pos - backslashes - 1] === '\\') backslashes += 1;
  return backslashes % 2 === 1;
}
