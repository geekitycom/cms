import { clientIdentifier, sameClient } from './client-id.ts';
import { SCOPES } from './discovery.ts';

/** A scope this site can grant. */
export type Scope = (typeof SCOPES)[number];

/**
 * What a code is bound to: the S256 PKCE challenge the client must answer to
 * redeem it, or nothing, for an app on the site's list of apps allowed to
 * sign in without PKCE (TASK-225). Redemption reads it off the stored code,
 * never off the redeeming request, so a request cannot drop PKCE from a
 * sign-in that began with it.
 */
export type CodeChallenge =
  { readonly method: 'S256'; readonly value: string } | { readonly method: 'none' };

/** A sign-in a client asked for, every field checked. */
export interface AuthorizationRequest {
  /** The client's URL, which is its identifier. */
  readonly clientId: string;
  /** Where the person is sent back with the answer. */
  readonly redirectUri: string;
  /** Handed back untouched, so the client can match the answer to its request. */
  readonly state: string;
  /** The PKCE challenge the code will be bound to, or none for a listed app. */
  readonly codeChallenge: CodeChallenge;
  /** The scopes asked for that this site offers, in the order asked. */
  readonly scopes: readonly Scope[];
  /** The URL the person typed into the client, when the client passed it on. */
  readonly me?: string;
  /** The RFC 8707 resource the token is wanted for, when the client named one. */
  readonly resource?: string;
}

/** The OAuth error codes a refused request is reported with. */
export type AuthorizationError = 'invalid_request' | 'unsupported_response_type' | 'invalid_target';

/**
 * What a request to the authorization endpoint came to.
 *
 * `unredirectable` is a fault in `client_id` or `redirect_uri`: there is no
 * address known to be the client's, so the person is shown a page. `refused`
 * is any other fault, reported at `redirect_uri` once the client's metadata
 * shows that address is the client's.
 */
export type ParsedAuthorizationRequest =
  | { readonly kind: 'valid'; readonly request: AuthorizationRequest }
  | {
      readonly kind: 'refused';
      readonly clientId: string;
      readonly redirectUri: string;
      readonly state: string | undefined;
      readonly error: AuthorizationError;
      readonly description: string;
    }
  | { readonly kind: 'unredirectable'; readonly message: string };

/** An S256 challenge: 32 bytes of hash in unpadded base64url. */
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** Schemes a redirect may never use, whatever a client's metadata lists. */
const SCRIPTING_SCHEMES: ReadonlySet<string> = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
]);

/**
 * Scopes from before the IndieAuth spec named create and update, as the
 * scopes they stand for, so the consent screen and the grant show those.
 * Quill still offers `post` at sign-in.
 */
const LEGACY_SCOPES: ReadonlyMap<string, readonly Scope[]> = new Map([
  ['post', ['create', 'update']],
]);

/**
 * Read an authorization request off its query string, for a site at `baseUrl`
 * whose owner lets the apps in `clientsWithoutPkce` sign in without PKCE.
 */
export function parseAuthorizationRequest(
  params: URLSearchParams,
  baseUrl: string,
  clientsWithoutPkce: readonly string[],
): ParsedAuthorizationRequest {
  const clientId = clientIdentifier(params.get('client_id') ?? '');
  if (clientId === undefined) {
    return { kind: 'unredirectable', message: 'The app did not say which app it is.' };
  }
  const redirectUri = redirectAddress(params.get('redirect_uri') ?? '');
  if (redirectUri === undefined) {
    return { kind: 'unredirectable', message: 'The app did not say where to send you back.' };
  }

  const state = params.get('state') ?? undefined;
  const refuse = (error: AuthorizationError, description: string): ParsedAuthorizationRequest => ({
    kind: 'refused',
    clientId,
    redirectUri,
    state,
    error,
    description,
  });

  if (params.get('response_type') !== 'code') {
    return refuse('unsupported_response_type', 'response_type must be code');
  }
  if (state === undefined || state === '') return refuse('invalid_request', 'state is required');
  const codeChallenge = challengeOf(params, clientId, redirectUri, clientsWithoutPkce);
  if (codeChallenge === undefined) {
    return refuse('invalid_request', 'code_challenge must be an S256 PKCE challenge');
  }
  if (codeChallenge.method === 'S256' && params.get('code_challenge_method') !== 'S256') {
    return refuse('invalid_request', 'code_challenge_method must be S256');
  }

  const resources = params.getAll('resource');
  if (resources.length > 1) return refuse('invalid_target', 'name at most one resource');
  const resource = resources[0];
  if (resource !== undefined && !onSite(resource, baseUrl)) {
    return refuse('invalid_target', 'resource must be an absolute URL on this site');
  }

  const offered: ReadonlySet<string> = new Set(SCOPES);
  const asked = (params.get('scope') ?? '')
    .split(' ')
    .flatMap((scope) => LEGACY_SCOPES.get(scope) ?? scope);
  const scopes = [...new Set(asked)].filter((scope): scope is Scope => offered.has(scope));
  const me = params.get('me') ?? '';

  return {
    kind: 'valid',
    request: {
      clientId,
      redirectUri,
      state,
      codeChallenge,
      scopes,
      ...(me === '' ? {} : { me }),
      ...(resource === undefined ? {} : { resource }),
    },
  };
}

/**
 * The challenge a request binds its code to, or `undefined` when it has none
 * it may sign in with.
 *
 * Without PKCE only when the request sends neither PKCE field, its client_id
 * is listed, and its redirect_uri is https on the client_id's own host: a
 * return address a native app claims as a verified universal link or app
 * link, so an intercepted code is harder to come by.
 */
function challengeOf(
  params: URLSearchParams,
  clientId: string,
  redirectUri: string,
  clientsWithoutPkce: readonly string[],
): CodeChallenge | undefined {
  const value = params.get('code_challenge');
  if (value !== null) return S256_CHALLENGE.test(value) ? { method: 'S256', value } : undefined;
  const redirect = new URL(redirectUri);
  const unchallenged =
    !params.has('code_challenge_method') &&
    clientsWithoutPkce.some((listed) => sameClient(listed, clientId)) &&
    redirect.protocol === 'https:' &&
    redirect.host === new URL(clientId).host;
  return unchallenged ? { method: 'none' } : undefined;
}

/** An absolute redirect_uri with no fragment and no scripting scheme, or `undefined`. */
function redirectAddress(value: string): string | undefined {
  const url = URL.parse(value);
  if (url === null || value.includes('#') || SCRIPTING_SCHEMES.has(url.protocol)) return undefined;
  return value;
}

/** Whether `value` is an absolute URL, with no fragment, on the site's own origin. */
function onSite(value: string, baseUrl: string): boolean {
  const url = URL.parse(value);
  return url !== null && !value.includes('#') && url.origin === new URL(baseUrl).origin;
}
