import type { Document } from '../content/document.ts';
import type { SiteData } from './context.ts';
import { activityStreamsId } from './documents.ts';
import {
  absoluteUrl,
  contentEtag,
  isNotModified,
  lastModifiedOf,
  latestModified,
} from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';
import { sanitizeCommentHtml } from './sanitize.ts';

/**
 * The three syndication formats the public site serves.
 *
 * Feeds are fixed routes rather than representations (doc-3): a feed reader
 * sends whatever `Accept` header its HTTP library happened to default to, so
 * the URL has to say which format it wants.
 *
 * RSS is first because it is what the subscribers of a site moving off
 * WordPress actually hold, and it is what the bare `/feed/` serves.
 */
export type FeedFormat = 'rss' | 'atom' | 'json';

/** Every format, RSS first, in the order a page should advertise them. */
export const FEED_FORMATS: readonly FeedFormat[] = ['rss', 'atom', 'json'];

/** The segment every feed URL hangs off its listing root by: `/feed/…`. */
export const FEED_SEGMENT = 'feed';

/**
 * The segment under `feed/` each format lives at.
 *
 * RSS has none, so the bare `/feed/` is RSS 2.0 — WordPress's layout, and the
 * URL every existing subscriber of a migrated site already polls.
 */
export const FEED_SEGMENTS: Readonly<Record<FeedFormat, string>> = {
  rss: '',
  atom: 'atom',
  json: 'json',
};

/**
 * Spellings WordPress also answered on, which this site redirects rather than
 * serves. `/feed/rss/` was its alias for the RSS 2.0 feed.
 */
export const FEED_ALIASES: Readonly<Record<string, FeedFormat>> = {
  rss: 'rss',
};

/**
 * The root the site-wide comments feed hangs off, so `/comments/feed/` is the
 * URL WordPress served it at. It is a listing root like any other as far as
 * {@link feedPathUnder} is concerned; nothing is served at the root itself.
 */
export const COMMENTS_ROOT = '/comments/';

/** What a post's comments feed calls itself, before the post's title. */
export const COMMENTS_TITLE_PREFIX = 'Comments on: ';

/** What each format is labelled with on the wire. */
export const FEED_CONTENT_TYPES: Readonly<Record<FeedFormat, string>> = {
  rss: 'application/rss+xml; charset=utf-8',
  atom: 'application/atom+xml; charset=utf-8',
  json: 'application/feed+json; charset=utf-8',
};

/**
 * The URL of one format's feed under a listing root.
 *
 * The root is any listing URL ending in `/` — the site root, a taxonomy
 * archive, and in time a post's permalink for its comments feed — so this is
 * the one place the `/feed/…/` shape is spelled.
 */
export function feedPathUnder(root: string, format: FeedFormat): string {
  const segment = FEED_SEGMENTS[format];
  return `${root}${FEED_SEGMENT}/${segment === '' ? '' : `${segment}/`}`;
}

/**
 * The URL of a comments feed: one post's, or — with no permalink — the whole
 * site's.
 *
 * WordPress's URLs, so a site migrated from it keeps both. There is one format,
 * RSS 2.0, because that is what a comments feed is read in.
 */
export function commentsFeedPath(permalink?: string): string {
  return feedPathUnder(permalink ?? COMMENTS_ROOT, 'rss');
}

/** A feed URL taken apart: which listing it syndicates, and in what format. */
export interface FeedPath {
  /** The listing root the feed hangs off, ending in `/`. */
  root: string;
  /** Which format the URL asked for. */
  format: FeedFormat;
  /**
   * Whether this is the canonical spelling of that feed. `/feed/rss/` is not:
   * it is a WordPress alias, and it earns a redirect rather than a body.
   */
  canonical: boolean;
}

/**
 * A path as the feed it names, or `undefined` when it names none.
 *
 * The inverse of {@link feedPathUnder}, and deliberately ignorant of what the
 * root turns out to be: the caller decides whether `/tag/x/` is a listing it
 * serves. Only the slashed form parses; the bare `/feed` is handled by the
 * canonical redirect, like every other missing trailing slash on the site.
 */
