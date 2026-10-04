import { discoverPostType } from '../content/post-type.ts';
import type { CitedPicture, PictureSource } from './cited-picture.ts';
import { fetchPublic, webUrl } from './fetch-public.ts';
import { elementsIn, hasRel, parseHtml, textOf } from './html.ts';
import type { HtmlElement } from './html.ts';
import { citedEntry } from './microformats.ts';
import type { CitedEntry } from './microformats.ts';
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

/** A response that is an image rather than a page about one (TASK-255). */
const IMAGE_TYPE = /^\s*image\//i;

/** How many words of a target's text a preview keeps. */
const EXCERPT_WORDS = 40;

/** And how many characters, for a text with few spaces in it. */
const EXCERPT_CHARACTERS = 300;

/** What a reply shows of the post it answers. */
export interface ReplyContext {
  /** The post answered: the reply's own `in-reply-to`, whatever it redirected to. */
  readonly url: string;
  /** Its title, when it has one of its own; a note's name is its text. */
  readonly name?: string;
  /** A short excerpt of what it says, or the page's description. */
  readonly text?: string;
  /** Who wrote it, with their page when that is an http(s) URL. */
  readonly author?: { readonly name: string; readonly url?: string };
  /** When it says it was published, as an ISO 8601 instant. */
  readonly published?: string;
  /** The site it is on, its `og:site_name`, kept only when it names no author. */
  readonly site?: string;
  /** Its picture, copied into the site's uploads (TASK-252). */
  readonly picture?: CitedPicture;
}

/**
 * What fetching one target came to. `picture` is the picture the page names,
 * still on its own host: the caller copies it or leaves it.
 */
export type ReplyContextFetch =
  | { readonly ok: true; readonly context: ReplyContext; readonly picture?: PictureSource }
  | { readonly ok: false; readonly reason: string };

/** What {@link fetchReplyContext} needs. */
export interface FetchReplyContextOptions {
  /** How host names are resolved before they are trusted. */
  readonly lookup: HostLookup;
  /** Defaults to {@link REPLY_CONTEXT_TIMEOUT_MS}. */
  readonly timeoutMs?: number | undefined;
  /** Defaults to {@link REPLY_CONTEXT_MAX_BYTES}. */
  readonly maxBytes?: number | undefined;
}

/**
 * Fetch a page a post cites and read what it says about itself. A known
 * provider's oEmbed endpoint is asked first, and the page is read only when
 * that names nothing. Any other page is read, and asked about through the
 * oEmbed endpoint it links when it has no `h-entry`.
 *
 * Only http and https, only public hosts (every redirect hop is checked, and a
 * name is refused when any address it resolves to is private), one timeout
 * over the whole exchange, every oEmbed request included, no more of a page
 * than the byte limit, and no oEmbed answer over it. Nothing throws.
 */
