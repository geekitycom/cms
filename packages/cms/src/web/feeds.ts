import type { Document } from '../content/document.ts';
import type { SiteData } from './context.ts';
import {
  absoluteUrl,
  contentEtag,
  isNotModified,
  lastModifiedOf,
  latestModified,
} from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';

/**
 * The two syndication formats the public site serves.
 *
 * Feeds are fixed routes rather than representations (doc-3): a feed reader
 * sends whatever `Accept` header its HTTP library happened to default to, so
 * the URL has to say which format it wants.
 */
export type FeedFormat = 'atom' | 'json';

/** The file name each format is served under, at the site root and per tag. */
export const FEED_FILES: Readonly<Record<FeedFormat, string>> = {
  atom: 'feed.xml',
  json: 'feed.json',
};

/** What each format is labelled with on the wire. */
export const FEED_CONTENT_TYPES: Readonly<Record<FeedFormat, string>> = {
  atom: 'application/atom+xml; charset=utf-8',
  json: 'application/feed+json; charset=utf-8',
};

/** The `version` every JSON Feed this CMS writes declares. */
export const JSON_FEED_VERSION = 'https://jsonfeed.org/version/1.1';

/** How many entries a feed carries when the site does not say. */
export const DEFAULT_FEED_SIZE = 20;

/** What the feeds name themselves as. */
export const FEED_GENERATOR = 'Geekity';

/** Where a reader can go to find out what wrote the feed. */
export const FEED_GENERATOR_URI = 'https://www.npmjs.com/package/@geekity/cms';

/**
 * How many entries a feed carries.
 *
 * `feedSize` in `content/_data/site.json` wins; without it a feed is longer
 * than an archive page, because a reader that polls once a day should not miss
 * a post on a site that publishes several.
 */
