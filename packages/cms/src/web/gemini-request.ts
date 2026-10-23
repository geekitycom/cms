import { describeWait } from './throttle.ts';

export type GeminiStatus = 10 | 20 | 30 | 31 | 40 | 41 | 44 | 50 | 51 | 52 | 53 | 59;

export interface GeminiHeader {
  readonly status: GeminiStatus;
  readonly meta: string;
}

export type GeminiRoute =
  { readonly paths: readonly [string, ...string[]] } | { readonly header: GeminiHeader };

export const MAX_URL_BYTES = 1024;

const CRLF = Buffer.from('\r\n');
const SEARCH_PATHS: ReadonlySet<string> = new Set(['/search/', '/search/index.gmi']);
const SEARCH_PROMPT = 'Search this site';
const UNAVAILABLE = 'Down for maintenance';

function bad(meta: string): { header: GeminiHeader } {
  return { header: { status: 59, meta } };
}

export function readRequestLine(
  received: Buffer,
): { readonly line: string } | { readonly header: GeminiHeader } | undefined {
  const end = received.indexOf(CRLF);
  const lf = received.indexOf(0x0a);
  if (lf >= 0 && (end < 0 || lf < end + 1)) return bad('A request ends with CR LF');
  if (end < 0) {
    return received.length > MAX_URL_BYTES + 1
      ? bad('The URL is longer than 1024 bytes')
      : undefined;
  }
  if (end > MAX_URL_BYTES) return bad('The URL is longer than 1024 bytes');
  try {
    return { line: new TextDecoder('utf-8', { fatal: true }).decode(received.subarray(0, end)) };
  } catch {
    return bad('The request is not UTF-8');
  }
}

/**
 * The search asks for its query with 10 and gets it back as the whole query
 * string, while its own pager links carry `q=` as HTTP's do.
 */
export function routeRequest(line: string, host: string): GeminiRoute {
  if (line === '' || [...line].some(outsideUrl)) {
    return bad('A request is one absolute URL');
  }
  let url: URL;
  try {
    url = new URL(line);
  } catch {
    return bad('A request is one absolute URL');
  }
  if (url.username !== '' || url.password !== '') {
    return bad('A request has no userinfo');
  }
  if (line.includes('#')) return bad('A request has no fragment');
  if (url.protocol !== 'gemini:' || bareHost(url.hostname) !== bareHost(host)) {
    return { header: { status: 53, meta: `This server answers only for gemini://${host}/` } };
  }

  const pathname = url.pathname === '' ? '/' : url.pathname;
  const query = url.search.slice(1);
  if (SEARCH_PATHS.has(pathname)) {
    if (query === '') return { header: { status: 10, meta: SEARCH_PROMPT } };
    if (!new URLSearchParams(query).has('q')) {
      try {
        return {
          paths: [`/search/index.gmi?q=${encodeURIComponent(decodeURIComponent(query))}`],
        };
      } catch {
        return bad('The query is not percent-encoded UTF-8');
      }
    }
    return { paths: [`/search/index.gmi?${query}`] };
  }
  const asked = `${pathname}${url.search}`;
  return pathname.endsWith('/')
    ? { paths: [`${pathname}index.gmi${url.search}`, asked] }
    : { paths: [asked] };
}

function outsideUrl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code <= 0x20 || code === 0x7f || code === 0xfeff;
}

function bareHost(host: string): string {
  return host.replace(/^\[(.*)\]$/, '$1').toLowerCase();
}

export function headerFor(response: Response, origin: string): GeminiHeader {
  const { status } = response;
  if (status >= 200 && status < 300) {
    return { status: 20, meta: response.headers.get('content-type') ?? 'application/octet-stream' };
  }
  if (status >= 300 && status < 400) {
    const location = response.headers.get('location');
    if (location === null) return { status: 40, meta: 'A redirect without a location' };
    return {
      status: status === 301 || status === 308 ? 31 : 30,
      meta: capsuleRelativeLocation(location, origin),
    };
  }
  switch (status) {
    case 400:
      return { status: 59, meta: 'Bad request' };
    case 404:
      return { status: 51, meta: 'Not found' };
    case 410:
      return { status: 52, meta: 'Gone' };
    case 429:
      return { status: 44, meta: response.headers.get('retry-after') ?? '60' };
    case 503:
      return { status: 41, meta: unavailable(response.headers.get('retry-after')) };
  }
  return status >= 400 && status < 500
    ? { status: 50, meta: 'Not available over Gemini' }
    : { status: 40, meta: 'Something went wrong' };
}

function capsuleRelativeLocation(location: string, origin: string): string {
  const site = new URL(origin);
  const target = new URL(location, site);
  return target.origin === site.origin ? `${target.pathname}${target.search}` : target.href;
}

function unavailable(retryAfter: string | null): string {
  if (retryAfter === null) return UNAVAILABLE;
  if (/^\d+$/.test(retryAfter)) {
    return `${UNAVAILABLE}; try again in ${describeWait(Number(retryAfter))}`;
  }
  const until = Date.parse(retryAfter);
  return Number.isNaN(until)
    ? UNAVAILABLE
    : `${UNAVAILABLE}; back by ${new Date(until).toISOString()}`;
}
