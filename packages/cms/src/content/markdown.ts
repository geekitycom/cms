import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance, StateInline, Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';

import type { HandleDirectory } from './handles.ts';
import { slugify } from './slug.ts';

/**
 * The renderer: markdown-it with Eleventy's default option (`html: true`),
 * plus footnotes and heading anchors. Code blocks get a language class and no
 * highlighting and a `tabindex` on the `<pre>`, so a theme can pick its own
 * highlighter on the client and a wide block scrolls by keyboard.
 *
 * A bare URL links only when it names its scheme (TASK-194): fuzzy matching
 * would link `file.md`, and a protocol-relative or `mailto:` match is not the
 * page a webmention could be sent to.
 */
const markdown: MarkdownItInstance = new MarkdownIt({ html: true, linkify: true })
  .use(footnote)
  .use(headingAnchors)
  .use(focusableCodeBlocks)
  .use(htmlInlineOffsets)
  .use(fediverseHandles);
markdown.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
for (const schema of ['ftp:', '//', 'mailto:']) markdown.linkify.add(schema, null);

/**
 * Render a Markdown body to the HTML the site and the feeds serve. A handle
 * `handles` knows links to its profile; any other stays text.
 */
export function renderMarkdown(body: string, handles?: HandleDirectory): string {
  const env: HandleEnv = { handles };
  return markdown.render(body, env);
}

/** Each `@user@host` a body names outside code and links, as `user@host` in lower case. */
export function handlesIn(body: string): string[] {
  const env: HandleEnv = { seen: new Set() };
  markdown.parse(body, env);
  return [...(env.seen ?? [])];
}

export function markdownTokens(body: string): Token[] {
  return markdown.parse(body, {});
}

/**
 * Where an `html_inline` token begins in its inline token's `content`, which
 * markdown-it records for no inline token. A Micropub client's Markdown has
 * its raw HTML cleaned in place (TASK-258), and this is how the tag is found
 * without mistaking the same characters in a code span for it.
 */
export function htmlInlineOffset(token: Token): number | undefined {
  const meta: unknown = token.meta;
  if (typeof meta !== 'object' || meta === null || !('htmlAt' in meta)) return undefined;
  return typeof meta.htmlAt === 'number' ? meta.htmlAt : undefined;
}

/**
 * Run markdown-it's own `html_inline` rule from a rule placed just before it,
 * so the position it starts from can be put on the token it pushes.
 */
function htmlInlineOffsets(md: MarkdownItInstance): void {
  const rule: (state: StateInline, silent: boolean) => boolean = (state, silent) => {
    const rules = state.md.inline.ruler.getRules('');
    const htmlInline = rules[rules.indexOf(rule) + 1];
    if (htmlInline === undefined) return false;
    const start = state.pos;
    if (!htmlInline(state, silent)) return false;
    const token = state.tokens.at(-1);
    if (!silent && token?.type === 'html_inline') token.meta = { htmlAt: start };
    return true;
  };
  md.inline.ruler.before('html_inline', 'geekity_html_inline_offset', rule);
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

// A type rather than an interface: markdown-it's env is an index signature.
type HandleEnv = {
  handles?: HandleDirectory | undefined;
  seen?: Set<string>;
};

const HANDLE =
  /^@([a-z0-9_][a-z0-9_.-]*)@((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9])/i;

/**
 * `@user@host` as the h-card link the site's mention markup is (TASK-194),
 * when the directory knows the handle. A handle inside a word, a link or code
 * is not one: `me@alice@host` is an address and a link already says where it
 * goes.
 */
function fediverseHandles(md: MarkdownItInstance): void {
  md.inline.ruler.before('linkify', 'geekity_fediverse_handle', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x40 || state.linkLevel > 0) return false;
    const before = state.src[state.pos - 1];
    if (before !== undefined && /[\p{L}\p{N}_@./-]/u.test(before)) return false;

    const match = HANDLE.exec(state.src.slice(state.pos));
    if (match === null) return false;
    const [written, user = '', host = ''] = match;
    const handle = `${user}@${host}`.toLowerCase();
    const env = state.env as HandleEnv;
    env.seen?.add(handle);
    const resolved = env.handles?.(handle);
    if (resolved === undefined) return false;

    if (!silent) {
      const open = state.push('link_open', 'a', 1);
      open.attrs = [
        ['class', 'u-category h-card'],
        ['href', resolved.profile],
      ];
      open.markup = 'handle';
      open.info = 'auto';
      state.push('text', '', 0).content = written;
      state.push('link_close', 'a', -1).markup = 'handle';
    }
    state.pos += written.length;
    return true;
  });
}
