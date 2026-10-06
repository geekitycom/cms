import { discoverPostType } from '../content/post-type.ts';
import type { CitedImage, CitedPicture, PictureSource } from './cited-picture.ts';
import { fetchPublic, webUrl } from './fetch-public.ts';
import { elementsIn, hasRel, parseHtml, textOf } from './html.ts';
import type { HtmlElement } from './html.ts';
import { citedEntry, citedEvent } from './microformats.ts';
import type { CitedEntry, CitedEvent } from './microformats.ts';
import { publicHost } from './public-address.ts';
import type { HostLookup } from './public-address.ts';

/**
 * Reply context: what a reply shows of the post it answers (TASK-123).
 *
 * The post is on somebody else's site, so this is the one place the CMS reads
 * a stranger's page on an author's behalf. It happens when a reply is saved or
 * synced, never while a page is served, and what it finds is kept in a file
 * (decision-19). Everything here fails soft: a target that cannot be read is a
 * reply with a bare link, never a save that fails.
 */

/** How long a target is given to answer, body included. */
export const REPLY_CONTEXT_TIMEOUT_MS = 10_000;

/**
 * The most of a target page that is read. Only the head of a bigger page is
 * read, and an oEmbed answer bigger than this is not read at all.
 */
export const REPLY_CONTEXT_MAX_BYTES = 1_000_000;

const IMAGE_TYPE = /^\s*image\//i;

/** How many words of a target's text a preview keeps. */
const EXCERPT_WORDS = 40;

/** And how many characters, for a text with few spaces in it. */
const EXCERPT_CHARACTERS = 300;

/** What a reply shows of the post it answers. */
export interface ReplyContext {
  /** The post answered: the reply's own `in-reply-to`, whatever it redirected to. */
  readonly url: string;
  /**
   * The original `url` is a copy of, when the copy names it and it lists the
   * copy back as its `u-syndication` (TASK-197). Every other field then
   * describes the original.
   */
  readonly original?: string;
  /** Its title, when it has one of its own; a note's name is its text. */
  readonly name?: string;
  /** A short excerpt of what it says, or the page's description. */
  readonly text?: string;
  /** Who wrote it. */
  readonly author?: CitedAuthor;
  /** When it says it was published, as an ISO 8601 instant. */
  readonly published?: string;
  /** The site it is on, its `og:site_name`, kept only when it names no author. */
  readonly site?: string;
  /**
   * When an event starts (TASK-198): an ISO 8601 instant when the page gives
   * a zone, else the date, or the date and time, as the page wrote them, which
   * no reader's zone may move.
   */
  readonly start?: string;
  /** Where an event takes place, as the page names it. */
  readonly location?: string;
  /** Its picture, copied into the site's uploads (TASK-252). */
  readonly picture?: CitedPicture;
}

export interface CitedAuthor {
  readonly name: string;
  /** Their page, when that is an http(s) URL. */
  readonly url?: string;
  /** Their fediverse handle, `user@host`, when the post is a fediverse object. */
  readonly handle?: string;
  /** Their avatar, copied into the site's uploads like a picture (TASK-199). */
  readonly photo?: CitedImage;
}

