import type { Context } from 'hono';

import type { Document } from '../content/document.ts';
import { postLabel } from '../content/post-type.ts';
import type { GeekityEnv } from './env.ts';
import { authorContext, siteAuthorContext } from '../site/authors.ts';
import { permalinkOfObjectId } from '../content/permalinks.ts';
import { embedPage, embedResponse, oEmbedFor, oEmbedRequest, oEmbedResponse } from './oembed.ts';
import type { EmbedSubject } from './oembed.ts';
import { classifyPath } from './paths.ts';
import { conditionalHeaders } from './request.ts';
import { notFound } from './status-pages.ts';
import { servedPath, siteView } from './site-view.ts';

/**
 * The oEmbed of the post or page a URL names, a 404 when it names none, and a
 * 501 for a format the spec allows and this provider does not serve.
 */
export function oEmbed(c: Context<GeekityEnv>): Response {
  const request = oEmbedRequest((name) => c.req.query(name));
  const found = embeddableAt(c, request.url);
  if (found === undefined) return notFound(c);
  if (request.format === undefined) return c.text('Not Implemented', 501);

  const embed = oEmbedFor({ ...embedSubject(c, found), config: c.var.config, request });
  return oEmbedResponse(embed, request.format, conditionalHeaders(c));
}

/**
 * The card of the post or page a URL names as a page another site may frame,
 * and a 404, framed by nobody else, when it names none.
 */
export function embedView(c: Context<GeekityEnv>): Response {
  const found = embeddableAt(c, c.req.query('url') ?? '');
  if (found === undefined) return notFound(c);

  c.set('frameable', true);
  return embedResponse(embedPage(embedSubject(c, found)), conditionalHeaders(c));
}

/** What an embed of `found` is drawn from, with the byline it names. */
function embedSubject(
  c: Context<GeekityEnv>,
  found: { document: Document; href: string },
): EmbedSubject {
  const site = c.var.renderer.site();
  const users = siteView(c).users();
  return {
    ...found,
    label: postLabel(found.document, (url) =>
      c.var.replyContexts.read(url, c.var.siteAtRequestStart),
    ),
    // Who the byline names: the document's author, else the site's.
    author: authorContext(users, found.document.author) ?? siteAuthorContext(users, site.author),
    config: c.var.config,
    site,
  };
}

/**
 * The published post or page an absolute URL is the page of, and where it is
 * served, or `undefined`.
 *
 * The same lookup a request for that URL makes, so an embed exists exactly
 * where a page does: a URL on this site's origin and under its base path,
 * with no query, at a public document's permalink. `/` is the static
 * homepage when there is one, and a listing — the posts page included — is
 * not a page to embed.
 */
function embeddableAt(
  c: Context<GeekityEnv>,
  url: string,
): { document: Document; href: string } | undefined {
  const pathname = permalinkOfObjectId(url, c.var.config.baseUrl);
  if (pathname === undefined) return undefined;

  const view = siteView(c);
  const match = classifyPath(view, pathname);
  if (match?.kind !== 'document') return undefined;
  return { document: match.document, href: servedPath(match.document, view.pages.home) };
}
