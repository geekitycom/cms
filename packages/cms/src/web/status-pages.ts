import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { GeekityEnv } from './env.ts';
import { statusMarkdown } from './markdown-representation.ts';
import { CONTENT_TYPES, representationOf } from './negotiate.ts';
import type { StatusPageName } from './render.ts';
import { requestPath } from './request.ts';

/** The theme's 404 page, for a path that resolved to nothing. */
export function notFound(c: Context<GeekityEnv>): Response {
  return statusPage(c, 'notFound', 404, (url) => c.var.renderer.renderNotFound(url));
}

/** The theme's 410 page, for the URL of a document that was deleted. */
export function gone(c: Context<GeekityEnv>): Response {
  return statusPage(c, 'gone', 410, (url) => c.var.renderer.renderGone(url));
}

/**
 * A status page in the representation the request asked for: Markdown for a
 * `.md` URL or an `Accept` that prefers it, HTML for anything else.
 */
function statusPage(
  c: Context<GeekityEnv>,
  page: StatusPageName,
  status: ContentfulStatusCode,
  html: (url: string) => string,
): Response {
  const pathname = requestPath(c);
  const representation = representationOf(pathname, c.req.header('accept'));
  if (representation === 'markdown' || representation === 'text') {
    return statusMarkdownResponse(c, representation, page, status);
  }
  return c.html(html(pathname), status, { vary: 'Accept' });
}

/** How {@link statusMarkdownResponse} answers. */
export interface StatusMarkdownOptions {
  /** The maintenance page's back-by time. */
  until?: Date | undefined;
  /** The body when the theme's fails to render; without one the failure is thrown. */
  fallback?: string | undefined;
  headers?: Record<string, string> | undefined;
}

/** A status page's Markdown, labelled as the representation the request asked for. */
export function statusMarkdownResponse(
  c: Context<GeekityEnv>,
  representation: 'markdown' | 'text',
  page: StatusPageName,
  status: ContentfulStatusCode,
  { until, fallback, headers }: StatusMarkdownOptions = {},
): Response {
  const draw = (): string => statusMarkdown(c, page, requestPath(c), until);
  const body = fallback === undefined ? draw() : orFallback(draw, fallback);
  return c.body(body, status, {
    ...headers,
    vary: 'Accept',
    'content-type': CONTENT_TYPES[representation],
    'content-disposition': 'inline',
  });
}

function orFallback(draw: () => string, fallback: string): string {
  try {
    return draw();
  } catch (error) {
    console.error('A status page could not be rendered in Markdown:', error);
    return fallback;
  }
}