export async function fetchReplyContext(
  target: string,
  options: FetchReplyContextOptions,
): Promise<ReplyContextFetch> {
  const limits = {
    lookup: options.lookup,
    deadline: Date.now() + (options.timeoutMs ?? REPLY_CONTEXT_TIMEOUT_MS),
    maxBytes: options.maxBytes ?? REPLY_CONTEXT_MAX_BYTES,
  };

  const known = knownEndpoint(target);
  if (known !== undefined) {
    const oembed = withoutSuffix(await fetchOembed(known.endpoint, limits), known.titleSuffix);
    const context = describe(parseHtml(''), undefined, target, oembed);
    if (context !== undefined) return described(context, oembed?.picture);
  }

  const timeoutMs = limits.deadline - Date.now();
  const fetched =
    timeoutMs <= 0
      ? ({ ok: false, reason: 'timed out' } as const)
      : await fetchPublic(target, {
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

  // The address is the picture: its bytes are left for the copy, which holds
  // them to the site's upload limit rather than a page's.
  if (fetched.ok && IMAGE_TYPE.test(fetched.type)) {
    return described({ url: target }, { url: fetched.url, kind: 'photo' });
  }

  const root = parseHtml(fetched.ok ? new TextDecoder().decode(fetched.body) : '');
  const entry = fetched.ok && !fetched.truncated ? citedEntry(root, fetched.url) : undefined;
  const endpoint =
    fetched.ok && entry === undefined && known === undefined
      ? oembedEndpoint(root, fetched.url)
      : undefined;
  const oembed = endpoint === undefined ? undefined : await fetchOembed(endpoint, limits);

  const context = describe(root, entry, target, oembed);
  if (context !== undefined) {
    return described(
      context,
      oembed?.picture ?? (fetched.ok ? pagePicture(root, fetched.url) : undefined),
    );
  }
  return fetched.ok ? refuse('nothing to show') : fetched;
}

function described(context: ReplyContext, picture: PictureSource | undefined): ReplyContextFetch {
  return { ok: true, context, ...(picture === undefined ? {} : { picture }) };
}

/**
 * The page's `og:image`, else its Twitter card's image, as a thumbnail of it,
 * marked a video's when its `og:type` or its card says so.
 */
function pagePicture(root: HtmlElement, base: string): PictureSource | undefined {
  const image =
    metaOf(root, 'og:image') || metaOf(root, 'twitter:image') || metaOf(root, 'twitter:image:src');
  if (image === '') return undefined;
  let url: URL | undefined;
  try {
    url = webUrl(new URL(image, base).href);
  } catch {
    return undefined;
  }
  if (url === undefined) return undefined;
  const video =
    metaOf(root, 'og:type').toLowerCase().startsWith('video') ||
    metaOf(root, 'twitter:card').toLowerCase() === 'player';
  return { url: url.href, kind: 'thumbnail', ...(video ? { video: true } : {}) };
}

/**
 * Providers whose JSON oEmbed endpoint is known, asked before their page:
 * YouTube, TikTok, Reddit and Giphy serve a server a generic or slow page, or
 * refuse it, while their endpoints answer (decision-19).
 */
const KNOWN_OEMBED_PROVIDERS: readonly {
  readonly hosts: readonly string[];
  /** Tested against the path and query of the cited URL. */
  readonly path: RegExp;
  readonly endpoint: string;
  /** What the endpoint appends to every title, cut off before the title is kept. */
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

function knownEndpoint(
  target: string,
): { readonly endpoint: string; readonly titleSuffix?: string | undefined } | undefined {
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
 * preview could show.
 *
 * The first `h-entry` when there is one: its name when it has one of its own
 * (the test Post Type Discovery uses), an excerpt of its text, its author and
 * its date. A page with no `h-entry` is described by its oEmbed title and
 * author when `oembed` holds them, then its `og:title`, `<title>` and
 * description metadata, where a title that is only a site suffix is none.
 * Everything comes out as plain text; the theme escapes it like any other
 * string.
 */
export function readReplyContext(
  html: string,
  target: string,
  base: string = target,
  oembed?: Oembed,
): ReplyContext | undefined {
  const root = parseHtml(html);
  return describe(root, citedEntry(root, base), target, oembed);
}

function describe(
  root: HtmlElement,
  entry: CitedEntry | undefined,
  target: string,
  oembed: Oembed | undefined,
): ReplyContext | undefined {
  if (entry !== undefined) {
    const entryName = withoutDirectionControls(entry.name);
    const entryText = withoutDirectionControls(entry.text);
    const named = discoverPostType({ name: entryName, content: entryText }) === 'article';
    const text = excerpt(entryText);
    const authorName = withoutDirectionControls(entry.author?.name);
    const authorUrl = entry.author?.url === null ? undefined : webUrl(entry.author?.url ?? '');
    return {
      url: target,
      ...(named ? { name: entryName } : {}),
      ...(text === '' ? {} : { text }),
      ...(authorName === ''
        ? {}
        : {
            author: {
              name: authorName,
              ...(authorUrl === undefined ? {} : { url: authorUrl.href }),
            },
          }),
      ...(entry.published === null ? {} : { published: entry.published }),
      ...(authorName === '' ? siteOf(root) : {}),
    };
  }

  const name =
    withoutDirectionControls(oembed?.title) ||
    pageTitle(metaOf(root, 'og:title')) ||
    pageTitle(titleOf(root));
  const text = excerpt(
    withoutDirectionControls(metaOf(root, 'description')) ||
      withoutDirectionControls(metaOf(root, 'og:description')),
  );
  const authorName = withoutDirectionControls(oembed?.author?.name);
  const author = authorName === '' ? undefined : { ...oembed?.author, name: authorName };
  if (name === '' && text === '' && author === undefined) return undefined;

  return {
    url: target,
    ...(name === '' ? {} : { name }),
    ...(text === '' ? {} : { text }),
    ...(author === undefined ? siteOf(root) : { author }),
  };
}

function siteOf(root: HtmlElement): { site?: string } {
  const site = withoutDirectionControls(metaOf(root, 'og:site_name'));
  return site === '' ? {} : { site };
}

function withoutDirectionControls(text: string | undefined): string {
  return (text ?? '')
    .replace(/\p{Bidi_Control}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A page's title, or empty when it is only a site suffix such as "- YouTube". */
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
