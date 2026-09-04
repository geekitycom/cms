import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';

/**
 * The Markdown a stranger is allowed to write.
 *
 * A post is written by somebody who has signed in, so `content/markdown.ts`
 * renders it with Eleventy's own options — raw HTML included. A comment is
 * written by anybody at all, so it gets its own renderer rather than a
 * sanitising pass over the same one: what is not produced cannot leak, and a
 * profile is easier to read than a list of what was taken out again.
 *
 * Three things are different from the site's own renderer:
 *
 * - **No raw HTML.** `html: false` escapes it, so a `<script>` a commenter
 *   typed is the word they typed.
 * - **Every link marked.** `rel="nofollow ugc"` on links written and on bare
 *   URLs alike: a comment is user-generated content pointing somewhere else,
 *   which is exactly what the two tokens are for.
 * - **No embedding.** An image becomes a link to it. Rendering `<img>` would
 *   let a commenter put a stranger's file — and a tracking pixel that logs
 *   every reader's address — on somebody else's page.
 *
 * Links are also held to an allowlist of schemes, so nothing reaches a reader
 * that a browser would treat as a program. That is the same list
 * `web/sanitize.ts` publishes remote HTML through, spelled again here because
 * this renderer never sees that module's output.
 */

/**
 * URL schemes a link in a comment may use.
 *
 * An allowlist rather than a `javascript:` denylist: `data:` and `vbscript:`
 * are as dangerous, and the next scheme somebody thinks of is on no list
 * written today.
 */
const ALLOWED_SCHEMES: readonly string[] = ['http://', 'https://', 'mailto:'];

/** What every link a comment carries is marked with. */
const LINK_REL = 'nofollow ugc';

const markdown: MarkdownItInstance = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

markdown.validateLink = (url) => {
  const lowered = url.trim().toLowerCase();
  return ALLOWED_SCHEMES.some((scheme) => lowered.startsWith(scheme));
};

// Every link, however it was written: `[words](url)`, a bare URL linkify
// found, or a reference definition. One rule covers all three, because
// markdown-it emits the same token for each.
markdown.renderer.rules['link_open'] = (tokens, index, options, _env, self) => {
  const token = tokens[index];
  token?.attrSet('rel', LINK_REL);
  return self.renderToken(tokens, index, options);
};

// An image, as the link it points at. The alt text is what the commenter meant
// to say about it, so that is what the link reads; an image with no alt is
// linked by its URL, which is better than an empty anchor.
markdown.renderer.rules['image'] = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const alt = self.renderInlineAsText(token?.children ?? [], options, env);
  const href = String(token?.attrGet('src') ?? '');
  // A source this site would not publish as a link is not published as one
  // here either; the words the commenter wrote about it stay.
  if (!markdown.validateLink(href)) return escapeText(alt);

  return `<a href="${escapeAttribute(href)}" rel="${LINK_REL}">${escapeText(alt || href)}</a>`;
};

/**
 * A comment body as the HTML the page and the feeds carry.
 *
 * An empty body is empty HTML rather than a stray newline, so nothing calling
 * this has to decide whether "nothing" is worth printing.
 */
export function renderCommentMarkdown(body: string): string {
  const trimmed = body.trim();
  return trimmed === '' ? '' : markdown.render(trimmed);
}

/** A URL as an attribute value. */
function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}

/** Text as markup. */
function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
