import { WEBMENTION_USER_AGENT } from './discovery.ts';
import { publicHost } from './public-address.ts';
import type { HostLookup } from './public-address.ts';

/**
 * One GET of a stranger's URL, with every guard the site puts on reaching out.
 *
 * Only http and https, only public hosts (every redirect hop is checked, and a
 * name is refused when any address it resolves to is private), one timeout
 * over the whole exchange, a content type the caller names, and no body over
 * the byte limit. Nothing throws: whatever goes wrong is a refusal with a
 * reason a log line can carry.
 */

/** How many redirects are followed, each one checked like the first. */
const MAX_REDIRECTS = 5;

/** What {@link fetchPublic} needs. */
export interface FetchPublicOptions {
  /** How host names are resolved before they are trusted. */
  readonly lookup: HostLookup;
  /** How long the whole exchange is given, body included. */
  readonly timeoutMs: number;
  /** The most of a body that is read. */
  readonly maxBytes: number;
  readonly overflow?: 'refuse' | 'truncate';
  /** The `Accept` header sent. */
  readonly accept: string;
  /** The content types taken, and what to call anything else when refusing it. */
  readonly contentType: { readonly pattern: RegExp; readonly name: string };
}

/** What one fetch came to. */
export type PublicFetch =
  | {
      readonly ok: true;
      /** The URL the body came from, after any redirects. */
      readonly url: string;
      /** The response's `Content-Type`. */
      readonly type: string;
      /** The response's `Link` header, or `null` when it sent none. */
      readonly link: string | null;
      readonly body: Uint8Array;
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/** Fetch `target` within the limits `options` sets. */
export async function fetchPublic(
  target: string,
  options: FetchPublicOptions,
): Promise<PublicFetch> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let at = target;

  try {
    for (let hop = 0; ; hop += 1) {
      const url = webUrl(at);
      if (url === undefined) return refuse('not an http or https URL');
      if (!(await publicHost(url.hostname, options.lookup))) {
        return refuse('not a public address');
      }

      const response = await fetch(url, {
        headers: { accept: options.accept, 'user-agent': WEBMENTION_USER_AGENT },
        redirect: 'manual',
        signal,
      });

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location !== null) {
        await response.body?.cancel();
        if (hop === MAX_REDIRECTS) return refuse('too many redirects');
        at = new URL(location, url).href;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        return refuse(`answered ${String(response.status)}`);
      }

      const type = response.headers.get('content-type') ?? '';
      if (!options.contentType.pattern.test(type)) {
        await response.body?.cancel();
        return refuse(`not ${options.contentType.name}`);
      }

      const read = await readWithin(response, options.maxBytes, options.overflow ?? 'refuse');
      if (read === undefined) return refuse(`larger than ${String(options.maxBytes)} bytes`);

      return { ok: true, url: url.href, type, link: response.headers.get('link'), ...read };
    }
  } catch (thrown) {
    return refuse(thrown instanceof Error ? thrown.message : String(thrown));
  }
}

/** An http or https URL with a host, or `undefined`. */
export function webUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  return url.hostname === '' ? undefined : url;
}

/**
 * A response body no bigger than the limit. A bigger one is `undefined` when
 * refused, or its first `maxBytes` when truncated.
 */
async function readWithin(
  response: Response,
  maxBytes: number,
  overflow: 'refuse' | 'truncate',
): Promise<{ body: Uint8Array; truncated: boolean } | undefined> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes && overflow === 'refuse') {
    await response.body?.cancel();
    return undefined;
  }

  const body = response.body;
  if (body === null) return { body: new Uint8Array(), truncated: false };

  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const value: Uint8Array = chunk.value;
    if (read + value.length > maxBytes) {
      await reader.cancel();
      if (overflow === 'refuse') return undefined;
      chunks.push(value.subarray(0, maxBytes - read));
      return { body: Buffer.concat(chunks), truncated: true };
    }
    read += value.length;
    chunks.push(value);
  }

  return { body: Buffer.concat(chunks), truncated: false };
}

function refuse(reason: string): PublicFetch {
  return { ok: false, reason };
}
