import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';

import { DEFAULT_PERMALINK_BASES } from './taxonomy.ts';
import { wikiLinkAt } from './wiki-link-syntax.ts';

export const WIKI_LINK_RULE = 'geekity_wiki_link';

// A type rather than an interface: markdown-it's env is an index signature.
export type WikiLinkEnv = { wikiBase?: string | undefined };

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
