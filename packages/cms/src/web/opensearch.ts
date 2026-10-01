import { iconSetting, siteIconSource } from '../images/icons.ts';
import type { ImageConfig } from '../images/paths.ts';
import { FAVICON_PATH } from './manifest.ts';
import { escapeXml } from './feed-xml.ts';
import { absoluteUrl, contentEtag, isNotModified } from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';
import { SEARCH_PATH } from './search.ts';

/**
 * The OpenSearch description (TASK-204): what a browser reads to offer the
 * site's own search from its address bar.
 *
 * A fixed route at the root for the reason the manifest is one, so no
 * permalink can take it, and linked from the head of every page.
 */

/** The description's URL. */
export const OPENSEARCH_PATH = '/opensearch.xml';

const OPENSEARCH_CONTENT_TYPE = 'application/opensearchdescription+xml; charset=utf-8';

/** OpenSearch 1.1 caps these two, and a browser may refuse a longer one. */
const SHORT_NAME_MAX = 16;
const DESCRIPTION_MAX = 1024;

/**
 * The description of one site, as XML.
 *
 * The short name is the title cut to 16 characters, and the description is
 * the tagline, else the title, since the spec requires one. The image is
 * `/favicon.ico`, whose 16 pixel frame is the size the spec suggests, and is
 * left out on a site with no icon, where that URL answers 404. Every URL is
 * absolute, because a browser keeps the template and runs it from its address
 * bar, with no page to resolve a relative one against.
 */
export function openSearchDescription(input: {
  config: ImageConfig & { baseUrl: string };
  site: { title: string; tagline?: string | undefined; icon?: unknown; avatar?: unknown };
}): string {
  const { config, site } = input;
  const url = (pathname: string): string => absoluteUrl(pathname, config.baseUrl);
  const tagline = site.tagline?.trim() ?? '';
  const hasIcon = siteIconSource(config, iconSetting(site)) !== undefined;

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
    `  <ShortName>${escapeXml(cut(site.title, SHORT_NAME_MAX))}</ShortName>`,
    `  <Description>${escapeXml(cut(tagline || site.title, DESCRIPTION_MAX))}</Description>`,
    '  <InputEncoding>UTF-8</InputEncoding>',
    ...(hasIcon
      ? [
          `  <Image width="16" height="16" type="image/x-icon">${escapeXml(url(FAVICON_PATH))}</Image>`,
        ]
      : []),
    `  <Url type="text/html" method="get" template="${escapeXml(url(SEARCH_PATH))}?q={searchTerms}"/>`,
    `  <Url type="application/opensearchdescription+xml" rel="self" template="${escapeXml(url(OPENSEARCH_PATH))}"/>`,
    '</OpenSearchDescription>',
  ];
  return `${lines.join('\n')}\n`;
}

/** The description as a response, or a 304 to a client that already holds it. */
export function openSearchResponse(
  body: string,
  conditional: ConditionalHeaders | undefined,
): Response {
  const etag = contentEtag('opensearch', body);
  const headers = new Headers({ etag, 'cache-control': 'no-cache' });

  if (isNotModified(conditional, etag, undefined)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', OPENSEARCH_CONTENT_TYPE);
  return new Response(body, { headers });
}

/** `text` cut to at most `max` characters, never inside a surrogate pair. */
function cut(text: string, max: number): string {
  return [...text].slice(0, max).join('').trimEnd();
}
