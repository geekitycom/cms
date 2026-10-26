import type { ClientInformation } from './client.ts';
import { webUrl } from '../webmention/fetch-public.ts';

/**
 * RFC 7591 dynamic client registration, kept stateless: the registered
 * metadata is the client_id. It is encoded into the path of a URL under the
 * site's clients prefix, and decoded wherever the id is read, so registering
 * writes nothing and any number of registrations costs no storage.
 *
 * Nothing signs the payload, and nothing needs to: registration is open, so a
 * client_id made up by hand is no different from one this endpoint handed
 * out. What matters is that a decoded id is held to the same rules as a
 * registration, and that it returns codes only to the redirect_uris it names.
 */

/** The most redirect_uris one registration may name, which keeps a client_id short. */
export const MAX_REDIRECT_URIS = 5;

export const MAX_URI_LENGTH = 512;

export const MAX_CLIENT_NAME_LENGTH = 100;

export type RegistrationError = 'invalid_redirect_uri' | 'invalid_client_metadata';

export type Registration =
  | { readonly ok: true; readonly client: ClientInformation }
  | { readonly ok: false; readonly error: RegistrationError; readonly description: string };

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Read an RFC 7591 registration request's metadata. */
export function parseRegistration(metadata: unknown): Registration {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return invalid('invalid_client_metadata', 'The body must be a JSON object.');
  }
  const fields = metadata as Record<string, unknown>;

  const uris = fields['redirect_uris'];
  if (!Array.isArray(uris) || uris.length === 0) {
    return invalid('invalid_redirect_uri', 'redirect_uris must list at least one URL.');
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    return invalid(
      'invalid_redirect_uri',
      `redirect_uris may list at most ${String(MAX_REDIRECT_URIS)} URLs.`,
    );
  }
  const redirectUris: string[] = [];
  for (const uri of uris) {
    if (typeof uri !== 'string' || !isRedirectUri(uri)) {
      return invalid(
        'invalid_redirect_uri',
        'Each redirect_uri must be an https URL, or http on a loopback address, with no fragment.',
      );
    }
    redirectUris.push(uri);
  }

  const grantTypes = fields['grant_types'];
  if (
    grantTypes !== undefined &&
    !(Array.isArray(grantTypes) && grantTypes.includes('authorization_code'))
  ) {
    return invalid('invalid_client_metadata', 'grant_types must include authorization_code.');
  }
  const responseTypes = fields['response_types'];
  if (
    responseTypes !== undefined &&
    !(Array.isArray(responseTypes) && responseTypes.length === 1 && responseTypes[0] === 'code')
  ) {
    return invalid('invalid_client_metadata', 'response_types must be ["code"].');
  }

  const name = fields['client_name'];
  if (name !== undefined && (typeof name !== 'string' || name.length > MAX_CLIENT_NAME_LENGTH)) {
    return invalid(
      'invalid_client_metadata',
      `client_name must be text of at most ${String(MAX_CLIENT_NAME_LENGTH)} characters.`,
    );
  }
  const url = fields['client_uri'];
  if (url !== undefined && !isWebUri(url)) {
    return invalid('invalid_client_metadata', 'client_uri must be an http or https URL.');
  }
  const logo = fields['logo_uri'];
  if (logo !== undefined && !isWebUri(logo)) {
    return invalid('invalid_client_metadata', 'logo_uri must be an http or https URL.');
  }

  const trimmed = name?.trim();
  return {
    ok: true,
    client: {
      ...(trimmed === undefined || trimmed === '' ? {} : { name: trimmed }),
      ...(url === undefined ? {} : { url }),
      ...(logo === undefined ? {} : { logo }),
      redirectUris,
    },
  };
}

/** The client_id that carries `client`, under `clientsUrl`. */
export function registeredClientId(clientsUrl: string, client: ClientInformation): string {
  const payload = Buffer.from(JSON.stringify(clientMetadata(client)), 'utf8').toString('base64url');
  return `${clientsUrl}${payload}`;
}

/**
 * What a client_id under `clientsUrl` was registered with: `undefined` when
 * the id is not under it, and no redirect_uris at all when it is but does not
 * decode, so a damaged id can be sent back nowhere.
 */
export function registeredClient(
  clientId: string,
  clientsUrl: string,
): ClientInformation | undefined {
  const url = URL.parse(clientId);
  const prefix = new URL(clientsUrl);
  if (url?.origin !== prefix.origin || !url.pathname.startsWith(prefix.pathname)) {
    return undefined;
  }
  const decoded =
    url.search === '' ? decodeClient(url.pathname.slice(prefix.pathname.length)) : undefined;
  return decoded ?? { redirectUris: [] };
}

/** The client metadata a payload was encoded from, or `undefined` when it holds none. */
export function decodeClient(payload: string): ClientInformation | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return undefined;
  let metadata: unknown;
  try {
    metadata = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = parseRegistration(metadata);
  return parsed.ok ? parsed.client : undefined;
}

/** The RFC 7591 names for what a client registered. */
export function clientMetadata(client: ClientInformation): Record<string, unknown> {
  return {
    ...(client.name === undefined ? {} : { client_name: client.name }),
    ...(client.url === undefined ? {} : { client_uri: client.url }),
    ...(client.logo === undefined ? {} : { logo_uri: client.logo }),
    redirect_uris: client.redirectUris,
  };
}

function isRedirectUri(value: string): boolean {
  if (value.length > MAX_URI_LENGTH || value.includes('#')) return false;
  const url = URL.parse(value);
  if (url === null || url.username !== '' || url.password !== '') return false;
  return (
    (url.protocol === 'https:' && url.hostname !== '') ||
    (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  );
}

function isWebUri(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_URI_LENGTH && webUrl(value) !== undefined;
}

function invalid(error: RegistrationError, description: string): Registration {
  return { ok: false, error, description };
}