export function splitFeedPath(pathname: string): FeedPath | undefined {
  if (!pathname.endsWith('/')) return undefined;

  const segments = pathname.slice(0, -1).split('/');
  const last = segments.pop() ?? '';

  if (last === FEED_SEGMENT) {
    return { root: `${segments.join('/')}/`, format: 'rss', canonical: true };
  }
  if (segments.pop() !== FEED_SEGMENT) return undefined;
  const root = `${segments.join('/')}/`;

  for (const format of FEED_FORMATS) {
    if (FEED_SEGMENTS[format] === last) return { root, format, canonical: true };
  }

  const alias = FEED_ALIASES[last];
  return alias === undefined ? undefined : { root, format: alias, canonical: false };
}

/** The media type a format is labelled with, without the charset. */
export function contentTypeOf(format: FeedFormat): string {
  return FEED_CONTENT_TYPES[format].split(';')[0] ?? '';
}

/** The `version` every JSON Feed this CMS writes declares. */
export const JSON_FEED_VERSION = 'https://jsonfeed.org/version/1.1';

/** What JSON Feed 1.1 calls the protocol the notify server's hub speaks. */
export const JSON_FEED_HUB_TYPE = 'WebSub';

/**
 * Dave Winer's `source` namespace, which RSS 2.0 feeds here declare so an item
 * can carry the Markdown it was written from. TASK-38's `source:cloud` is the
 * same namespace.
 */
export const SOURCE_NAMESPACE = 'https://source.scripting.com/';

/** Dublin Core, which is where an RSS item's `creator` comes from. */
export const DC_NAMESPACE = 'http://purl.org/dc/elements/1.1/';

/**
 * The Well-Formed Web comment API, whose `commentRss` is how an RSS reader is
 * told where one item's comments are. WordPress puts it on every item, so a
 * reader that already understands a WordPress feed understands this one.
 */
export const WFW_NAMESPACE = 'http://wellformedweb.org/CommentAPI/';

/**
 * The notify server a site advertises and pings when it has not said
 * otherwise: the one this CMS's author runs, which speaks both rssCloud and
 * WebSub, so one server covers every real-time subscriber a feed has.
 */
export const DEFAULT_NOTIFY_SERVER = 'https://rpc.rsscloud.io';

/** The three paths a notify server answers on, under whatever URL it lives at. */
export const NOTIFY_PATHS = {
  /** Where a subscriber registers for rssCloud notifications. */
  pleaseNotify: 'pleaseNotify',
  /** The WebSub hub: where a subscriber subscribes, and a publisher publishes. */
  hub: 'websub',
  /** Where this site says a feed changed. */
  ping: 'ping',
} as const;

/**
 * The port and protocol the legacy `<cloud>` element carries, whatever scheme
 * the server itself is reached over.
 *
 * rpc.rsscloud.io's quick start prescribes exactly these: the element predates
 * TLS being the default, and a reader that understands it is looking for the
 * shape rather than for a port to dial.
 */
export const NOTIFY_CLOUD_PORT = 80;

/** The `protocol` of that same element. */
export const NOTIFY_CLOUD_PROTOCOL = 'http-post';

/** One notify server, as the three vocabularies that talk to it spell it. */
export interface NotifyServer {
  /** The server's URL, without a trailing slash. What the setting holds. */
  base: string;
  /** Where an rssCloud subscriber registers: `source:cloud`. */
  pleaseNotify: string;
  /** The WebSub hub: `atom:link rel="hub"` and JSON Feed's `hubs`. */
  hub: string;
  /** Where this site announces that a feed changed. */
  ping: string;
  /** The same registration endpoint, taken apart for RSS's `<cloud>`. */
  cloud: {
    /** The server's host name. */
    domain: string;
    /** Always {@link NOTIFY_CLOUD_PORT}. */
    port: number;
    /** The registration path, from the root of that host. */
    path: string;
    /** Empty: the REST endpoint takes no procedure name. */
    registerProcedure: string;
    /** Always {@link NOTIFY_CLOUD_PROTOCOL}. */
    protocol: string;
  };
}

/**
 * One notify server URL as everything derived from it, or `undefined` when
 * there is no server: an empty setting is how a site turns the whole feature
 * off, and a value that is not an absolute http(s) URL is treated the same way
 * rather than published as nonsense.
 */
