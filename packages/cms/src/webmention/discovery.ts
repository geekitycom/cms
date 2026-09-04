import { elementsIn, hasRel, parseHtml } from './html.ts';

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
 * Nothing throws: a target that times out, refuses the connection or answers
 * an error is a target with no endpoint as far as the sender is concerned, and
 * the caller records that rather than stopping.
 */
export async function discoverEndpoint(target: string): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(target, {
      headers: { accept: 'text/html, */*;q=0.8', 'user-agent': WEBMENTION_USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch {
    return undefined;
  }

  if (!response.ok) return undefined;

  // Where the request ended up, which is what a relative endpoint is relative
  // to. `Response.url` is empty for a response nothing redirected, in which
  // case the URL asked for is the URL arrived at.
  const arrivedAt = response.url === '' ? target : response.url;

  const header = endpointInHeader(response.headers.get('link'), arrivedAt);
  if (header !== undefined) {
    // The body is not read, but it has to be released or the socket is held
    // until the process notices.
    await response.body?.cancel();
    return header;
  }

  const type = response.headers.get('content-type') ?? '';
  if (!/^\s*(text\/html|application\/xhtml\+xml)/i.test(type)) {
    await response.body?.cancel();
    return undefined;
  }

  return endpointInHtml(await readCapped(response), arrivedAt);
}

/**
 * The endpoint one or more `Link` headers name, or `undefined`.
 *
 * A header may carry several links separated by commas and each may name
 * several relations, so both are split. Splitting on commas that are not
 * inside angle brackets or quotes is what keeps a URL holding a comma — which
 * is legal — from being torn in half.
 */
export function endpointInHeader(header: string | null, base: string): string | undefined {
  if (header === null) return undefined;

  for (const value of splitLinkHeader(header)) {
    const match = /^\s*<([^>]*)>\s*(.*)$/.exec(value);
    if (match === null) continue;

    const relations = /(?:^|;)\s*rel\s*=\s*("([^"]*)"|'([^']*)'|([^;\s]*))/i.exec(match[2] ?? '');
    const rel = relations?.[2] ?? relations?.[3] ?? relations?.[4] ?? '';
    if (!rel.split(/\s+/).some((token) => token.toLowerCase() === 'webmention')) continue;

    return resolve(match[1] ?? '', base);
  }

  return undefined;
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

/**
 * A response body, up to {@link DISCOVERY_MAX_BYTES}.
 *
 * A cap rather than `response.text()`, because the page at the other end is a
 * stranger's and nothing stops it being a gigabyte. What is read is more than
 * enough markup for a `<link>` in the head.
 */
export async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (body === null) return '';

  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let read = 0;

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: Uint8Array = chunk.value;
      read += value.length;
      chunks.push(decoder.decode(value, { stream: true }));
      if (read >= DISCOVERY_MAX_BYTES) break;
    }
  } catch {
    // A body that stops mid-stream is whatever arrived before it stopped.
  } finally {
    await reader.cancel().catch(ignore);
  }

  chunks.push(decoder.decode());
  return chunks.join('');
}

function ignore(): void {
  // Deliberately empty: a body that will not close is not worth an error.
}