export type ReplyContextFetch =
  | {
      readonly ok: true;
      readonly context: ReplyContext;
      readonly picture?: PictureSource;
      /** Where the author's avatar is, for the caller to copy. */
      readonly authorPhoto?: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * A fediverse post as a citation shows it, read from the ActivityPub object a
 * cited page links. `html` is its content, markup and all.
 */
export interface FediversePost {
  readonly name?: string;
  readonly html?: string;
  readonly author?: {
    readonly name: string;
    readonly url?: string;
    readonly handle?: string;
    readonly photo?: string;
  };
  readonly published?: string;
  /** Its first image attachment. */
  readonly image?: string;
  /** Its `url`: the page it is shown at, which a bridged post points at its original with. */
  readonly url?: string;
}

/**
 * Read the ActivityPub object at a URL, or `undefined` when it is none. The
 * signal aborts at the cited page's one deadline.
 */
export type FediverseLookup = (
  url: string,
  signal: AbortSignal,
) => Promise<FediversePost | undefined>;

/** What {@link fetchReplyContext} needs. */
export interface FetchReplyContextOptions {
  /** How host names are resolved before they are trusted. */
  readonly lookup: HostLookup;
  /** Defaults to {@link REPLY_CONTEXT_TIMEOUT_MS}. */
  readonly timeoutMs?: number | undefined;
  /** Defaults to {@link REPLY_CONTEXT_MAX_BYTES}. */
  readonly maxBytes?: number | undefined;
  /** How a fediverse object is read; without one, none is. */
  readonly fediverse?: FediverseLookup | undefined;
}

interface Limits {
  readonly lookup: HostLookup;
  readonly deadline: number;
  readonly maxBytes: number;
}

/**
 * Fetch a page a post cites and read what it says about itself. A known
 * provider's oEmbed endpoint is asked first, and the page is read only when
 * that names nothing. Any other page is read, and when it has no `h-entry` it
 * is also asked about through the ActivityPub object and the oEmbed endpoint
 * it links. Each source fills only what the ones before it left empty:
 * `h-entry`, ActivityPub, oEmbed, JSON-LD, then the page's own metadata. A
 * silo copy of a post on another site is described by that original instead,
 * when the original lists the copy as its own (TASK-197).
 *
 * Only http and https, only public hosts (every redirect hop is checked, and a
 * name is refused when any address it resolves to is private), one timeout
 * over the whole exchange, every other request included, no more of a page
 * than the byte limit, and no oEmbed answer over it. Nothing throws.
 */
export async function fetchReplyContext(
  target: string,
  options: FetchReplyContextOptions,
): Promise<ReplyContextFetch> {
  const limits: Limits = {
    lookup: options.lookup,
    deadline: Date.now() + (options.timeoutMs ?? REPLY_CONTEXT_TIMEOUT_MS),
    maxBytes: options.maxBytes ?? REPLY_CONTEXT_MAX_BYTES,
  };

  const known = knownEndpoint(target);
  if (known !== undefined) {
    const oembed = withoutSuffix(await fetchOembed(known.endpoint, limits), known.titleSuffix);
    const found = described(target, [oembedSource(oembed)]);
    if (found !== undefined) return found;
  }

  const read = await readPage(target, limits);
  if (!read.ok) return read;
  if (read.page === undefined) {
    return { ok: true, context: { url: target }, picture: { url: read.image, kind: 'photo' } };
  }

  const post = await fediversePostOf(read.page, options.fediverse, limits);
  const original =
    known === undefined ? await originalOf(target, read.page, post, limits) : undefined;
  if (original !== undefined) {
    const found = await describePage(
      target,
      original,
      await fediversePostOf(original, options.fediverse, limits),
      undefined,
      limits,
    );
    if (found !== undefined) {
      return { ...found, context: { ...found.context, original: original.url } };
    }
  }
  return (await describePage(target, read.page, post, known, limits)) ?? refuse('nothing to show');
}

interface HtmlPage {
  /** Where it was read from, after any redirects. */
  readonly url: string;
  readonly root: HtmlElement;
  readonly entry: CitedEntry | undefined;
  readonly event: CitedEvent | undefined;
}

type PageRead =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly page: HtmlPage }
  /** A URL that is an image, read no further than its headers. */
  | { readonly ok: true; readonly page?: undefined; readonly image: string };

async function readPage(url: string, limits: Limits): Promise<PageRead> {
  const timeoutMs = limits.deadline - Date.now();
  if (timeoutMs <= 0) return { ok: false, reason: 'timed out' };
  const fetched = await fetchPublic(url, {
    lookup: limits.lookup,
    timeoutMs,
    maxBytes: limits.maxBytes,
    overflow: 'truncate',
    accept: 'text/html, */*;q=0.8',
    contentType: {
      pattern: /^\s*(text\/html|application\/xhtml\+xml)/i,
      name: 'an HTML page',
    },
    headersOnly: IMAGE_TYPE,
  });
  if (!fetched.ok) return fetched;
  if (fetched.read === 'headers') return { ok: true, image: fetched.url };
  const root = parseHtml(new TextDecoder().decode(fetched.body));
  const entry = fetched.truncated ? undefined : citedEntry(root, fetched.url);
  const event = fetched.truncated ? undefined : citedEvent(root, fetched.url);
  return { ok: true, page: { url: fetched.url, root, entry, event } };
}

