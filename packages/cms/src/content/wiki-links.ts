import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';

import { DEFAULT_PERMALINK_BASES } from './taxonomy.ts';
import { wikiLinkAt } from './wiki-link-syntax.ts';

/** The rule's name, for a parser that wraps it to see where it matched. */
export const WIKI_LINK_RULE = 'geekity_wiki_link';

// A type rather than an interface: markdown-it's env is an index signature.
export type WikiLinkEnv = { wikiBase?: string | undefined };

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
    const link = wikiLinkAt(state.src, state.pos);
    if (link === undefined || link.end > state.posMax) return false;

    if (!silent) {
      const open = state.push('link_open', 'a', 1);
      open.attrs = [
        ['class', 'wiki-link'],
        ['href', `/${base}/${link.slug}/${link.anchor === '' ? '' : `#${link.anchor}`}`],
      ];
      open.markup = 'wiki';
      state.push('text', '', 0).content = link.text;
      state.push('link_close', 'a', -1).markup = 'wiki';
    }
    state.pos = link.end;
    return true;
  });
}