export function notifyEndpoints(server: string): NotifyServer | undefined {
  const trimmed = server.trim();
  if (trimmed === '') return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const base = url.origin + path;

  return {
    base,
    pleaseNotify: `${base}/${NOTIFY_PATHS.pleaseNotify}`,
    hub: `${base}/${NOTIFY_PATHS.hub}`,
    ping: `${base}/${NOTIFY_PATHS.ping}`,
    cloud: {
      domain: url.hostname,
      port: NOTIFY_CLOUD_PORT,
      path: `${path}/${NOTIFY_PATHS.pleaseNotify}`,
      registerProcedure: '',
      protocol: NOTIFY_CLOUD_PROTOCOL,
    },
  };
}

/**
 * The notify server this site's feeds advertise, from `notifyServer` in
 * `content/_data/site.json`.
 *
 * An empty value is a site that turned real-time notification off; a missing
 * key is a site that has never said, and gets {@link DEFAULT_NOTIFY_SERVER}.
 * That is the same rule the settings read the file by, so the server the feeds
 * advertise is always the server the CMS pings.
 */
export function notifyServerOf(site: SiteData): NotifyServer | undefined {
  const configured = site['notifyServer'];
  if (configured === undefined) return notifyEndpoints(DEFAULT_NOTIFY_SERVER);
  return typeof configured === 'string' ? notifyEndpoints(configured) : undefined;
}

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
  /**
   * How many replies each document has, by permalink, for the comment
   * pointers every RSS item carries.
   *
   * Resolved rather than looked up while the feed is written, because the
   * counts are part of the feed's own validator: a post that has been answered
   * since is a changed feed even though no post moved.
   */
  commentCounts?: ReadonlyMap<string, number> | undefined;
}

/**
 * The instant a feed reports as its own `updated`.
 *
 * An empty feed still has to carry one, and it has to be the same on every
 * request or the ETag would change while nothing did, so it is the epoch
 * rather than the clock.
 */
const EMPTY_FEED_UPDATED = new Date(0);

/** The language a feed declares when the site does not name one. */
export const DEFAULT_FEED_LANGUAGE = 'en';

/**
 * How many words of the rendered text an excerpt keeps when a post carries no
 * `description`. WordPress's own excerpt length, so a migrated site's feed
 * reads the same.
 */
export const EXCERPT_WORDS = 55;

/** The language tag a feed declares: the site's, or {@link DEFAULT_FEED_LANGUAGE}. */
export function feedLanguage(site: SiteData): string {
  const configured = site['language'];
  return typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : DEFAULT_FEED_LANGUAGE;
}

/**
 * The plain-text summary an RSS `<description>` carries.
 *
 * The `description` front matter when the post has one — it is what the author
 * wrote for exactly this — and otherwise the first paragraph of the rendered
 * body, stripped to text and cut where WordPress cuts an excerpt. Never the
 * whole post: `<content:encoded>` is where the whole post goes, and a reader
 * that shows both should have something to choose between.
 */
export function feedExcerpt(document: Document): string {
  if (document.description !== undefined) return document.description;
  return excerptFromHtml(document.html);
}

/**
 * The first paragraph of some HTML as plain text, cut where WordPress cuts an
 * excerpt. What a post falls back to when it carries no `description`, and
 * what a comment — which never carries one — always uses.
 */
