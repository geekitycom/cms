import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';

import { schemedLinksOnly } from '../content/markdown.ts';
import { absoluteUrl } from '../util/url.ts';

const ALLOWED_SCHEMES: readonly string[] = ['http://', 'https://', 'mailto:'];

const markdown: MarkdownItInstance = new MarkdownIt({ html: false, linkify: true }).use(
  schemedLinksOnly,
);

const hasScheme = (url: string): boolean => /^[a-z][a-z0-9+.-]*:/.test(url);

function isSiteOrAllowedLink(url: string): boolean {
  const lowered = url.trim().toLowerCase();
  return !hasScheme(lowered) || ALLOWED_SCHEMES.some((scheme) => lowered.startsWith(scheme));
}

markdown.validateLink = isSiteOrAllowedLink;

type BioEnv = { baseUrl?: string | undefined };

markdown.renderer.rules['link_open'] = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const { baseUrl } = env as BioEnv;
  const href = token?.attrGet('href');
  if (typeof href === 'string' && baseUrl !== undefined) {
    token?.attrSet('href', absoluteUrl(href, baseUrl));
  }
  return self.renderToken(tokens, index, options);
};

export function bioHtml(bio: string, { baseUrl }: { baseUrl?: string } = {}): string {
  const trimmed = bio.trim();
  return trimmed === '' ? '' : markdown.render(trimmed, { baseUrl } satisfies BioEnv);
}

export function bioText(bio: string): string {
  return markdown
    .parse(bio.trim(), {})
    .filter((token) => token.type === 'inline')
    .map((token) =>
      markdown.renderer.renderInlineAsText(token.children ?? [], markdown.options, {}),
    )
    .join('\n\n');
}