export function feedSize(site: SiteData): number {
  const configured = site['feedSize'];
  if (typeof configured === 'number' && Number.isInteger(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_FEED_SIZE;
}

/** Everything one feed is built from, whichever format it ends up in. */
export interface FeedSource {
  /** Site-wide data, for the title, subtitle and author. */
  site: SiteData;
  /** The entries, newest first. Already filtered to what the public may see. */
  documents: readonly Document[];
  /** Title of this feed. The site title, or the site title and the tag. */
  title: string;
  /** Path of the HTML page this feed syndicates: `/` or `/tags/{tag}/`. */
  href: string;
  /** Path of the feed itself, for the self link. */
  feedHref: string;
  /** The site's public origin, for absolute ids and links. */
  baseUrl: string;
}

/**
 * The instant a feed reports as its own `updated`.
 *
 * An empty feed still has to carry one, and it has to be the same on every
 * request or the ETag would change while nothing did, so it is the epoch
 * rather than the clock.
 */
const EMPTY_FEED_UPDATED = new Date(0);

/** One feed as an Atom 1.0 document. */
export function atomFeed(source: FeedSource): string {
  const { site, documents, baseUrl } = source;
  const updated = latestModified(documents) ?? EMPTY_FEED_UPDATED;

  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    element('id', absoluteUrl(source.href, baseUrl)),
    element('title', source.title),
    ...optionalElement('subtitle', site.tagline),
    element('updated', updated.toISOString()),
    link({
      rel: 'self',
      type: FEED_CONTENT_TYPES.atom.split(';')[0] ?? '',
      href: absoluteUrl(source.feedHref, baseUrl),
    }),
    link({ rel: 'alternate', type: 'text/html', href: absoluteUrl(source.href, baseUrl) }),
    `  <generator uri="${escapeXml(FEED_GENERATOR_URI)}">${escapeXml(FEED_GENERATOR)}</generator>`,
    ...author(site.author, 1),
  ];

  for (const document of documents) {
    lines.push(...atomEntry(document, baseUrl));
  }

  lines.push('</feed>', '');
  return lines.join('\n');
}

/** One document as an Atom entry. */
function atomEntry(document: Document, baseUrl: string): string[] {
  const url = absoluteUrl(document.permalink, baseUrl);
  const updated = lastModifiedOf(document) ?? EMPTY_FEED_UPDATED;
  const published = document.date === undefined ? undefined : new Date(document.date);

  return [
    '  <entry>',
    element('id', url, 2),
    element('title', document.title, 2),
    element('updated', updated.toISOString(), 2),
    ...(published === undefined || Number.isNaN(published.getTime())
      ? []
      : [element('published', published.toISOString(), 2)]),
    link({ rel: 'alternate', type: 'text/html', href: url }, 2),
    ...author(document.author, 2),
    ...document.tags.map((tag) => `    <category term="${escapeXml(tag)}"/>`),
    ...(document.description === undefined
      ? []
      : [`    <summary type="text">${escapeXml(document.description)}</summary>`]),
    // `type="html"` means the markup is escaped rather than inlined, so a
    // reader that does not parse XHTML still gets the whole post.
    `    <content type="html">${escapeXml(document.html)}</content>`,
    '  </entry>',
  ];
}

/** A JSON Feed 1.1 document. */
export interface JsonFeed {
  /** {@link JSON_FEED_VERSION}. */
  version: string;
  /** The feed's name. */
  title: string;
  /** The HTML page this feed syndicates. */
  home_page_url: string;
  /** Where this feed itself lives. */
  feed_url: string;
  /** The site's tagline, when it has one. */
  description?: string;
  /** Site-level authors, when the site names one. */
  authors?: JsonFeedAuthor[];
  /** The entries, newest first. */
  items: JsonFeedItem[];
}

/** An author, as JSON Feed 1.1 models one. */
export interface JsonFeedAuthor {
  name: string;
}

/** One entry of a {@link JsonFeed}. */
export interface JsonFeedItem {
  /** Permanent identifier: the document's absolute URL. */
  id: string;
  /** Where the entry can be read. */
  url: string;
  /** Display title. */
  title: string;
  /** The rendered body. */
  content_html: string;
  /** The document's description, when it has one. */
  summary?: string;
  /** Publish date, RFC 3339. */
  date_published?: string;
  /** Last modification date, RFC 3339. */
  date_modified?: string;
  /** The document's tags, in file order. */
  tags?: string[];
  /** The document's own author, when it names one. */
  authors?: JsonFeedAuthor[];
}

/** One feed as a JSON Feed 1.1 document. */
export function jsonFeed(source: FeedSource): JsonFeed {
  const { site, baseUrl } = source;

  return {
    version: JSON_FEED_VERSION,
    title: source.title,
    home_page_url: absoluteUrl(source.href, baseUrl),
    feed_url: absoluteUrl(source.feedHref, baseUrl),
    ...(site.tagline === undefined ? {} : { description: site.tagline }),
    ...(site.author === undefined ? {} : { authors: [{ name: site.author }] }),
    items: source.documents.map((document) => jsonFeedItem(document, baseUrl)),
  };
}

/** One document as a JSON Feed item. */
function jsonFeedItem(document: Document, baseUrl: string): JsonFeedItem {
  const url = absoluteUrl(document.permalink, baseUrl);

  const item: JsonFeedItem = {
    id: url,
    url,
    title: document.title,
    content_html: document.html,
  };

  if (document.description !== undefined) item.summary = document.description;

  const published = document.date === undefined ? undefined : new Date(document.date);
  if (published !== undefined && !Number.isNaN(published.getTime())) {
    item.date_published = published.toISOString();
  }

  const modified = lastModifiedOf(document);
  if (modified !== undefined) item.date_modified = modified.toISOString();

  if (document.tags.length > 0) item.tags = [...document.tags];
  if (document.author !== undefined) item.authors = [{ name: document.author }];

  return item;
}

/** Everything one feed response needs. */
export interface FeedResponseOptions {
  /** Which format the body is. */
  format: FeedFormat;
  /** What the feed is built from, for the body and the validator alike. */
  source: FeedSource;
  /** The request's conditional headers, for the 304. */
  conditional?: ConditionalHeaders | undefined;
}

/**
 * One feed as an HTTP response, validator and conditional handling included.
 *
 * Feeds are polled far more often than they change, so the cheap 304 matters
 * more here than anywhere else on the site. The validator covers the documents
 * *and* the feed's own metadata, because a renamed site is a changed feed even
 * when no post moved.
 */
export function feedResponse(options: FeedResponseOptions): Response {
  const { format, source } = options;
  const etag = contentEtag(`feed:${format}`, feedFingerprint(source));
  const lastModified = latestModified(source.documents);

  const headers = new Headers({ etag, 'cache-control': 'no-cache' });
  if (lastModified !== undefined) headers.set('last-modified', lastModified.toUTCString());

  if (isNotModified(options.conditional, etag, lastModified)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', FEED_CONTENT_TYPES[format]);
  const body =
    format === 'atom' ? atomFeed(source) : `${JSON.stringify(jsonFeed(source), undefined, 2)}\n`;

  return new Response(body, { headers });
}

/** What a feed is made of, as one string to hash. */
function feedFingerprint(source: FeedSource): string {
  return [
    source.feedHref,
    source.title,
    source.site.tagline ?? '',
    source.site.author ?? '',
    source.baseUrl,
    ...source.documents.map((document) => document.hash),
  ].join('\n');
}

/**
 * XML character data, escaped.
 *
 * `<` and `&` have to go; `>` follows them because `]]>` in text is not
 * allowed and spotting it is not worth the trouble. Quotes are escaped too so
 * one function serves attribute values as well as text. Characters XML 1.0
 * cannot represent at all — the C0 controls other than tab, newline and
 * carriage return — are dropped rather than escaped, because there is no
 * spelling of them that would parse.
 */
export function escapeXml(value: string): string {
  let out = '';
  for (const character of value) {
    switch (character) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&apos;';
        break;
      default:
        if (isValidXmlChar(character)) out += character;
    }
  }
  return out;
}

/** Whether a character is one XML 1.0 allows in a document at all. */
function isValidXmlChar(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (code === 0x9 || code === 0xa || code === 0xd) return true;
  if (code >= 0x20 && code <= 0xd7ff) return true;
  if (code >= 0xe000 && code <= 0xfffd) return true;
  return code >= 0x10000 && code <= 0x10ffff;
}

/** An element holding text, indented. */
function element(name: string, text: string, depth = 1): string {
  return `${'  '.repeat(depth)}<${name}>${escapeXml(text)}</${name}>`;
}

/** The same, or nothing at all when there is no value. */
function optionalElement(name: string, text: string | undefined, depth = 1): string[] {
  return text === undefined ? [] : [element(name, text, depth)];
}

/** An Atom `<link>`. */
function link(attributes: { rel: string; type: string; href: string }, depth = 1): string {
  return `${'  '.repeat(depth)}<link rel="${escapeXml(attributes.rel)}" type="${escapeXml(
    attributes.type,
  )}" href="${escapeXml(attributes.href)}"/>`;
}

/** An Atom `<author>`, or nothing when nobody is named. */
function author(name: string | undefined, depth: number): string[] {
  if (name === undefined) return [];
  const indent = '  '.repeat(depth);
  return [`${indent}<author>`, element('name', name, depth + 1), `${indent}</author>`];
}
