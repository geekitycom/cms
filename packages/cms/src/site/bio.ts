import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';

import { schemedLinksOnly } from '../content/markdown.ts';
import { absoluteUrl } from '../util/url.ts';

/**
 * A profile's bio is a short piece of Markdown, written in the users screen
 * and rendered once per format: HTML for the card and the actor's summary,
 * text for structured data. The Markdown pages print it as written.
 *
 * Raw HTML is escaped (`html: false`), as a comment's is: the bio leaves the
 * site as an ActivityPub summary, and a `<` typed in it is a `<` on every
 * server that shows it.
 */

/** Schemes a bio's link may use; a link with no scheme is a link on this site. */
const ALLOWED_SCHEMES: readonly string[] = ['http://', 'https://', 'mailto:'];

const markdown: MarkdownItInstance = new MarkdownIt({ html: false, linkify: true }).use(
  schemedLinksOnly,
);

markdown.validateLink = (url) => {
  const lowered = url.trim().toLowerCase();
  return !/^[a-z][a-z0-9+.-]*:/.test(lowered) || ALLOWED_SCHEMES.some((s) => lowered.startsWith(s));
};

type BioEnv = { baseUrl?: string | undefined };

markdown.renderer.rules['link_open'] = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const { baseUrl } = (env ?? {}) as BioEnv;
  const href = token?.attrGet('href');
  if (typeof href === 'string' && baseUrl !== undefined) {
    token?.attrSet('href', absoluteUrl(href, baseUrl));
  }
  return self.renderToken(tokens, index, options);
};

/**
 * The bio as HTML, a `<p>` per paragraph. Given `baseUrl`, a link to this site
 * is made absolute, for where the HTML is read somewhere else.
 */
export function bioHtml(bio: string, { baseUrl }: { baseUrl?: string } = {}): string {
  const trimmed = bio.trim();
  return trimmed === '' ? '' : markdown.render(trimmed, { baseUrl } satisfies BioEnv);
}

/** The bio's words with the Markdown taken off, its paragraphs a blank line apart. */
export function bioText(bio: string): string {
  return markdown
    .parse(bio.trim(), {})
    .filter((token) => token.type === 'inline')
    .map((token) =>
      markdown.renderer.renderInlineAsText(token.children ?? [], markdown.options, {}),
    )
    .join('\n\n');
}
