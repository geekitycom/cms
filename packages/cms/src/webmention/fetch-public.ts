import { messageOf } from '../util/errors.ts';
import { WEBMENTION_USER_AGENT } from './discovery.ts';
import { publicHost } from '../util/public-address.ts';
import type { HostLookup } from '../util/public-address.ts';

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
  /** Ends the whole exchange, body included, when it aborts. */
  readonly signal: AbortSignal;
  /** The most of a body that is read. */
  readonly maxBytes: number;
  readonly overflow?: 'refuse' | 'truncate';
  /** The `Accept` header sent. */
  readonly accept: string;
  readonly headers?: Readonly<Record<string, string>> & { readonly 'user-agent'?: never };
  /** The `User-Agent` sent. Defaults to the site's own. */
  readonly userAgent?: string;
  /** Which URLs may be fetched, checked on every hop besides the public-address check. */
  readonly allowed?: (url: URL) => boolean;
  /** The content types taken, and what to call anything else when refusing it. */
  readonly contentType: { readonly pattern: RegExp; readonly name: string };
  readonly headersOnly?: RegExp;
}

interface PublicResponse {
  /** The URL the response came from, after any redirects. */
  readonly url: string;
  /** The response's `Content-Type`. */
  readonly type: string;
  /** The response's `Link` header, or `null` when it sent none. */
  readonly link: string | null;
}

export interface PublicBody extends PublicResponse {
  readonly ok: true;
  readonly read: 'body';
  readonly body: Uint8Array;
  readonly truncated: boolean;
}

export interface PublicHeaders extends PublicResponse {
  readonly ok: true;
  readonly read: 'headers';
}

export interface PublicRefusal {
  readonly ok: false;
  readonly reason: string;
  readonly status?: number;
}

/** What one fetch came to. */
export type PublicFetch = PublicBody | PublicHeaders | PublicRefusal;

/** Fetch `target` within the limits `options` sets. */
export function fetchPublic(
  target: string,
  options: FetchPublicOptions & { readonly headersOnly: RegExp },
): Promise<PublicFetch>;
export function fetchPublic(
  target: string,
  options: FetchPublicOptions & { readonly headersOnly?: undefined },
): Promise<PublicBody | PublicRefusal>;
export async function fetchPublic(
  target: string,
  options: FetchPublicOptions,
): Promise<PublicFetch> {
  const answered = await requestPublic(target, {
    lookup: options.lookup,
    signal: options.signal,
    headers: { ...options.headers, accept: options.accept },
    userAgent: options.userAgent,
    allowed: options.allowed,
  });
  if (!answered.ok) return answered;
  const { response, url } = answered;

  try {
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, reason: `answered ${String(response.status)}`, status: response.status };
    }

    const type = response.headers.get('content-type') ?? '';
    const link = response.headers.get('link');
    if (options.headersOnly?.test(type) === true) {
      await response.body?.cancel();
      return { ok: true, read: 'headers', url, type, link };
    }
    if (!options.contentType.pattern.test(type)) {
      await response.body?.cancel();
      return refuse(`not ${options.contentType.name}`);
    }

    const read = await readWithin(response, options.maxBytes, options.overflow ?? 'refuse');
    if (read === undefined) return refuse(`larger than ${String(options.maxBytes)} bytes`);

    return { ok: true, read: 'body', url, type, link, ...read };
  } catch (thrown) {
    return refuse(messageOf(thrown));
  }
}

export interface RequestPublicOptions {
  readonly lookup: HostLookup;
  readonly signal: AbortSignal;
  readonly method?: string;
  readonly headers: Readonly<Record<string, string>> & { readonly 'user-agent'?: never };
  readonly body?: string;
  readonly userAgent?: string | undefined;
  readonly allowed?: ((url: URL) => boolean) | undefined;
  readonly sign?: ((request: Request) => Promise<Request>) | undefined;
}

export interface PublicAnswer {
  readonly ok: true;
  readonly response: Response;
  readonly url: string;
}

/** A 303, or a 301 or 302 after a POST, turns the request into a GET without a body, as `fetch` itself would. */
export async function requestPublic(
  target: string,
  options: RequestPublicOptions,
): Promise<PublicAnswer | PublicRefusal> {
  let at = target;
  let method = options.method ?? 'GET';
  let body = options.body ?? null;
  let headers: Record<string, string> = {
    ...options.headers,
    'user-agent': options.userAgent ?? WEBMENTION_USER_AGENT,
  };

  try {
    for (let hop = 0; ; hop += 1) {
      const url = webUrl(at);
      if (url === undefined) return refuse('not an http or https URL');
      if (options.allowed !== undefined && !options.allowed(url)) {
        return refuse(`${url.origin} is not a host this fetch may reach`);
      }
      if (!(await publicHost(url.hostname, options.lookup))) {
        return refuse('not a public address');
      }

      const response = await fetch(url, {
        method,
        headers:
          options.sign === undefined
            ? headers
            : (await options.sign(new Request(url, { method, headers, body }))).headers,
        body,
        redirect: 'manual',
        signal: options.signal,
      });

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location !== null) {
        await response.body?.cancel();
        if (hop === MAX_REDIRECTS) return refuse('too many redirects');
        at = new URL(location, url).href;
        if (
          response.status === 303 ||
          (method === 'POST' && (response.status === 301 || response.status === 302))
        ) {
          method = 'GET';
          body = null;
          headers = withoutContentType(headers);
        }
        continue;
      }

      return { ok: true, response, url: url.href };
    }
  } catch (thrown) {
    return refuse(messageOf(thrown));
  }
}

function withoutContentType(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'content-type'),
  );
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
 * A response or request body no bigger than the limit. A bigger one is
 * `undefined` when refused, or its first `maxBytes` when truncated.
 */
export async function readWithin(
  response: Pick<Response, 'headers' | 'body'>,
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

function refuse(reason: string): PublicRefusal {
  return { ok: false, reason };
}