export function excerptFromHtml(html: string): string {
  // Tags are dropped rather than replaced by a space: the markup inside a
  // paragraph is inline, and "now</span>," is one word followed by a comma.
  // What separates the words is the whitespace the renderer already put
  // between its block tags, which the collapse below turns into single spaces.
  const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? html;
  const text = decodeHtmlText(paragraph.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return '';

  const words = text.split(' ');
  return words.length <= EXCERPT_WORDS ? text : `${words.slice(0, EXCERPT_WORDS).join(' ')} …`;
}

/**
 * The five named entities the Markdown renderer emits, resolved.
 *
 * An excerpt is text rather than markup, so `&amp;` in the rendered HTML has
 * to become `&` here before {@link escapeXml} puts it back: leaving it would
 * publish a summary reading "Fish &amp;amp; chips".
 */
function decodeHtmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * A date as RFC 822, which is what RSS 2.0's `pubDate` and `lastBuildDate`
 * are. `toUTCString` writes exactly that spelling, `GMT` zone included.
 */
export function rfc822(date: Date): string {
  return date.toUTCString();
}

/** One feed as an RSS 2.0 document. */
export function rssFeed(source: FeedSource): string {
  const { site, documents, baseUrl } = source;
  const link = absoluteUrl(source.href, baseUrl);
  const built = latestModified(documents) ?? EMPTY_FEED_UPDATED;

  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"',
    '     xmlns:atom="http://www.w3.org/2005/Atom"',
    '     xmlns:content="http://purl.org/rss/1.0/modules/content/"',
    `     xmlns:dc="${DC_NAMESPACE}"`,
    `     xmlns:source="${SOURCE_NAMESPACE}"`,
    `     xmlns:wfw="${WFW_NAMESPACE}">`,
    '  <channel>',
    element('title', source.title, 2),
    element('link', link, 2),
    // Required by the spec even when the site has no tagline, so it is written
    // empty rather than left out.
    element('description', site.tagline ?? '', 2),
    element('language', feedLanguage(site), 2),
    element('lastBuildDate', rfc822(built), 2),
    element('generator', FEED_GENERATOR, 2),
    `    <atom:link rel="self" type="${escapeXml(
      contentTypeOf('rss'),
    )}" href="${escapeXml(absoluteUrl(source.feedHref, baseUrl))}"/>`,
    ...cloudElements(site),
    ...channelImage(source, link),
  ];

  for (const document of documents) {
    lines.push(...rssItem(document, source));
  }

  lines.push('  </channel>', '</rss>', '');
  return lines.join('\n');
}

/**
 * The notify server, said the three ways an RSS channel can say it: the legacy
 * `<cloud>` a 2001 aggregator understands, `<source:cloud>` for one that reads
 * Dave Winer's namespace, and the WebSub `rel="hub"` link.
 *
 * All three name the same server, so a subscriber gets told the moment the
 * feed changes whichever of the protocols it speaks. Nothing at all when the
 * site names no server.
 */
function cloudElements(site: SiteData): string[] {
  const notify = notifyServerOf(site);
  if (notify === undefined) return [];
  const { cloud } = notify;

  return [
    `    <cloud domain="${escapeXml(cloud.domain)}" port="${String(cloud.port)}"` +
      ` path="${escapeXml(cloud.path)}"` +
      ` registerProcedure="${escapeXml(cloud.registerProcedure)}"` +
      ` protocol="${escapeXml(cloud.protocol)}"/>`,
    element('source:cloud', notify.pleaseNotify, 2),
    `    <atom:link rel="hub" href="${escapeXml(notify.hub)}"/>`,
  ];
}

/**
 * The channel's `<image>`, from the site's avatar.
 *
 * RSS wants the title and the link to repeat the channel's own, and a reader
 * that shows a feed icon is showing the site's face; the avatar setting is the
 * only picture a site names.
 */
function channelImage(source: FeedSource, link: string): string[] {
  const avatar = source.site.avatar;
  if (avatar === undefined || avatar === '') return [];

  return [
    '    <image>',
    element('url', absoluteUrl(avatar, source.baseUrl), 3),
    element('title', source.title, 3),
    element('link', link, 3),
    '    </image>',
  ];
}

/** One document as an RSS item. */
function rssItem(document: Document, source: FeedSource): string[] {
  const { site, baseUrl } = source;
  const url = absoluteUrl(document.permalink, baseUrl);
  const published = document.date === undefined ? undefined : new Date(document.date);
  // The ActivityStreams object id rather than the permalink: it is minted from
  // the slug and written back on the first delivery, so it survives a post
  // being moved, and a reader that has already seen the item will not show it
  // again. `isPermaLink="false"` is what says it is a name, not an address.
  const guid = activityStreamsId(document, baseUrl) ?? url;
  const creator = document.author ?? site.author;

  return [
    '    <item>',
    element('title', document.title, 3),
    element('link', url, 3),
    `      <guid isPermaLink="false">${escapeXml(guid)}</guid>`,
    ...(published === undefined || Number.isNaN(published.getTime())
      ? []
      : [element('pubDate', rfc822(published), 3)]),
    ...(creator === undefined || creator === '' ? [] : [element('dc:creator', creator, 3)]),
    // Both taxonomies become categories. RSS has one `<category>` and no way
    // to say which vocabulary a term came from, which is exactly how WordPress
    // publishes tags and categories too.
    ...[...document.categories, ...document.tags].map(
      (term) => `      <category>${escapeXml(term)}</category>`,
    ),
    ...commentPointers(document, source),
    element('description', feedExcerpt(document), 3),
    `      <content:encoded>${cdata(document.html)}</content:encoded>`,
    // The source of the item, per the namespace: a reader that understands
    // Markdown should render from this rather than from the HTML above. It is
    // the same text the ActivityStreams `Article` carries as its `source`.
    `      <source:markdown>${cdata(document.body)}</source:markdown>`,
    '    </item>',
  ];
}