async function fediversePostOf(
  page: HtmlPage,
  lookupPost: FediverseLookup | undefined,
  limits: Limits,
): Promise<FediversePost | undefined> {
  if (page.entry !== undefined || lookupPost === undefined) return undefined;
  return await fetchFediversePost(activityLink(page.root, page.url), lookupPost, limits);
}

async function describePage(
  target: string,
  page: HtmlPage,
  post: FediversePost | undefined,
  known: KnownEndpoint | undefined,
  limits: Limits,
): Promise<Extract<ReplyContextFetch, { ok: true }> | undefined> {
  const { root, url, entry, event } = page;
  const endpoint =
    entry === undefined && known === undefined ? oembedEndpoint(root, url) : undefined;
  const oembed = endpoint === undefined ? undefined : await fetchOembed(endpoint, limits);
  return described(target, [
    entry === undefined ? undefined : entrySource(entry),
    event === undefined ? undefined : eventSource(event),
    post === undefined ? undefined : fediverseSource(post),
    oembedSource(oembed),
    jsonLdSource(root, url),
    jsonLdEventSource(root),
    pageSource(root, url),
  ]);
}

async function originalOf(
  target: string,
  page: HtmlPage,
  post: FediversePost | undefined,
  limits: Limits,
): Promise<HtmlPage | undefined> {
  const copyHosts = new Set([new URL(target).hostname, new URL(page.url).hostname]);
  const candidates = new Set<string>();
  for (const named of [
    ...(page.entry?.urls ?? []),
    post?.url,
    canonicalLink(page.root, page.url),
  ]) {
    const url = webUrl(named ?? '');
    if (url !== undefined && !copyHosts.has(url.hostname)) candidates.add(url.href);
  }

  const copyUrls = new Set([target, page.url]);
  for (const candidate of candidates) {
    const read = await readPage(candidate, limits);
    if (!read.ok || read.page === undefined) continue;
    if (syndicationOf(read.page).some((url) => copyUrls.has(url))) return read.page;
  }
  return undefined;
}

function syndicationOf(page: HtmlPage): string[] {
  const listed = [...(page.entry?.syndication ?? [])];
  for (const element of elementsIn(page.root)) {
    if ((element.name === 'a' || element.name === 'link') && hasRel(element, 'syndication')) {
      const url = resolved(element.attributes['href'], page.url);
      if (url !== undefined) listed.push(url);
    }
  }
  return listed.map((url) => webUrl(url)?.href ?? url);
}

function canonicalLink(root: HtmlElement, base: string): string | undefined {
  for (const element of elementsIn(root)) {
    if (element.name === 'link' && hasRel(element, 'canonical')) {
      return resolved(element.attributes['href'], base);
    }
  }
  return undefined;
}

function described(
  target: string,
  sources: readonly (Source | undefined)[],
): Extract<ReplyContextFetch, { ok: true }> | undefined {
  const { picture, photo, ...found } = merge(sources);
  const context = contextOf(target, found);
  if (context === undefined) return undefined;
  const authorPhoto = context.author === undefined ? undefined : webUrl(photo ?? '');
  return {
    ok: true,
    context,
    ...(picture === undefined ? {} : { picture }),
    ...(authorPhoto === undefined ? {} : { authorPhoto: authorPhoto.href }),
  };
}

interface Source {
  readonly name?: string | null;
  readonly text?: string;
  readonly author?: { readonly name: string; readonly url?: string; readonly handle?: string };
  /** The author's avatar, where it is on the web. */
  readonly photo?: string;
  readonly published?: string;
  readonly site?: string;
  readonly start?: string;
  readonly location?: string;
  readonly picture?: PictureSource;
}

function merge(sources: readonly (Source | undefined)[]): Source {
  let merged: Source = {};
  for (const source of sources) {
    if (source === undefined) continue;
    const { author, photo, ...fields } = source;
    const held = merged.author;
    const samePerson =
      author !== undefined &&
      (held === undefined || held.name.toLowerCase() === author.name.toLowerCase());
    merged = {
      ...fields,
      ...merged,
      ...(samePerson ? { author: { ...author, ...held } } : {}),
      ...(samePerson && merged.photo === undefined && photo !== undefined ? { photo } : {}),
    };
  }
  return merged;
}

