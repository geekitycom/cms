import { slugify } from './slug.ts';

export interface WikiLink {
  readonly end: number;
  readonly slug: string;
  readonly anchor: string;
  readonly text: string;
}

export interface WikiLinkSpan {
  readonly from: number;
  readonly to: number;
  readonly slug: string;
}

const WIKI_LINK = /^\[\[([^[\]\n]*)\]\]/;

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

/**
 * A `[` after an odd run of backslashes is escaped, as markdown-it's escape
 * rule takes it, so it opens nothing.
 */
function escaped(text: string, pos: number): boolean {
  let backslashes = 0;
  while (pos - backslashes > 0 && text[pos - backslashes - 1] === '\\') backslashes += 1;
  return backslashes % 2 === 1;
}
