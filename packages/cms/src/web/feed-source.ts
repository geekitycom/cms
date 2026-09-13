import type { Document } from '../content/document.ts';
import type { SiteData } from './context.ts';

/**
 * What a feed is, before anything has been written: which formats the site
 * serves, where each one lives, what the site's settings say about it, and
 * what one feed is built from.
 *
 * Everything here is a fact about the feed as a whole — its URL, its language,
 * its notify server, its entries — rather than about any one item or any one
 * format. The serialisers and the response layer both read it, which is why it
 * sits below them and imports neither.
 */

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

/** The language a feed declares when the site does not name one. */
export const DEFAULT_FEED_LANGUAGE = 'en';

/** The language tag a feed declares: the site's, or {@link DEFAULT_FEED_LANGUAGE}. */
export function feedLanguage(site: SiteData): string {
  const configured = site['language'];
  return typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : DEFAULT_FEED_LANGUAGE;
}

/**
 * The instant a feed reports as its own `updated`.
 *
 * An empty feed still has to carry one, and it has to be the same on every
 * request or the ETag would change while nothing did, so it is the epoch
 * rather than the clock.
 */
export const EMPTY_FEED_UPDATED = new Date(0);

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

/** Enough of any feed to say where it lives: what a header needs from one. */
export type FeedIdentity = Pick<FeedSource, 'site' | 'feedHref' | 'baseUrl'>;
