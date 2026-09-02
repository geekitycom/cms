import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';
import footnote from 'markdown-it-footnote';

import { slugify } from './slug.ts';

/**
 * The renderer: markdown-it with Eleventy's default option (`html: true`),
 * plus footnotes and heading anchors. Code blocks get a language class and no
 * highlighting, so a theme can pick its own highlighter on the client.
 */
const markdown: MarkdownItInstance = new MarkdownIt({ html: true })
  .use(footnote)
  .use(headingAnchors);

/** Render a Markdown body to the HTML the site and the feeds serve. */
export function renderMarkdown(body: string): string {
  return markdown.render(body);
}

/**
 * Give every heading an `id` so a URL can point at it. Ids come from the same
 * slugifier as permalinks, and repeat headings get a numeric suffix so the ids
 * stay unique within one document.
 */
function headingAnchors(md: MarkdownItInstance): void {
  md.core.ruler.push('geekity_heading_anchors', (state) => {
    const used = new Map<string, number>();
    let index = 0;

    for (const [position, token] of state.tokens.entries()) {
      if (token.type !== 'heading_open') continue;
      index += 1;

      const inline = state.tokens[position + 1];
      const text = inline === undefined ? '' : inline.content;
      const base = slugify(text) === '' ? `section-${String(index)}` : slugify(text);

      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      token.attrSet('id', seen === 0 ? base : `${base}-${String(seen + 1)}`);
    }

    return true;
  });
}
