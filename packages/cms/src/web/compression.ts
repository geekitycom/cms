import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

import type { MiddlewareHandler } from 'hono';

import { ADMIN_ASSET_PREFIX } from '../admin/assets.ts';
import { ADMIN_PREFIX } from '../admin/session.ts';

/**
 * Below this many bytes a response goes out as it is: the saving is smaller
 * than the encoding's own framing and the CPU it costs.
 */
export const COMPRESSION_THRESHOLD = 1024;

/** The encodings the CMS produces, in the order it prefers them. */
type Encoding = 'br' | 'gzip';
const ENCODINGS: readonly Encoding[] = ['br', 'gzip'];

/**
 * Media types that are text under another name. Everything `text/*`, `+json`
 * and `+xml` (feeds, ActivityStreams, SVG, the manifest) is text already; the
 * fonts are the two formats that carry no compression of their own.
 */
const COMPRESSIBLE_TYPES: ReadonlySet<string> = new Set([
  'application/json',
  'application/javascript',
  'application/xml',
  'font/otf',
  'font/ttf',
]);

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/**
 * Compress text responses on the way out (TASK-139).
 *
 * Mounted outside every other middleware, so it sees the body the client is
 * about to get. It adds `Vary: Accept-Encoding` to every text response,
 * compressed or not, so a cache never hands brotli to a client that asked for
 * none. A compressed response's ETag is weakened: the encoded octets differ
 * from the plain ones, but the representation is the same, and every
 * `If-None-Match` check in the CMS already compares weakly, so the one
 * validator revalidates in every encoding.
 */
export function compression(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const response = c.res;

    if (response.status === 304) {
      // A 304 carries no media type to judge by, and a cache copies its
      // headers over the stored response's, so a 304 saying only `Vary:
      // Accept` would strip Accept-Encoding from a stored page. Every 304
      // says it varies: over-stating Vary costs a cache a spare entry, while
      // under-stating it could hand brotli to a client that cannot read it.
      c.res = new Response(null, response);
      addVary(c.res.headers);
      // A client revalidating a compressed copy sends the weak form it was
      // given; hand that back, so the validator it stores stays the one it has.
      const etag = c.res.headers.get('etag');
      if (
        etag !== null &&
        !etag.startsWith('W/') &&
        presents(c.req.header('if-none-match'), `W/${etag}`)
      ) {
        c.res.headers.set('etag', `W/${etag}`);
      }
      return;
    }

    if (holdsSecrets(c.req.path, response) || !worthCompressing(response)) return;

    const encoding = chooseEncoding(c.req.header('accept-encoding'));
    const declared = Number(response.headers.get('content-length') ?? Number.NaN);
    if (encoding === undefined || declared < COMPRESSION_THRESHOLD) {
      c.res = new Response(response.body, response);
      addVary(c.res.headers);
      return;
    }

    const plain = new Uint8Array(await response.arrayBuffer());
    if (plain.byteLength < COMPRESSION_THRESHOLD) {
      c.res = new Response(plain, response);
      addVary(c.res.headers);
      return;
    }

    const encoded = await encode(plain, encoding);
    c.res = new Response(encoded, response);
    const headers = c.res.headers;
    addVary(headers);
    headers.set('content-encoding', encoding);
    headers.set('content-length', String(encoded.byteLength));
    const etag = headers.get('etag');
    if (etag !== null && !etag.startsWith('W/')) headers.set('etag', `W/${etag}`);
  };
}

/**
 * Whether a response may carry a secret beside text a visitor controls: a
 * CSRF token, a session's own data. Compressing such a page lets an attacker
 * who can inject text and watch its size recover the secret a byte at a time
 * (BREACH), so it goes out plain. Every page drawn for somebody signed in says
 * `private` or `no-store`; the admin's screens, the setup and login forms
 * among them, say neither, so the path covers those. The admin's static files
 * hold no secret and are compressed like any other.
 */
function holdsSecrets(requestPath: string, response: Response): boolean {
  if (/\b(private|no-store)\b/i.test(response.headers.get('cache-control') ?? '')) return true;
  if (requestPath.startsWith(ADMIN_ASSET_PREFIX)) return false;
  return requestPath === ADMIN_PREFIX || requestPath.startsWith(`${ADMIN_PREFIX}/`);
}

/** Whether this response is text with a body that nothing has encoded yet. */
function worthCompressing(response: Response): boolean {
  if (response.body === null || response.status === 204 || response.status === 206) return false;
  if (response.headers.has('content-encoding')) return false;
  if (/\bno-transform\b/i.test(response.headers.get('cache-control') ?? '')) return false;
  return isCompressible(response.headers.get('content-type'));
}

function isCompressible(contentType: string | null): boolean {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    type.startsWith('text/') ||
    type.endsWith('+json') ||
    type.endsWith('+xml') ||
    COMPRESSIBLE_TYPES.has(type)
  );
}

/**
 * The encoding to send for an `Accept-Encoding`, brotli first. A coding the
 * header names with `q=0` is refused; one it leaves out is taken only when
 * `*` is offered.
 */
function chooseEncoding(accept: string | undefined): Encoding | undefined {
  if (accept === undefined) return undefined;
  const weights = new Map<string, number>();
  for (const part of accept.split(',')) {
    const [name = '', ...params] = part.split(';').map((piece) => piece.trim().toLowerCase());
    if (name === '') continue;
    const q = params.find((param) => param.startsWith('q='));
    weights.set(name, q === undefined ? 1 : Number(q.slice(2)) || 0);
  }
  return ENCODINGS.find((encoding) => (weights.get(encoding) ?? weights.get('*') ?? 0) > 0);
}

function encode(body: Uint8Array, encoding: Encoding): Promise<Uint8Array> {
  if (encoding === 'gzip') return gzipAsync(body, { level: 6 });
  // Quality 5 rather than the maximum 11: these bodies are built per request,
  // and at 11 the time spent encoding outweighs the bytes it saves.
  return brotli(body, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_QUALITY]: 5,
      [constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
    },
  });
}

function addVary(headers: Headers): void {
  const names = (headers.get('vary') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  if (names.some((name) => name === '*' || name.toLowerCase() === 'accept-encoding')) return;
  headers.set('vary', [...names, 'Accept-Encoding'].join(', '));
}

function presents(ifNoneMatch: string | undefined, etag: string): boolean {
  return (ifNoneMatch ?? '').split(',').some((candidate) => candidate.trim() === etag);
}
