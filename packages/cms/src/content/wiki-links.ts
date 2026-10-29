import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';

import { slugify } from './slug.ts';
import { DEFAULT_PERMALINK_BASES } from './taxonomy.ts';

/** The rule's name, for a parser that wraps it to see where it matched. */
export const WIKI_LINK_RULE = 'geekity_wiki_link';

// A type rather than an interface: markdown-it's env is an index signature.
export type WikiLinkEnv = { wikiBase?: string | undefined };

/** One `[[Target#Heading|text]]` as written at a position. */
interface WikiLink {
  /** Where the closing `]]` ends. */
  readonly end: number;
  readonly href: string;
  readonly text: string;
}

const WIKI_LINK = /^\[\[([^[\]\n]*)\]\]/;

/**
 * The wiki link written at `pos` in `src`, or `undefined` when there is none
 * or its target slugifies to nothing. The target is the page's title, which
 * slugifies to its file name; a `#Heading` slugifies as `headingAnchors` makes
 * a heading's id, and the text after a `|` replaces the target as the words.
 */
function wikiLinkAt(src: string, pos: number, base: string): WikiLink | undefined {
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
  const anchor = slugify(heading);
  return {
    end: pos + written.length,
    href: `/${base}/${slug}/${anchor === '' ? '' : `#${anchor}`}`,
    text: label === '' ? target : label,
  };
}

/**
 * Turn `[[Target]]`, `[[Target|text]]`, `[[Target#Heading]]` and
 * `[[Target#Heading|text]]` into a link to the wiki page the target names,
 * under the wiki base the parse's env carries. The link is written whether or
 * not that page exists, so the HTML depends only on the body and the base.
 *
 * Code is never reached by an inline rule, and markdown-it's escape rule has
 * already taken a `\[`, so both stay as written.
 */
export function wikiLinks(md: MarkdownItInstance): void {
  md.inline.ruler.before('link', WIKI_LINK_RULE, (state, silent) => {
    if (state.linkLevel > 0) return false;
    if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) {
      return false;
    }
    const base = (state.env as WikiLinkEnv).wikiBase ?? DEFAULT_PERMALINK_BASES.wiki;
    const link = wikiLinkAt(state.src, state.pos, base);
    if (link === undefined || link.end > state.posMax) return false;

    if (!silent) {
      const open = state.push('link_open', 'a', 1);
      open.attrs = [
        ['class', 'wiki-link'],
        ['href', link.href],
      ];
      open.markup = 'wiki';
      state.push('text', '', 0).content = link.text;
      state.push('link_close', 'a', -1).markup = 'wiki';
    }
    state.pos = link.end;
    return true;
  });
}
