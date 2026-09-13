import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';
import footnote from 'markdown-it-footnote';

import { slugify } from './slug.ts';

/**
 * The renderer: markdown-it with Eleventy's default option (`html: true`),
 * plus footnotes and heading anchors. Code blocks get a language class and no
 * highlighting and a `tabindex` on the `<pre>`, so a theme can pick its own
 * highlighter on the client and a wide block scrolls by keyboard.
 */
const markdown: MarkdownItInstance = new MarkdownIt({ html: true })
  .use(footnote)
  .use(headingAnchors)
  .use(focusableCodeBlocks);

/** Render a Markdown body to the HTML the site and the feeds serve. */
export function renderMarkdown(body: string): string {
  return markdown.render(body);
}

/**
 * Put `tabindex="0"` on every `<pre>`, so a block of code wider than the
 * measure can be scrolled from the keyboard.
 *
 * A `<pre>` scrolls sideways rather than wrapping, and a scroll container that
 * nothing can focus is unreachable without a pointer — WCAG 2.2's keyboard
 * criterion, and the reason the Eleventy site this design comes from passed
 * `preAttributes: { tabindex: 0 }` to its highlighter. There is no highlighter
 * here (a theme highlights on the client), so the renderer does it.
 *
 * Both block rules are wrapped: `fence` for a ``` block and `code_block` for an
 * indented one.
 */
function focusableCodeBlocks(md: MarkdownItInstance): void {
  for (const rule of ['fence', 'code_block'] as const) {
    const original = md.renderer.rules[rule]?.bind(md.renderer.rules);
    const render = original ?? md.renderer.renderToken.bind(md.renderer);

    md.renderer.rules[rule] = (tokens, index, options, env, self) =>
      render(tokens, index, options, env, self).replace('<pre>', '<pre tabindex="0">');
  }
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