/** Everything one comments feed is built from. */
export interface CommentFeedSource {
  /** Site-wide data, for the description and the language. */
  site: SiteData;
  /** The comments, newest first. Their HTML is sanitised here, not before. */
  comments: readonly FeedComment[];
  /** Title of this feed: `Comments on: {post}`, or the site's. */
  title: string;
  /** Path of the HTML page these comments are about. */
  href: string;
  /** Path of the feed itself, for the self link. */
  feedHref: string;
  /** The site's public origin, for absolute links. */
  baseUrl: string;
}

/** One comment, as a feed shows it. */
export interface FeedComment {
  /** The reply's own name in the fediverse: the `guid`. */
  id: string;
  /** Where it can be read. */
  url: string;
  /** Who wrote it. */
  author: string;
  /** When it was published. */
  published: Date;
  /** What it says, as its own server rendered it and before sanitising. */
  html: string;
  /**
   * The post it answers, named on every item of the site-wide feed and on none
   * of a post's own — there, every item answers the same post.
   */
  post?: { title: string; permalink: string } | undefined;
}

/** One comments feed as an RSS 2.0 document. */
export function commentsRssFeed(source: CommentFeedSource): string {
  const { site, comments, baseUrl } = source;
  const link = absoluteUrl(source.href, baseUrl);
  const built = comments[0]?.published ?? EMPTY_FEED_UPDATED;

  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"',
    '     xmlns:atom="http://www.w3.org/2005/Atom"',
    '     xmlns:content="http://purl.org/rss/1.0/modules/content/"',
    `     xmlns:dc="${DC_NAMESPACE}"`,
    `     xmlns:source="${SOURCE_NAMESPACE}">`,
    '  <channel>',
    element('title', source.title, 2),
    element('link', link, 2),
    element('description', site.tagline ?? '', 2),
    element('language', feedLanguage(site), 2),
    element('lastBuildDate', rfc822(built), 2),
    element('generator', FEED_GENERATOR, 2),
    `    <atom:link rel="self" type="${escapeXml(
      contentTypeOf('rss'),
    )}" href="${escapeXml(absoluteUrl(source.feedHref, baseUrl))}"/>`,
    // A comments feed is polled like any other, so it advertises the same
    // server: a subscriber to one is told a reply arrived rather than finding
    // out on its next poll.
    ...cloudElements(site),
  ];

  for (const comment of comments) lines.push(...commentItem(comment));

  lines.push('  </channel>', '</rss>', '');
  return lines.join('\n');
}

/**
 * One comment as an RSS item.
 *
 * The sanitising happens here, at the last moment before the markup a stranger
 * wrote becomes bytes this site publishes, so there is one place to check
 * rather than one per caller.
 */
function commentItem(comment: FeedComment): string[] {
  const html = sanitizeCommentHtml(comment.html);
  const title =
    comment.post === undefined ? comment.author : `${comment.author} on ${comment.post.title}`;

  return [
    '    <item>',
    element('title', title, 3),
    element('link', comment.url, 3),
    // A reply's id is a name rather than an address: some servers publish a
    // note at an id nothing dereferences and a `url` somewhere else entirely.
    `      <guid isPermaLink="false">${escapeXml(comment.id)}</guid>`,
    element('pubDate', rfc822(comment.published), 3),
    element('dc:creator', comment.author, 3),
    element('description', excerptFromHtml(html), 3),
    `      <content:encoded>${cdata(html)}</content:encoded>`,
    '    </item>',
  ];
}

/**
 * Where one item's comments are, said three ways.
 *
 * `<comments>` is the page a person should read them on and `wfw:commentRss`
 * the feed a reader should poll, which is the pair WordPress publishes and so
 * the pair every reader already understands. `source:comments` is the same
 * feed with the count beside it, so a reader can say "3 comments" without
 * fetching anything.
 *
 * Written only when the source carries counts: a feed whose builder did not
 * resolve them would otherwise publish "0 comments" about a post with plenty.
 */
