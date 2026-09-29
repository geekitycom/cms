import { discoverPostType } from '../content/post-type.ts';
import { fetchPublic, webUrl } from './fetch-public.ts';
import { elementsIn, parseHtml, textOf } from './html.ts';
import type { HtmlElement } from './html.ts';
import { citedEntry } from './microformats.ts';
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

/** The most of a target page that is read. A bigger page is not read at all. */
export const REPLY_CONTEXT_MAX_BYTES = 1_000_000;

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
}

/** What fetching one target came to. */
export type ReplyContextFetch =
  | { readonly ok: true; readonly context: ReplyContext }
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
 * Fetch a reply's target and read what it says about itself.
 *
 * Only http and https, only public hosts (every redirect hop is checked, and a
 * name is refused when any address it resolves to is private), one timeout
 * over the whole exchange, and no page over the byte limit. Nothing throws.
 */
export async function fetchReplyContext(
  target: string,
  options: FetchReplyContextOptions,
): Promise<ReplyContextFetch> {
  const fetched = await fetchPublic(target, {
    lookup: options.lookup,
    timeoutMs: options.timeoutMs ?? REPLY_CONTEXT_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? REPLY_CONTEXT_MAX_BYTES,
    accept: 'text/html, */*;q=0.8',
    contentType: { pattern: /^\s*(text\/html|application\/xhtml\+xml)/i, name: 'an HTML page' },
  });
  if (!fetched.ok) return fetched;

  const context = readReplyContext(new TextDecoder().decode(fetched.body), target, fetched.url);
  return context === undefined ? refuse('nothing to show') : { ok: true, context };
}

/**
 * What a target page says about itself, or `undefined` when it says nothing a
 * preview could show.
 *
 * The first `h-entry` when there is one: its name when it has one of its own
 * (the test Post Type Discovery uses), an excerpt of its text, its author and
 * its date. A page with no `h-entry` is described by its `<title>` and its
 * description metadata. Everything comes out as plain text; the theme escapes
 * it like any other string.
 */
export function readReplyContext(
  html: string,
  target: string,
  base: string = target,
): ReplyContext | undefined {
  const root = parseHtml(html);
  const entry = citedEntry(root, base);

  if (entry !== undefined) {
    const named = discoverPostType({ name: entry.name, content: entry.text }) === 'article';
    const text = excerpt(entry.text);
    const authorUrl = entry.author?.url === null ? undefined : webUrl(entry.author?.url ?? '');
    return {
      url: target,
      ...(named ? { name: entry.name } : {}),
      ...(text === '' ? {} : { text }),
      ...(entry.author === undefined
        ? {}
        : {
            author: {
              name: entry.author.name,
              ...(authorUrl === undefined ? {} : { url: authorUrl.href }),
            },
          }),
      ...(entry.published === null ? {} : { published: entry.published }),
    };
  }

  const name = titleOf(root) || metaOf(root, 'og:title');
  const text = excerpt(metaOf(root, 'description') || metaOf(root, 'og:description'));
  if (name === '' && text === '') return undefined;

  return { url: target, ...(name === '' ? {} : { name }), ...(text === '' ? {} : { text }) };
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
