import type { Context, Hono, MiddlewareHandler } from 'hono';

import { effectiveBaseUrl, readSiteSettings } from '../admin/settings.ts';
import type { GeekityEnv } from '../env.ts';
import { parseAuthorPath } from '../web/authors.ts';
import { requestPath } from '../web/routes.ts';

/** Where the authorization server metadata document is published. */
export const INDIEAUTH_METADATA_PATH = '/_geekity/indieauth/metadata';

/** RFC 8414's well-known location for the same document. */
export const OAUTH_METADATA_WELL_KNOWN_PATH = '/.well-known/oauth-authorization-server';

/** Where a client sends the person to approve a sign-in (TASK-158). */
export const AUTHORIZATION_PATH = '/_geekity/indieauth/auth';

/** Where a client redeems a code for an access token (TASK-160). */
export const TOKEN_PATH = '/_geekity/indieauth/token';

/** The scopes a client may ask for. TASK-160 adds the Micropub ones. */
export const SCOPES = ['profile', 'email'] as const;

/** RFC 8414 authorization server metadata, as the IndieAuth spec profiles it. */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  response_types_supported: readonly string[];
  grant_types_supported: readonly string[];
  code_challenge_methods_supported: readonly string[];
  scopes_supported: readonly string[];
  authorization_response_iss_parameter_supported: boolean;
}

/**
 * The metadata for a site at `baseUrl`.
 *
 * The issuer is the base URL with no trailing slash: RFC 8414 builds the
 * well-known URL by putting `/.well-known/oauth-authorization-server` between
 * the issuer's host and its path, so an issuer with no path is the one whose
 * document lives at exactly that URL, and a client that checks the two agree
 * finds they do.
 */
export function authorizationServerMetadata(baseUrl: string): AuthorizationServerMetadata {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}${AUTHORIZATION_PATH}`,
    token_endpoint: `${baseUrl}${TOKEN_PATH}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
  };
}

function siteBaseUrl(c: Context<GeekityEnv>): string {
  const { config } = c.var;
  return effectiveBaseUrl(config, readSiteSettings(config.contentDir));
}

/** Mount the metadata document at its own path and at the well-known one. */
export function mountIndieAuthDiscovery(app: Hono<GeekityEnv>): void {
  for (const pathname of [INDIEAUTH_METADATA_PATH, OAUTH_METADATA_WELL_KNOWN_PATH]) {
    app.get(pathname, (c) => c.json(authorizationServerMetadata(siteBaseUrl(c))));
  }
}

/**
 * Whether a path is an identity URL a person may type into a sign-in form:
 * the root, and every author archive's first page (decision-23).
 *
 * The root is advertised on a multi-author site too, where it names nobody: a
 * person who types it still reaches this server, signs in as whoever they log
 * in as, and the client is handed that user's author URL, which shares the
 * host and advertises the same server.
 */
function isIdentityPath(pathname: string): boolean {
  return pathname === '/' || parseAuthorPath(pathname)?.pageNumber === 0;
}

/**
 * Point every identity URL at the metadata, with a `Link` header and a
 * `<link>` before `</head>` (TASK-157).
 *
 * Added to the response rather than left to the layouts so that every theme
 * carries it, a custom one that replaces the packaged base layout included. A
 * 404 for a username nobody has is left alone: it is nobody's identity.
 */
export const advertiseIndieAuthMetadata: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  await next();
  if (!isIdentityPath(requestPath(c))) return;
  const { status } = c.res;
  if (status !== 304 && (status < 200 || status >= 300)) return;

  const href = `${siteBaseUrl(c)}${INDIEAUTH_METADATA_PATH}`;
  c.res.headers.append('link', `<${href}>; rel="indieauth-metadata"`);
  if (status === 304 || !(c.res.headers.get('content-type') ?? '').startsWith('text/html')) return;

  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  const body = withHeadLink(await c.res.text(), `<link rel="indieauth-metadata" href="${href}">`);
  // Cleared first, because assigning over a response copies its headers onto
  // the new one.
  c.res = undefined;
  c.res = new Response(body, { status, headers });
};

/** `html` with `link` just before its `</head>`, or unchanged when it has none. */
function withHeadLink(html: string, link: string): string {
  const head = /<\/head\s*>/i.exec(html);
  if (head === null) return html;
  return `${html.slice(0, head.index)}${link}${html.slice(head.index)}`;
}