function commentPointers(document: Document, source: FeedSource): string[] {
  const counts = source.commentCounts;
  if (counts === undefined) return [];

  const feed = absoluteUrl(feedPathUnder(document.permalink, 'rss'), source.baseUrl);
  const page = `${absoluteUrl(document.permalink, source.baseUrl)}#comments`;

  return [
    element('comments', page, 3),
    element('wfw:commentRss', feed, 3),
    `      <source:comments count="${String(counts.get(document.permalink) ?? 0)}" ` +
      `feedUrl="${escapeXml(feed)}"/>`,
  ];
}

/** One feed as an Atom 1.0 document. */
export function atomFeed(source: FeedSource): string {
  const { site, documents, baseUrl } = source;
  const updated = latestModified(documents) ?? EMPTY_FEED_UPDATED;

  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom"`,
    `      xmlns:source="${SOURCE_NAMESPACE}"`,
    `      xml:lang="${escapeXml(feedLanguage(site))}">`,
    element('id', absoluteUrl(source.href, baseUrl)),
    element('title', source.title),
    ...optionalElement('subtitle', site.tagline),
    element('updated', updated.toISOString()),
    link({
      rel: 'self',
      type: contentTypeOf('atom'),
      href: absoluteUrl(source.feedHref, baseUrl),
    }),
    link({ rel: 'alternate', type: 'text/html', href: absoluteUrl(source.href, baseUrl) }),
    ...atomCloud(site),
    `  <generator uri="${escapeXml(FEED_GENERATOR_URI)}">${escapeXml(FEED_GENERATOR)}</generator>`,
    ...author(site.author, 1),
  ];

  for (const document of documents) {
    lines.push(...atomEntry(document, baseUrl));
  }

  lines.push('</feed>', '');
  return lines.join('\n');
}

/**
 * The notify server as an Atom feed can say it: the `rel="hub"` link WebSub
 * defines, and `<source:cloud>`, which is namespaced and so belongs here as
 * much as in RSS. The legacy `<cloud>` is not: it is an RSS 2.0 element with
 * no namespace, and Atom has nowhere to put it.
 */
function atomCloud(site: SiteData): string[] {
  const notify = notifyServerOf(site);
  if (notify === undefined) return [];

  return [element('source:cloud', notify.pleaseNotify), link({ rel: 'hub', href: notify.hub })];
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
  /**
   * Where a subscriber can be told the feed changed rather than polling it.
   * One entry, the site's notify server, when it names one.
   */
  hubs?: JsonFeedHub[];
  /** The entries, newest first. */
  items: JsonFeedItem[];
}

/**
 * A real-time endpoint, as JSON Feed 1.1 models one. `type` names the protocol
 * rather than a media type, and `WebSub` is the one this CMS's server speaks.
 */
export interface JsonFeedHub {
  /** The protocol: `WebSub`. */
  type: string;
  /** The hub's URL. */
  url: string;
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
  const notify = notifyServerOf(site);

