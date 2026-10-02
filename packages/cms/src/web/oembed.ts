import { createHash } from 'node:crypto';

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

/**
 * The embed view's URL (TASK-208): the card alone as a page, with the
 * document's absolute URL in `?url=`, and the one response on the site another
 * origin may frame.
 *
 * WordPress keeps a rich embed from a provider it does not know only when its
 * html holds an `<iframe>`, so the oEmbed html frames this page after the
 * blockquote, the way WordPress's own provider does.
 */
export const EMBED_PATH = '/_geekity/embed';

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

/** One published document, served at `href`, and what its card names beside it. */
export interface EmbedSubject {
  document: Document;
  href: string;
  author: AuthorContext | undefined;
  config: { baseUrl: string };
  site: SiteData;
}

/**
 * The embed of one published document, served at `href`.
 *
 * The title is the document's, else a note's first words. The html is the
 * card, then a hidden sandboxed frame of {@link EMBED_PATH}: a consumer that
 * keeps the html as given shows the blockquote, one that strips iframes still
 * has it, and WordPress, which keeps only the frame, shows that once the page
 * inside has told it how tall it is. The thumbnail is the
 * document's own `image`, never the site's avatar, and only when its size is
 * recorded: the spec requires the size with the URL, and a render never opens
 * an image (decision-10). One wider or taller than the consumer allows is left
 * out, because the spec says it must respect `maxwidth` and `maxheight` too.
 */
export function oEmbedFor(
  input: EmbedSubject & { config: ImageConfig & { baseUrl: string }; request: OEmbedRequest },
): OEmbedRich {
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
    fallbacks: [],
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
    html: `${embedCard(input)}${embedFrame({
      src: url(`${EMBED_PATH}?${new URLSearchParams({ url: url(input.href) }).toString()}`),
      title,
      width,
      height,
    })}`,
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

/**
 * The embed view's page: the card, a style to read it by, and the script that
 * speaks WordPress's side of the embed.
 *
 * Nothing in it depends on who asked. There is no theme, no admin bar and no
 * session, so a reader of a framing site sees the same card a signed-in admin
 * would, and nothing about either. `noindex` because the post is the page to
 * find, not its card.
 */
export function embedPage(subject: EmbedSubject): string {
  return [
    '<!doctype html>',
    `<html lang="${escapeXml(siteLocale(subject.site))}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeXml(postLabel(subject.document))}</title>`,
    `<style>${EMBED_STYLE}</style>`,
    '</head>',
    '<body>',
    embedCard(subject),
    `<script>${EMBED_SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * The embed page as a response, or a 304 to a client that already holds it.
 *
 * Its policy is its own and complete: the one inline style and the one inline
 * script by hash, nothing else loaded, and any origin may frame it. The
 * caller marks the context frameable as well, so the baseline leaves off
 * `X-Frame-Options`, which has no way to say "anyone".
 */
export function embedResponse(page: string, conditional: ConditionalHeaders | undefined): Response {
  const etag = contentEtag('embed', page);
  const headers = new Headers({
    etag,
    'cache-control': 'no-cache',
    'content-security-policy': EMBED_CONTENT_SECURITY_POLICY,
  });

  if (isNotModified(conditional, etag, undefined)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(page, { headers });
}

/**
 * The card's look inside the frame. Inline, like the script, because the page
 * loads nothing: one request per embed is all a framing page should cost.
 */
const EMBED_STYLE = [
  'html{color-scheme:light}',
  'body{margin:0;background:#fff;color:#1f1f1f;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
  '.geekity-embed{margin:0;padding:16px 20px;border:1px solid #d6d6d6;border-radius:8px;overflow-wrap:anywhere}',
  '.geekity-embed p{margin:0 0 8px}',
  '.geekity-embed p:last-child{margin:0;font-size:14px;color:#595959}',
  '.geekity-embed a{color:#0b57d0}',
].join('');

/**
 * WordPress's embed protocol, the framed side (wp-includes/js/wp-embed.js is
 * the other).
 *
 * WordPress puts a secret in the frame's URL as `#?secret=` and keeps the
 * frame hidden until a message with that secret says how tall the page is.
 * The page says so when it loads, when it is resized, and whenever the host
 * says it is ready. Its frame is sandboxed with scripts only, so a link cannot
 * navigate by itself: a click is sent to the host as a `link` message, which
 * WordPress follows when the link is on this site's host. Opened directly
 * there is no secret, and the links are ordinary links.
 */
const EMBED_SCRIPT = [
  '(function(){',
  'var found=/[?&]secret=([A-Za-z0-9]+)/.exec(location.hash);',
  'if(!found||window.parent===window)return;',
  'var secret=found[1];',
  "function send(message,value){window.parent.postMessage({message:message,value:value,secret:secret},'*');}",
  "function height(){send('height',Math.ceil(document.documentElement.getBoundingClientRect().height));}",
  "addEventListener('load',height);",
  "addEventListener('resize',height);",
  "addEventListener('message',function(event){var data=event.data;if(data&&data.message==='ready'&&data.secret===secret)height();});",
  "document.addEventListener('click',function(event){var link=event.target instanceof Element?event.target.closest('a[href]'):null;if(!link)return;event.preventDefault();send('link',link.href);});",
  '})();',
].join('');

/** A CSP source naming one inline element's exact contents. */
function inlineHash(contents: string): string {
  return `'sha256-${createHash('sha256').update(contents, 'utf8').digest('base64')}'`;
}

const EMBED_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `style-src ${inlineHash(EMBED_STYLE)}`,
  `script-src ${inlineHash(EMBED_SCRIPT)}`,
  "base-uri 'none'",
  "form-action 'none'",
  'frame-ancestors *',
].join('; ');

/**
 * The frame of the embed view, in the shape WordPress's own provider sends:
 * sandboxed, borderless, and hidden until the page inside reports its height.
 */
function embedFrame(input: { src: string; title: string; width: number; height: number }): string {
  return [
    '<iframe sandbox="allow-scripts" security="restricted"',
    ` src="${escapeXml(input.src)}"`,
    ` width="${String(input.width)}" height="${String(input.height)}"`,
    ` title="${escapeXml(input.title)}"`,
    ' frameborder="0" marginwidth="0" marginheight="0" scrolling="no"',
    ' style="position: absolute; visibility: hidden;"></iframe>',
  ].join('');
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

/**
 * The card of one document, as both the oEmbed html and the embed page carry
 * it. A blockquote of escaped text and links, so it needs nothing from this
 * site to draw and can carry nothing a consumer would run.
 */
function embedCard(subject: EmbedSubject): string {
  const { document, author, site, config } = subject;
  const url = (pathname: string): string => absoluteUrl(pathname, config.baseUrl);
  return card({
    href: url(subject.href),
    title: postLabel(document),
    excerpt: document.title === '' ? '' : feedExcerpt(document),
    author:
      author === undefined
        ? undefined
        : { name: author.name, url: author.url === undefined ? undefined : url(author.url) },
    date: {
      iso: formatDate(document.date, 'iso'),
      readable: formatDate(document.date, 'readable', siteTimezone(site), siteLocale(site)),
    },
    site: { name: site.title, url: url('/') },
  });
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
