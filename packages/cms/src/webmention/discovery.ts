import { fetchPublic } from './fetch-public.ts';
import { elementsIn, hasRel, parseHtml } from './html.ts';
import type { HostLookup } from './public-address.ts';

/**
 * Finding out where to send a webmention.
 *
 * The W3C spec fixes the order and it matters, because a page may advertise
 * two: the HTTP `Link` header first, then the first `<link>` **or** `<a>`
 * carrying `rel="webmention"` in document order — one search over both, not
 * one search each. Whatever is found is resolved against the URL the request
 * actually ended at, so a target that redirects to its canonical home
 * advertises that home's endpoint rather than a path under the old one.
 */

/** How long one discovery request is given before it is abandoned. */
export const DISCOVERY_TIMEOUT_MS = 10_000;

/** How much of a target page is read while looking for its endpoint. */
export const DISCOVERY_MAX_BYTES = 1_000_000;

/** What a sender says it is. */
export const WEBMENTION_USER_AGENT = 'Geekity/1.0 (+https://github.com/andrewshell/geekity)';

/**
 * The Webmention endpoint a page advertises, or `undefined` when it advertises
 * none — which is most pages, and is not an error.
 *
 * Nothing throws: a target that times out, refuses the connection, answers
 * an error or is not on a public host is a target with no endpoint as far as
 * the sender is concerned, and the caller records that rather than stopping.
 */
export async function discoverEndpoint(
  target: string,
  lookup: HostLookup,
): Promise<string | undefined> {
  const fetched = await fetchPublic(target, {
    lookup,
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    maxBytes: DISCOVERY_MAX_BYTES,
    overflow: 'truncate',
    accept: 'text/html, */*;q=0.8',
    contentType: { pattern: HTML, name: 'HTML' },
    headersOnly: NOT_HTML,
  });
  if (!fetched.ok) return undefined;

  const header = endpointInHeader(fetched.link, fetched.url);
  if (header !== undefined || fetched.read === 'headers') return header;

  return endpointInHtml(new TextDecoder().decode(fetched.body), fetched.url);
}

const HTML = /^\s*(text\/html|application\/xhtml\+xml)/i;
const NOT_HTML = /^(?!\s*(text\/html|application\/xhtml\+xml))/i;

/** The endpoint one or more `Link` headers name, or `undefined`. */
export function endpointInHeader(header: string | null, base: string): string | undefined {
  const [target] = linkTargets(header, 'webmention');
  return target === undefined ? undefined : resolve(target, base);
}

/**
 * Every target a `Link` header names for `rel`, in order and unresolved.
 *
 * A header may carry several links separated by commas and each may name
 * several relations, so both are split. Splitting on commas that are not
 * inside angle brackets or quotes is what keeps a URL holding a comma — which
 * is legal — from being torn in half.
 */
export function linkTargets(header: string | null, rel: string): string[] {
  if (header === null) return [];

  const targets: string[] = [];
  for (const value of splitLinkHeader(header)) {
    const match = /^\s*<([^>]*)>\s*(.*)$/.exec(value);
    if (match === null) continue;

    const relations = /(?:^|;)\s*rel\s*=\s*("([^"]*)"|'([^']*)'|([^;\s]*))/i.exec(match[2] ?? '');
    const names = relations?.[2] ?? relations?.[3] ?? relations?.[4] ?? '';
    if (names.split(/\s+/).some((token) => token.toLowerCase() === rel)) {
      targets.push(match[1] ?? '');
    }
  }

  return targets;
}

/**
 * The endpoint a page's markup names, or `undefined`.
 *
 * One walk over every element rather than one for `<link>` and another for
 * `<a>`: the spec asks for the first of either in document order, and two
 * walks would answer with whichever kind was searched for first.
 */
export function endpointInHtml(html: string, base: string): string | undefined {
  for (const element of elementsIn(parseHtml(html))) {
    if (element.name !== 'link' && element.name !== 'a') continue;
    if (!hasRel(element, 'webmention')) continue;

    // An `href` that is there but empty means the page itself, which is what
    // an endpoint on the same URL as the target looks like.
    return resolve(element.attributes['href'] ?? '', base);
  }

  return undefined;
}

/** One `Link` header value split into its links, commas inside a URL kept. */
function splitLinkHeader(header: string): string[] {
  const values: string[] = [];
  let start = 0;
  let inBrackets = false;
  let quote: string | undefined;

  for (let at = 0; at < header.length; at += 1) {
    const character = header[at];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '<') inBrackets = true;
    else if (character === '>') inBrackets = false;
    else if (character === ',' && !inBrackets) {
      values.push(header.slice(start, at));
      start = at + 1;
    }
  }

  values.push(header.slice(start));
  return values;
}

/** An advertised endpoint as an absolute URL, or `undefined` when it is not one. */
function resolve(href: string, base: string): string | undefined {
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