  return {
    version: JSON_FEED_VERSION,
    title: source.title,
    home_page_url: absoluteUrl(source.href, baseUrl),
    feed_url: absoluteUrl(source.feedHref, baseUrl),
    ...(site.tagline === undefined ? {} : { description: site.tagline }),
    ...(site.author === undefined ? {} : { authors: [{ name: site.author }] }),
    ...(notify === undefined ? {} : { hubs: [{ type: JSON_FEED_HUB_TYPE, url: notify.hub }] }),
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
  const headers = feedHeaders(source, etag, lastModified);

  if (isNotModified(options.conditional, etag, lastModified)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', FEED_CONTENT_TYPES[format]);
  const body =
    format === 'rss'
      ? rssFeed(source)
      : format === 'atom'
        ? atomFeed(source)
        : `${JSON.stringify(jsonFeed(source), undefined, 2)}\n`;

  return new Response(body, { headers });
}

/**
 * One comments feed as an HTTP response.
 *
 * Comments arrive from other people's servers rather than from the site's own
 * files, so the validator is built from the comments themselves; a feed with
 * none still has one, which is what makes an empty comments feed cheap to poll.
 */
export function commentsFeedResponse(
  source: CommentFeedSource,
  conditional?: ConditionalHeaders,
): Response {
  const etag = contentEtag('comments:rss', commentsFingerprint(source));
  const lastModified = source.comments[0]?.published;
  const headers = feedHeaders(source, etag, lastModified);

  if (isNotModified(conditional, etag, lastModified)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', FEED_CONTENT_TYPES.rss);
  return new Response(commentsRssFeed(source), { headers });
}

/** Enough of any feed to say where it lives: what a header needs from one. */
export type FeedIdentity = Pick<FeedSource, 'site' | 'feedHref' | 'baseUrl'>;

/**
 * The headers every feed response carries, whichever kind of feed it is and
 * whether it becomes a body or a 304.
 *
 * They are built in one place, and before the conditional is decided, because
 * a poller mostly gets the 304 — and a 304 that dropped the hub would hide the
 * one thing that stops it polling.
 */
function feedHeaders(source: FeedIdentity, etag: string, lastModified: Date | undefined): Headers {
  const headers = new Headers({ etag, 'cache-control': 'no-cache' });
  if (lastModified !== undefined) headers.set('last-modified', lastModified.toUTCString());

  const link = feedLinkHeader(source);
  if (link !== undefined) headers.set('link', link);

  return headers;
}

/**
 * WebSub's discovery header: the hub and the feed's own URL, in that order.
 *
 * A subscriber is meant to find both without parsing the body, which is the
 * only way a JSON Feed or a 304 could tell it anything at all. `undefined`
 * when the site names no notify server.
 */
export function feedLinkHeader(source: FeedIdentity): string | undefined {
  const notify = notifyServerOf(source.site);
  if (notify === undefined) return undefined;

  const self = absoluteUrl(source.feedHref, source.baseUrl);
  return `<${notify.hub}>; rel="hub", <${self}>; rel="self"`;
}

/** What a comments feed is made of, as one string to hash. */
function commentsFingerprint(source: CommentFeedSource): string {
  return [
    source.feedHref,
    source.title,
    source.site.tagline ?? '',
    feedLanguage(source.site),
    notifyServerOf(source.site)?.base ?? '',
    source.baseUrl,
    ...source.comments.map((comment) =>
      [comment.id, comment.author, comment.published.toISOString(), comment.html].join('\0'),
    ),
  ].join('\n');
}

/** What a feed is made of, as one string to hash. */
function feedFingerprint(source: FeedSource): string {
  return [
    source.feedHref,
    source.title,
    source.site.tagline ?? '',
    source.site.author ?? '',
    source.site.avatar ?? '',
    feedLanguage(source.site),
    notifyServerOf(source.site)?.base ?? '',
    source.baseUrl,
    ...source.documents.map(
      (document) =>
        `${document.hash} ${String(source.commentCounts?.get(document.permalink) ?? 0)}`,
    ),
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

/**
 * Character data as a CDATA section, which is how a feed carries markup a
 * reader is meant to render rather than display.
 *
 * The only sequence a section may not contain is its own terminator, so a
 * `]]>` in the text is split across two sections; the parser rejoins them and
 * the reader sees the original bytes. Characters XML 1.0 cannot represent are
 * dropped, exactly as {@link escapeXml} drops them, because CDATA suspends
 * escaping and not the character set.
 */
export function cdata(value: string): string {
  let text = '';
  for (const character of value) {
    if (isValidXmlChar(character)) text += character;
  }
  return `<![CDATA[${text.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
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

/** An Atom `<link>`. The `type` is left off when there is nothing to declare. */
function link(attributes: { rel: string; type?: string; href: string }, depth = 1): string {
  const type = attributes.type === undefined ? '' : ` type="${escapeXml(attributes.type)}"`;
  return `${'  '.repeat(depth)}<link rel="${escapeXml(
    attributes.rel,
  )}"${type} href="${escapeXml(attributes.href)}"/>`;
}

/** An Atom `<author>`, or nothing when nobody is named. */
function author(name: string | undefined, depth: number): string[] {
  if (name === undefined) return [];
  const indent = '  '.repeat(depth);
  return [`${indent}<author>`, element('name', name, depth + 1), `${indent}</author>`];
}
