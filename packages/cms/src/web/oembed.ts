import type { Document } from '../content/document.ts';
import { postLabel } from '../content/post-type.ts';
import type { ImageConfig } from '../images/paths.ts';
import type { AuthorContext } from './authors.ts';
import { siteLocale, siteTimezone } from './context.ts';
import type { SiteData } from './context.ts';
import { feedExcerpt } from './feed-item.ts';
import { escapeXml } from './feed-xml.ts';
import { absoluteUrl, contentEtag, isNotModified } from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';
import { shareImage } from './share-image.ts';
import { formatDate } from './templates.ts';

/**
 * The oEmbed provider (TASK-205): what WordPress, Discourse and the rest ask
 * to turn a pasted post URL into a card.
 *
 * Under `/_geekity/`, the CMS's own prefix, so no permalink can take it. Each
 * post and page links it from its head, with its own URL in the query.
 */

/** The endpoint's URL. */
export const OEMBED_PATH = '/_geekity/oembed';

/** The formats the spec names. Anything else is a 501. */
export type OEmbedFormat = 'json' | 'xml';

const CONTENT_TYPES: Readonly<Record<OEmbedFormat, string>> = {
  json: 'application/json; charset=utf-8',
  xml: 'text/xml; charset=utf-8',
};

/**
 * The size the card asks for. A rich embed must give both, and a blockquote
 * of words reflows to whatever it is given, so these are what WordPress asks
 * for its own cards rather than a measurement.
 */
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 338;

/** One request, from its query. */
export interface OEmbedRequest {
  /** The URL to embed, as given. */
  url: string;
  /** `undefined` for a format this provider does not serve. */
  format: OEmbedFormat | undefined;
  maxwidth?: number | undefined;
  maxheight?: number | undefined;
}

/** A `type: rich` response. The thumbnail's three fields come together or not at all. */
export interface OEmbedRich {
  version: '1.0';
  type: 'rich';
  title: string;
  author_name?: string;
  author_url?: string;
  provider_name: string;
  provider_url: string;
  html: string;
  width: number;
  height: number;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
}

/** A query as a request. A missing `format` is JSON, which every consumer reads. */
export function oEmbedRequest(query: (name: string) => string | undefined): OEmbedRequest {
  const format = query('format') ?? 'json';
  return {
    url: query('url') ?? '',
    format: format === 'json' || format === 'xml' ? format : undefined,
    maxwidth: positiveInteger(query('maxwidth')),
    maxheight: positiveInteger(query('maxheight')),
  };
}

/**
 * The embed of one published document, served at `href`.
 *
 * The title is the document's, else a note's first words. The card is a
 * blockquote of escaped text and links, so it needs nothing from this site to
 * draw and can carry nothing a consumer would run. The thumbnail is the
 * document's own `image`, never the site's avatar, and only when its size is
 * recorded: the spec requires the size with the URL, and a render never opens
 * an image (decision-10). One wider or taller than the consumer allows is left
 * out, because the spec says it must respect `maxwidth` and `maxheight` too.
 */
export function oEmbedFor(input: {
  document: Document;
  href: string;
  author: AuthorContext | undefined;
  config: ImageConfig & { baseUrl: string };
  site: SiteData;
  request: OEmbedRequest;
}): OEmbedRich {
  const { document, author, config, site, request } = input;
  const url = (pathname: string): string => absoluteUrl(pathname, config.baseUrl);
  const title = postLabel(document);
  const authorUrl = author?.url === undefined ? undefined : url(author.url);
  const width = Math.min(DEFAULT_WIDTH, request.maxwidth ?? DEFAULT_WIDTH);
  const height = Math.min(DEFAULT_HEIGHT, request.maxheight ?? DEFAULT_HEIGHT);

  const image = shareImage({
    config,
    image: document.extra['image'],
    imageAlt: document.extra['imageAlt'],
    title,
    avatar: undefined,
    owner: site.title,
  });
  const thumbnail =
    image?.size !== undefined &&
    image.size.width <= (request.maxwidth ?? Infinity) &&
    image.size.height <= (request.maxheight ?? Infinity)
      ? { url: url(image.url), ...image.size }
      : undefined;

  return {
    version: '1.0',
    type: 'rich',
    title,
    ...(author === undefined ? {} : { author_name: author.name }),
    ...(authorUrl === undefined ? {} : { author_url: authorUrl }),
    provider_name: site.title,
    provider_url: url('/'),
    html: card({
      href: url(input.href),
      title,
      excerpt: document.title === '' ? '' : feedExcerpt(document),
      author: author === undefined ? undefined : { name: author.name, url: authorUrl },
      date: {
        iso: formatDate(document.date, 'iso'),
        readable: formatDate(document.date, 'readable', siteTimezone(site), siteLocale(site)),
      },
      site: { name: site.title, url: url('/') },
    }),
    width,
    height,
    ...(thumbnail === undefined
      ? {}
      : {
          thumbnail_url: thumbnail.url,
          thumbnail_width: thumbnail.width,
          thumbnail_height: thumbnail.height,
        }),
  };
}

/** The embed as a response in `format`, or a 304 to a client that already holds it. */
export function oEmbedResponse(
  embed: OEmbedRich,
  format: OEmbedFormat,
  conditional: ConditionalHeaders | undefined,
): Response {
  const body = format === 'json' ? JSON.stringify(embed) : oEmbedXml(embed);
  const etag = contentEtag(`oembed-${format}`, body);
  const headers = new Headers({ etag, 'cache-control': 'no-cache' });

  if (isNotModified(conditional, etag, undefined)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', CONTENT_TYPES[format]);
  return new Response(body, { headers });
}

/** The XML spelling: one element per field, under `<oembed>`. */
function oEmbedXml(embed: OEmbedRich): string {
  const fields = Object.entries(embed).map(
    ([name, value]) => `  <${name}>${escapeXml(String(value))}</${name}>`,
  );
  return [
    '<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
    '<oembed>',
    ...fields,
    '</oembed>',
    '',
  ].join('\n');
}

/** The card: a linked title, the excerpt, who and when, and the site it is from. */
function card(input: {
  href: string;
  title: string;
  excerpt: string;
  author: { name: string; url: string | undefined } | undefined;
  /** Empty strings for an undated page. */
  date: { iso: string; readable: string };
  site: { name: string; url: string };
}): string {
  const link = (href: string, text: string): string =>
    `<a href="${escapeXml(href)}">${escapeXml(text)}</a>`;
  const { author, date } = input;

  const byline = [
    ...(author === undefined
      ? []
      : [author.url === undefined ? escapeXml(author.name) : link(author.url, author.name)]),
    ...(date.iso === ''
      ? []
      : [`<time datetime="${escapeXml(date.iso)}">${escapeXml(date.readable)}</time>`]),
  ];

  return [
    `<blockquote class="geekity-embed" cite="${escapeXml(input.href)}">`,
    `<p><strong>${link(input.href, input.title)}</strong></p>`,
    ...(input.excerpt === '' ? [] : [`<p>${escapeXml(input.excerpt)}</p>`]),
    ...(byline.length === 0 ? [] : [`<p>${byline.join(', ')}</p>`]),
    `<p>${link(input.site.url, input.site.name)}</p>`,
    '</blockquote>',
  ].join('');
}

function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^[0-9]+$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed > 0 ? parsed : undefined;
}
