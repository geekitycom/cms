import { linkTargets } from '../webmention/discovery.ts';
import { fetchPublic, webUrl } from '../webmention/fetch-public.ts';
import { elementsIn, hasRel, parseHtml } from '../webmention/html.ts';
import { itemsIn } from '../webmention/microformats.ts';
import type { MicroformatItem } from '../webmention/microformats.ts';
import type { HostLookup } from '../webmention/public-address.ts';

/** What a client says about itself at its client_id URL. */
export interface ClientInformation {
  /** What to call it on the consent screen. */
  readonly name?: string;
  /** Its home page. */
  readonly url?: string;
  /** Where its logo is, an http or https URL. */
  readonly logo?: string;
  /** Where it may be sent back to, besides its own origin. */
  readonly redirectUris: readonly string[];
}

/** How long a client is given to answer. */
export const CLIENT_FETCH_TIMEOUT_MS = 5000;

/** The most of a client's page or document that is read. */
export const CLIENT_FETCH_MAX_BYTES = 512 * 1024;

/** The most of a client's logo that is read. */
export const CLIENT_LOGO_MAX_BYTES = 64 * 1024;

/** The image types a logo may be, which a browser shows in an `<img>`. */
const LOGO_TYPE =
  /^\s*(image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon))\s*(?:;|$)/i;

/** What {@link fetchClientInformation} and {@link fetchClientLogo} need. */
export interface FetchClientOptions {
  readonly lookup: HostLookup;
  readonly timeoutMs?: number | undefined;
  readonly maxBytes?: number | undefined;
}

/** What fetching one client_id came to. */
export type ClientFetch =
  | { readonly ok: true; readonly client: ClientInformation }
  | { readonly ok: false; readonly reason: string };

/**
 * Fetch a client_id URL and read what it says about the client.
 *
 * The URL is whatever the person's browser was sent here with, so the fetch
 * goes through {@link fetchPublic}: public hosts only, every redirect hop
 * checked, one timeout and a byte limit.
 */
export async function fetchClientInformation(
  clientId: string,
  options: FetchClientOptions,
): Promise<ClientFetch> {
  const fetched = await fetchPublic(clientId, {
    lookup: options.lookup,
    signal: AbortSignal.timeout(options.timeoutMs ?? CLIENT_FETCH_TIMEOUT_MS),
    maxBytes: options.maxBytes ?? CLIENT_FETCH_MAX_BYTES,
    accept: 'application/json, text/html;q=0.9',
    contentType: {
      pattern: /^\s*(application\/(?:[\w.+-]+\+)?json|text\/html|application\/xhtml\+xml)/i,
      name: 'JSON client metadata or an HTML page',
    },
  });
  if (!fetched.ok) return fetched;
  const body = new TextDecoder().decode(fetched.body);
  return {
    ok: true,
    client: readClientInformation(body, fetched.type, clientId, fetched.url, fetched.link),
  };
}

/**
 * Fetch a client's logo as a `data:` URI, or `undefined` when it cannot be had.
 *
 * Fetched here rather than linked from the page, so the admin's `img-src`
 * never names the client and the client never learns the address of the
 * person approving it, or when. The fetch is held to {@link fetchPublic}'s
 * rules like the client_id itself, to image types only, and to
 * {@link CLIENT_LOGO_MAX_BYTES}.
 */
export async function fetchClientLogo(
  url: string,
  options: FetchClientOptions,
): Promise<string | undefined> {
  const fetched = await fetchPublic(url, {
    lookup: options.lookup,
    signal: AbortSignal.timeout(options.timeoutMs ?? CLIENT_FETCH_TIMEOUT_MS),
    maxBytes: options.maxBytes ?? CLIENT_LOGO_MAX_BYTES,
    accept: 'image/*',
    contentType: { pattern: LOGO_TYPE, name: 'an image' },
  });
  if (!fetched.ok) return undefined;
  const type = LOGO_TYPE.exec(fetched.type)?.[1]?.toLowerCase() ?? 'image/png';
  return `data:${type};base64,${Buffer.from(fetched.body).toString('base64')}`;
}

/**
 * What a client_id document says, by its content type.
 *
 * A JSON document is a client metadata document, which the OAuth Client ID
 * Metadata Document draft and MCP use. Its `client_id` must be its own URL;
 * one that names another client is read as saying nothing. Anything else is
 * read as an HTML page with an IndieAuth `h-app` (or the older `h-x-app`) and
 * `rel="redirect_uri"` links, in the response's `Link` header or in the page.
 */
export function readClientInformation(
  body: string,
  type: string,
  clientId: string,
  base: string = clientId,
  link: string | null = null,
): ClientInformation {
  return /json/i.test(type) ? fromJson(body, clientId) : fromHtml(body, base, link);
}

function fromJson(body: string, clientId: string): ClientInformation {
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    return { redirectUris: [] };
  }
  if (typeof document !== 'object' || document === null) return { redirectUris: [] };
  const fields = document as Record<string, unknown>;
  if (!sameUrl(fields['client_id'], clientId)) return { redirectUris: [] };

  const name = fields['client_name'];
  const url = fields['client_uri'];
  const logo = logoUrl(fields['logo_uri']);
  const redirectUris = Array.isArray(fields['redirect_uris'])
    ? fields['redirect_uris'].filter((uri): uri is string => typeof uri === 'string')
    : [];
  return {
    ...(typeof name === 'string' && name.trim() !== '' ? { name: name.trim() } : {}),
    ...(typeof url === 'string' && URL.canParse(url) ? { url } : {}),
    ...(logo === undefined ? {} : { logo }),
    redirectUris,
  };
}

function fromHtml(body: string, base: string, link: string | null): ClientInformation {
  const root = parseHtml(body);
  const app = firstApp(itemsIn(root, base));
  const name = app?.properties['name']?.[0]?.text.trim();
  const url = app?.properties['url']?.[0]?.text;
  const logo = logoUrl(app?.properties['logo']?.[0]?.text);

  const hrefs = linkTargets(link, 'redirect_uri');
  for (const element of elementsIn(root)) {
    if ((element.name === 'link' || element.name === 'a') && hasRel(element, 'redirect_uri')) {
      hrefs.push(element.attributes['href'] ?? '');
    }
  }
  const redirectUris = hrefs.flatMap((href) => URL.parse(href, base)?.href ?? []);

  return {
    ...(name === undefined || name === '' ? {} : { name }),
    ...(url === undefined ? {} : { url }),
    ...(logo === undefined ? {} : { logo }),
    redirectUris,
  };
}

/** `value` when it is an absolute http or https URL. */
function logoUrl(value: unknown): string | undefined {
  return typeof value === 'string' ? webUrl(value)?.href : undefined;
}

function firstApp(items: readonly MicroformatItem[]): MicroformatItem | undefined {
  for (const item of items) {
    if (item.types.includes('h-app') || item.types.includes('h-x-app')) return item;
    const nested = firstApp(item.children);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function sameUrl(value: unknown, clientId: string): boolean {
  if (typeof value !== 'string') return false;
  const url = URL.parse(value);
  return url !== null && url.href === new URL(clientId).href;
}