function contextOf(
  target: string,
  found: Omit<Source, 'picture' | 'photo'>,
): ReplyContext | undefined {
  const name = typeof found.name === 'string' ? withoutDirectionControls(found.name) : '';
  const text = excerpt(withoutDirectionControls(found.text));
  const authorName = withoutDirectionControls(found.author?.name);
  const authorUrl = webUrl(found.author?.url ?? '');
  const handle = withoutDirectionControls(found.author?.handle);
  const published = instant(found.published);
  const author: CitedAuthor | undefined =
    authorName === ''
      ? undefined
      : {
          name: authorName,
          ...(authorUrl === undefined ? {} : { url: authorUrl.href }),
          ...(handle === '' ? {} : { handle }),
        };
  const site = author === undefined ? withoutDirectionControls(found.site) : '';
  const start = eventStart(found.start);
  const location = withoutDirectionControls(found.location);
  if (
    name === '' &&
    text === '' &&
    author === undefined &&
    published === undefined &&
    site === '' &&
    start === undefined &&
    location === ''
  ) {
    return undefined;
  }

  return {
    url: target,
    ...(name === '' ? {} : { name }),
    ...(text === '' ? {} : { text }),
    ...(author === undefined ? {} : { author }),
    ...(published === undefined ? {} : { published }),
    ...(site === '' ? {} : { site }),
    ...(start === undefined ? {} : { start }),
    ...(location === '' ? {} : { location }),
  };
}

const FLOATING_START = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?$/;

function eventStart(value: string | undefined): string | undefined {
  const written = (value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(written)) return undefined;
  const floating = FLOATING_START.exec(written);
  if (floating !== null) {
    const [, date, time] = floating;
    const kept = time === undefined ? `${date}` : `${date}T${time}`;
    return Number.isNaN(Date.parse(`${date}T${time ?? '00:00'}Z`)) ? undefined : kept;
  }
  return instant(written);
}

function instant(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const at = new Date(value.trim());
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function entrySource(entry: CitedEntry): Source {
  const name = withoutDirectionControls(entry.name);
  const text = withoutDirectionControls(entry.text);
  const named = discoverPostType({ name, content: text }) === 'article';
  const author = entry.author;
  return {
    ...(named ? { name } : text === '' ? {} : { name: null }),
    ...(text === '' ? {} : { text }),
    ...(author === undefined
      ? {}
      : {
          author: { name: author.name, ...(author.url === null ? {} : { url: author.url }) },
          ...(author.photo === null ? {} : { photo: author.photo }),
        }),
    ...(entry.published === null ? {} : { published: entry.published }),
  };
}

function eventSource(event: CitedEvent): Source {
  return {
    ...(event.name === '' ? {} : { name: event.name }),
    ...(event.text === '' ? {} : { text: event.text }),
    ...(event.start === '' ? {} : { start: event.start }),
    ...(event.location === '' ? {} : { location: event.location }),
  };
}

function fediverseSource(post: FediversePost): Source {
  const text = textOf(parseHtml((post.html ?? '').replace(/<\/p>|<br\s*\/?>/gi, '$& ')));
  const { photo, ...author } = post.author ?? { name: '' };
  const image = webUrl(post.image ?? '');
  return {
    ...(post.name !== undefined && post.name !== ''
      ? { name: post.name }
      : text === ''
        ? {}
        : { name: null }),
    ...(text === '' ? {} : { text }),
    ...(author.name === '' ? {} : { author, ...(photo === undefined ? {} : { photo }) }),
    ...(post.published === undefined ? {} : { published: post.published }),
    ...(image === undefined ? {} : { picture: { url: image.href, kind: 'thumbnail' } }),
  };
}

function oembedSource(oembed: Oembed | undefined): Source | undefined {
  if (oembed === undefined) return undefined;
  return {
    ...(oembed.title === undefined ? {} : { name: oembed.title }),
    ...(oembed.author === undefined ? {} : { author: oembed.author }),
    ...(oembed.picture === undefined ? {} : { picture: oembed.picture }),
  };
}

const POSTING_TYPE = /(Article|^BlogPosting|^SocialMediaPosting|^DiscussionForumPosting)$/;

function jsonLdSource(root: HtmlElement, base: string): Source | undefined {
  const node = jsonLdNodes(root).find((candidate) =>
    [candidate['@type']].flat().some((type) => typeof type === 'string' && POSTING_TYPE.test(type)),
  );
  if (node === undefined) return undefined;

  const first: unknown = [node['author']].flat()[0];
  const author = isRecord(first) ? first : {};
  const authorName = plainText(typeof first === 'string' ? first : author['name']);
  const authorUrl = resolved(plainText(author['url']), base);
  const photo = resolved(imageUrl(author['image']), base);
  const picture = resolved(imageUrl(node['image']), base);
  const name = plainText(node['headline']);
  const published = plainText(node['datePublished']);
  return {
    ...(name === undefined ? {} : { name }),
    ...(authorName === undefined
      ? {}
      : {
          author: { name: authorName, ...(authorUrl === undefined ? {} : { url: authorUrl }) },
          ...(photo === undefined ? {} : { photo }),
        }),
    ...(published === undefined ? {} : { published }),
    ...(picture === undefined ? {} : { picture: { url: picture, kind: 'thumbnail' } }),
  };
}

const EVENT_TYPE = /Event$/;

function jsonLdEventSource(root: HtmlElement): Source | undefined {
  const node = jsonLdNodes(root).find((candidate) =>
    [candidate['@type']].flat().some((type) => typeof type === 'string' && EVENT_TYPE.test(type)),
  );
  if (node === undefined) return undefined;

  const name = plainText(node['name']);
  const text = plainText(node['description']);
  const start = plainText(node['startDate']);
  const place: unknown = [node['location']].flat()[0];
  const location =
    typeof place === 'string'
      ? plainText(place)
      : isRecord(place)
        ? plainText(place['name'])
        : undefined;
  return {
    ...(name === undefined ? {} : { name }),
    ...(text === undefined ? {} : { text }),
    ...(start === undefined ? {} : { start }),
    ...(location === undefined ? {} : { location }),
  };
}

function jsonLdNodes(root: HtmlElement): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const element of elementsIn(root)) {
    if (element.data === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(element.data);
    } catch {
      continue;
    }
    for (const value of [parsed].flat()) {
      if (!isRecord(value)) continue;
      nodes.push(value, ...[value['@graph']].flat().filter(isRecord));
    }
  }
  return nodes;
}

