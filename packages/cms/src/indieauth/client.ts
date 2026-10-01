import { fetchPublic } from '../webmention/fetch-public.ts';
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
  /** Where it may be sent back to, besides its own origin. */
  readonly redirectUris: readonly string[];
}

/** How long a client is given to answer. */
export const CLIENT_FETCH_TIMEOUT_MS = 5000;

/** The most of a client's page or document that is read. */
export const CLIENT_FETCH_MAX_BYTES = 512 * 1024;

/** What {@link fetchClientInformation} needs. */
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
    timeoutMs: options.timeoutMs ?? CLIENT_FETCH_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? CLIENT_FETCH_MAX_BYTES,
    accept: 'application/json, text/html;q=0.9',
    contentType: {
      pattern: /^\s*(application\/(?:[\w.+-]+\+)?json|text\/html|application\/xhtml\+xml)/i,
      name: 'JSON client metadata or an HTML page',
    },
  });
  if (!fetched.ok) return fetched;
  const body = new TextDecoder().decode(fetched.body);
  return { ok: true, client: readClientInformation(body, fetched.type, clientId, fetched.url) };
}

/**
 * What a client_id document says, by its content type.
 *
 * A JSON document is a client metadata document, which the OAuth Client ID
 * Metadata Document draft and MCP use. Its `client_id` must be its own URL;
 * one that names another client is read as saying nothing. Anything else is
 * read as an HTML page with an IndieAuth `h-app` (or the older `h-x-app`) and
 * `rel="redirect_uri"` links.
 */
export function readClientInformation(
  body: string,
  type: string,
  clientId: string,
  base: string = clientId,
): ClientInformation {
  return /json/i.test(type) ? fromJson(body, clientId) : fromHtml(body, base);
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
  const redirectUris = Array.isArray(fields['redirect_uris'])
    ? fields['redirect_uris'].filter((uri): uri is string => typeof uri === 'string')
    : [];
  return {
    ...(typeof name === 'string' && name.trim() !== '' ? { name: name.trim() } : {}),
    ...(typeof url === 'string' && URL.canParse(url) ? { url } : {}),
    redirectUris,
  };
}

function fromHtml(body: string, base: string): ClientInformation {
  const root = parseHtml(body);
  const app = firstApp(itemsIn(root, base));
  const name = app?.properties['name']?.[0]?.text.trim();
  const url = app?.properties['url']?.[0]?.text;

  const redirectUris: string[] = [];
  for (const element of elementsIn(root)) {
    if ((element.name !== 'link' && element.name !== 'a') || !hasRel(element, 'redirect_uri')) {
      continue;
    }
    const href = URL.parse(element.attributes['href'] ?? '', base);
    if (href !== null) redirectUris.push(href.href);
  }

  return {
    ...(name === undefined || name === '' ? {} : { name }),
    ...(url === undefined ? {} : { url }),
    redirectUris,
  };
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
