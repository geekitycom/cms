import { htmlToText } from '../content/search.ts';
import { parseHtml } from '../util/html-tree.ts';
import { absoluteUrl } from '../util/url.ts';
import type { HeldAt } from '../comments/conversation.ts';
import type { CitedImage, CitedPicture, PictureSource } from './cited-picture.ts';
import { readCitedStart } from './cited-start.ts';
import { webUrl } from './fetch-public.ts';
import { citedEntry } from './microformats.ts';
import type { HostLookup } from '../util/public-address.ts';
import { fediversePostOf, fediverseSource } from './reply-context/fediverse.ts';
import type { FediverseLookup, FediversePost } from './reply-context/fediverse.ts';
import { answeredFeed } from './reply-context/feed.ts';
import type { AnsweredFeed } from './reply-context/feed.ts';
import { jsonLdEventSource, jsonLdSource } from './reply-context/json-ld.ts';
import {
  fetchOembed,
  knownEndpoint,
  oembedEndpoint,
  oembedSource,
  withoutSuffix,
} from './reply-context/oembed.ts';
import type { KnownEndpoint, Oembed } from './reply-context/oembed.ts';
import {
  canonicalLink,
  entrySource,
  eventSource,
  pageSource,
  readPage,
  syndicationOf,
} from './reply-context/page.ts';
import type { HtmlPage } from './reply-context/page.ts';
import { merge, withoutDirectionControls } from './reply-context/source.ts';
import type { Limits, Source } from './reply-context/source.ts';

export type { FediverseLookup, FediversePost } from './reply-context/fediverse.ts';
export type { AnsweredFeed } from './reply-context/feed.ts';

/**
 * Reply context: what a reply shows of the post it answers.
 *
 * The post is on somebody else's site, so this is the one place the CMS reads
 * a stranger's page on an author's behalf. It happens when a reply is saved or
 * synced, never while a page is served, and what it finds is kept in a file.
 * Everything here fails soft: a target that cannot be read is a
 * reply with a bare link, never a save that fails.
 */

/** How long a target is given to answer, body included. */
export const REPLY_CONTEXT_TIMEOUT_MS = 10_000;

/**
 * The most of a target page that is read. Only the head of a bigger page is
 * read, and an oEmbed answer bigger than this is not read at all.
 */
export const REPLY_CONTEXT_MAX_BYTES = 1_000_000;

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
   * copy back as its `u-syndication`. Every other field then
   * describes the original.
   */
  readonly original?: string;
  /** Its title, when it has one of its own; a note's name is its text. */
  readonly name?: string;
  /**
   * Set when it is a comment on this site: one somebody else left
   * through the form, a webmention or the fediverse, which a citation calls "a
   * comment" rather than "a post".
   */
  readonly comment?: true;
  /** A short excerpt of what it says, or the page's description. */
  readonly text?: string;
  /** Who wrote it. */
  readonly author?: CitedAuthor;
  /** When it says it was published, as an ISO 8601 instant. */
  readonly published?: string;
  /** The site it is on, its `og:site_name`, kept only when it names no author. */
  readonly site?: string;
  /**
   * When an event starts: an ISO 8601 instant when the page gives
   * a zone, else the date, or the date and time, as the page wrote them, which
   * no reader's zone may move.
   */
  readonly start?: string;
  /** Where an event takes place, as the page names it. */
  readonly location?: string;
  /** Its picture, copied into the site's uploads. */
  readonly picture?: CitedPicture;
  /** The RSS feed it is published in, when its page names one that holds it. */
  readonly feed?: AnsweredFeed;
}

export interface CitedAuthor {
  readonly name: string;
  /** Their page, when that is an http(s) URL. */
  readonly url?: string;
  /** Their fediverse handle, `user@host`, when the post is a fediverse object. */
  readonly handle?: string;
  /** Their avatar, copied into the site's uploads like a picture. */
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

/**
 * Fetch a page a post cites and read what it says about itself. A known
 * provider's oEmbed endpoint is asked first, and the page is read only when
 * that names nothing. Any other page is read, and when it has no `h-entry` it
 * is also asked about through the ActivityPub object and the oEmbed endpoint
 * it links. Each source fills only what the ones before it left empty:
 * `h-entry`, ActivityPub, oEmbed, JSON-LD, then the page's own metadata. A
 * silo copy of a post on another site is described by that original instead,
 * when the original lists the copy as its own.
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
    deadline: AbortSignal.timeout(options.timeoutMs ?? REPLY_CONTEXT_TIMEOUT_MS),
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

  const page = read.page;
  const post = await fediversePostOf(page, options.fediverse, limits);
  const original = known === undefined ? await originalOf(target, page, post, limits) : undefined;
  const found =
    (original === undefined
      ? undefined
      : await describeOriginal(target, original, options.fediverse, limits)) ??
    (await describePage(target, page, post, known, limits));
  if (found === undefined) return refuse('nothing to show');

  // The feed of the page cited, never the original's: that is the feed whose
  // item `source:inReplyTo` names.
  const feed = await answeredFeed(page, target, limits);
  return feed === undefined ? found : { ...found, context: { ...found.context, feed } };
}

async function describeOriginal(
  target: string,
  original: HtmlPage,
  fediverse: FediverseLookup | undefined,
  limits: Limits,
): Promise<Extract<ReplyContextFetch, { ok: true }> | undefined> {
  const post = await fediversePostOf(original, fediverse, limits);
  const found = await describePage(target, original, post, undefined, limits);
  return found === undefined
    ? undefined
    : { ...found, context: { ...found.context, original: original.url } };
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
    if (listsCopy(read.page, copyUrls)) return read.page;
  }
  return undefined;
}

function listsCopy(original: HtmlPage, copyUrls: ReadonlySet<string>): boolean {
  return syndicationOf(original).some((url) => copyUrls.has(url));
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

function eventStart(value: string | undefined): string | undefined {
  const start = readCitedStart(value ?? '');
  if (start === undefined) return undefined;
  return start.kind === 'wall-clock' ? start.written : start.at.toISOString();
}

function instant(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const at = new Date(value.trim());
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
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

/**
 * The context of something this site already holds: a
 * comment, a webmention, a fediverse reply or a reply post in one of its
 * threads, or one of its own posts or pages. Read from the index rather than
 * fetched, so a reply to a comment shows the comment rather than the whole
 * post it is on, and a reply to the site's own post never fetches its page.
 */
export function heldReplyContext(target: string, held: HeldAt, feed?: AnsweredFeed): ReplyContext {
  const said =
    held.kind === 'reply'
      ? held.reply
      : {
          author: held.author,
          content: held.post.html,
          published: new Date(held.post.date ?? held.post.updated ?? 0),
        };
  const name = held.kind === 'document' ? held.post.title.trim() : '';
  const text = excerpt(withoutDirectionControls(htmlToText(said.content)));
  const url = said.author.url === null ? undefined : webUrl(absoluteUrl(said.author.url, target));
  return {
    url: target,
    ...(held.kind === 'reply' && held.reply.source !== 'post' ? { comment: true } : {}),
    ...(name === '' ? {} : { name }),
    ...(text === '' ? {} : { text }),
    author: { name: said.author.name, ...(url === undefined ? {} : { url: url.href }) },
    published: said.published.toISOString(),
    ...(feed === undefined ? {} : { feed }),
  };
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