function imageUrl(value: unknown): string | undefined {
  const image = [value].flat()[0];
  if (typeof image === 'string') return plainText(image);
  if (!isRecord(image)) return undefined;
  return plainText(image['url']) ?? plainText(image['contentUrl']);
}

function resolved(href: string | undefined, base: string): string | undefined {
  if (href === undefined) return undefined;
  try {
    return webUrl(new URL(href, base).href)?.href;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageSource(root: HtmlElement, base: string): Source {
  const name =
    pageTitle(metaOf(root, 'og:title')) ||
    pageTitle(metaOf(root, 'twitter:title')) ||
    pageTitle(titleOf(root));
  const text =
    metaOf(root, 'description') ||
    metaOf(root, 'og:description') ||
    metaOf(root, 'twitter:description');
  const articleAuthor = metaOf(root, 'article:author');
  const authorUrl = webUrl(articleAuthor);
  const authorName =
    (authorUrl === undefined ? articleAuthor : '') || metaOf(root, 'twitter:creator');
  const published = metaOf(root, 'article:published_time');
  const site = metaOf(root, 'og:site_name');
  const picture = pagePicture(root, base);
  return {
    ...(name === '' ? {} : { name }),
    ...(text === '' ? {} : { text }),
    ...(authorName === ''
      ? {}
      : {
          author: { name: authorName, ...(authorUrl === undefined ? {} : { url: authorUrl.href }) },
        }),
    ...(published === '' ? {} : { published }),
    ...(site === '' ? {} : { site }),
    ...(picture === undefined ? {} : { picture }),
  };
}

function pagePicture(root: HtmlElement, base: string): PictureSource | undefined {
  const image =
    metaOf(root, 'og:image') || metaOf(root, 'twitter:image') || metaOf(root, 'twitter:image:src');
  const url = resolved(image === '' ? undefined : image, base);
  if (url === undefined) return undefined;
  const video =
    metaOf(root, 'og:type').toLowerCase().startsWith('video') ||
    metaOf(root, 'twitter:card').toLowerCase() === 'player';
  return { url, kind: 'thumbnail', ...(video ? { video: true } : {}) };
}

function activityLink(root: HtmlElement, base: string): string | undefined {
  for (const element of elementsIn(root)) {
    if (element.name !== 'link' || !hasRel(element, 'alternate')) continue;
    const type = (element.attributes['type'] ?? '').replace(/\s+/g, '').toLowerCase();
    if (
      type !== 'application/activity+json' &&
      type !== 'application/ld+json;profile="https://www.w3.org/ns/activitystreams"'
    ) {
      continue;
    }
    const url = resolved(element.attributes['href'], base);
    if (url !== undefined) return url;
  }
  return undefined;
}

async function fetchFediversePost(
  url: string | undefined,
  lookupPost: FediverseLookup,
  limits: Limits,
): Promise<FediversePost | undefined> {
  if (url === undefined) return undefined;
  if (!(await publicHost(new URL(url).hostname, limits.lookup))) return undefined;
  const timeoutMs = limits.deadline - Date.now();
  if (timeoutMs <= 0) return undefined;

  const signal = AbortSignal.timeout(timeoutMs);
  const aborted = new Promise<undefined>((resolve) => {
    signal.addEventListener('abort', () => {
      resolve(undefined);
    });
  });
  return await Promise.race([lookupPost(url, signal).catch(() => undefined), aborted]);
}

/**
 * Providers whose JSON oEmbed endpoint is known, asked before their page:
 * YouTube, TikTok, Reddit and Giphy serve a server a generic or slow page, or
 * refuse it, while their endpoints answer (decision-19).
 */
const KNOWN_OEMBED_PROVIDERS: readonly {
  readonly hosts: readonly string[];
  readonly path: RegExp;
  readonly endpoint: string;
  readonly titleSuffix?: string;
}[] = [
  {
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
    path: /^\/(watch\?(.*&)?v=[\w-]+|shorts\/[\w-]+\/?(\?|$))/,
    endpoint: 'https://www.youtube.com/oembed',
  },
  { hosts: ['youtu.be'], path: /^\/[\w-]+\/?(\?|$)/, endpoint: 'https://www.youtube.com/oembed' },
  {
    hosts: ['tiktok.com', 'www.tiktok.com'],
    path: /^\/@[^/]+\/video\/\d+/,
    endpoint: 'https://www.tiktok.com/oembed',
  },
  {
    hosts: ['reddit.com', 'www.reddit.com'],
    path: /^\/r\/[^/]+\/comments\//,
    endpoint: 'https://www.reddit.com/oembed',
  },
  {
    hosts: ['giphy.com', 'www.giphy.com'],
    path: /^\/gifs\/[^/?]+/,
    endpoint: 'https://giphy.com/services/oembed',
    titleSuffix: ' - Find & Share on GIPHY',
  },
];

interface KnownEndpoint {
  readonly endpoint: string;
  readonly titleSuffix?: string | undefined;
}

function knownEndpoint(target: string): KnownEndpoint | undefined {
  const url = webUrl(target);
  if (url === undefined) return undefined;
  const provider = KNOWN_OEMBED_PROVIDERS.find(
    ({ hosts, path }) => hosts.includes(url.hostname) && path.test(url.pathname + url.search),
  );
  if (provider === undefined) return undefined;
  const endpoint = new URL(provider.endpoint);
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('url', target);
  return { endpoint: endpoint.href, titleSuffix: provider.titleSuffix };
}

function withoutSuffix(oembed: Oembed | undefined, suffix: string | undefined): Oembed | undefined {
  if (oembed?.title === undefined || suffix === undefined || !oembed.title.endsWith(suffix)) {
    return oembed;
  }
  const title = oembed.title.slice(0, -suffix.length).trim();
  const { title: _title, ...rest } = oembed;
  return title === '' ? rest : { ...rest, title };
}

export interface Oembed {
  readonly title?: string;
  readonly author?: { readonly name: string; readonly url?: string };
  readonly picture?: PictureSource;
}

/**
 * What a target page says about itself, or `undefined` when it says nothing a
 * preview could show: the sources {@link fetchReplyContext} reads from a page
 * alone, its `h-entry`, the oEmbed answer when `oembed` holds one, its JSON-LD
 * and its metadata. Everything comes out as plain text; the theme escapes it
 * like any other string.
 */
export function readReplyContext(
  html: string,
  target: string,
  base: string = target,
  oembed?: Oembed,
): ReplyContext | undefined {
  const root = parseHtml(html);
  const entry = citedEntry(root, base);
  return described(target, [
    entry === undefined ? undefined : entrySource(entry),
    entry === undefined ? oembedSource(oembed) : undefined,
    jsonLdSource(root, base),
    pageSource(root, base),
  ])?.context;
}

function withoutDirectionControls(text: string | undefined): string {
  return (text ?? '')
    .replace(/\p{Bidi_Control}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageTitle(text: string): string {
  const title = withoutDirectionControls(text);
  return /^[-–—|·•:]\s/u.test(title) ? '' : title;
}

function oembedEndpoint(root: HtmlElement, base: string): string | undefined {
  for (const element of elementsIn(root)) {
    if (element.name !== 'link') continue;
    // Flickr writes "alternative" and SoundCloud "text/json+oembed".
    if (!hasRel(element, 'alternate') && !hasRel(element, 'alternative')) continue;
    const type = element.attributes['type']?.trim().toLowerCase();
    if (type !== 'application/json+oembed' && type !== 'text/json+oembed') continue;
    try {
      return new URL(element.attributes['href'] ?? '', base).href;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function fetchOembed(
  endpoint: string,
  limits: { readonly lookup: HostLookup; readonly deadline: number; readonly maxBytes: number },
): Promise<Oembed | undefined> {
  const timeoutMs = limits.deadline - Date.now();
  if (timeoutMs <= 0) return undefined;

  const fetched = await fetchPublic(endpoint, {
    lookup: limits.lookup,
    timeoutMs,
    maxBytes: limits.maxBytes,
    accept: 'application/json+oembed, application/json;q=0.9',
    contentType: {
      pattern: /^\s*(application\/(json|json\+oembed)|text\/(json|javascript))\b/i,
      name: 'oEmbed JSON',
    },
  });
  if (!fetched.ok) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fetched.body));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const fields = parsed as Record<string, unknown>;

  const title = plainText(fields['title']);
  const authorName = plainText(fields['author_name']);
  const authorUrl = webUrl(plainText(fields['author_url']) ?? '');
  const type = plainText(fields['type']);
  const photo = type === 'photo' ? webUrl(plainText(fields['url']) ?? '') : undefined;
  const thumbnail = webUrl(plainText(fields['thumbnail_url']) ?? '');
  const picture: PictureSource | undefined =
    photo !== undefined
      ? { url: photo.href, kind: 'photo' }
      : thumbnail !== undefined
        ? { url: thumbnail.href, kind: 'thumbnail', ...(type === 'video' ? { video: true } : {}) }
        : undefined;
  return {
    ...(title === undefined ? {} : { title }),
    ...(picture === undefined ? {} : { picture }),
    ...(authorName === undefined
      ? {}
      : {
          author: { name: authorName, ...(authorUrl === undefined ? {} : { url: authorUrl.href }) },
        }),
  };
}

function plainText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? undefined : text;
}

/** The page's `<title>`, or empty. */
function titleOf(root: HtmlElement): string {
  for (const element of elementsIn(root)) {
    if (element.name === 'title') return textOf(element);
  }
  return '';
}

/** The `content` of a `<meta name>` or `<meta property>`, or empty. */
function metaOf(root: HtmlElement, key: string): string {
  for (const element of elementsIn(root)) {
    if (element.name !== 'meta') continue;
    const names = [element.attributes['name'], element.attributes['property']];
    if (!names.some((name) => name?.toLowerCase() === key)) continue;
    return (element.attributes['content'] ?? '').replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** The first words of a text, marked as cut when they are. */
function excerpt(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ');
  let cut = words.length > EXCERPT_WORDS ? words.slice(0, EXCERPT_WORDS).join(' ') : normalized;
  if (cut.length > EXCERPT_CHARACTERS) cut = cut.slice(0, EXCERPT_CHARACTERS).trimEnd();
  return cut === normalized ? normalized : `${cut} …`;
}

function refuse(reason: string): ReplyContextFetch {
  return { ok: false, reason };
}
