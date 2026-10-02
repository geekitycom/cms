import type { Hono, MiddlewareHandler } from 'hono';

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

/** Where a resource server asks what a token is good for (TASK-161). */
export const INTROSPECTION_PATH = '/_geekity/indieauth/introspect';

/** Where a client hands a token back to end it (TASK-161). */
export const REVOCATION_PATH = '/_geekity/indieauth/revoke';

/** Where a client asks for the profile a token was approved to see (TASK-161). */
export const USERINFO_PATH = '/_geekity/indieauth/userinfo';

/** Where a Micropub client creates posts and asks what the site supports (TASK-163). */
export const MICROPUB_PATH = '/_geekity/micropub';

/** Where a Micropub client uploads a file before it names it in a post (TASK-165). */
export const MICROPUB_MEDIA_PATH = '/_geekity/micropub/media';

/**
 * RFC 9728's well-known location for the protected resource metadata, which
 * an MCP client reads to learn where to sign in (TASK-161).
 */
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

/**
 * The scopes a client may ask for: the profile ones (TASK-158) and the
 * Micropub ones a token is issued for (TASK-160).
 */
export const SCOPES = ['profile', 'email', 'create', 'update', 'delete', 'media'] as const;

/** RFC 8414 authorization server metadata, as the IndieAuth spec profiles it. */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  introspection_endpoint: string;
  revocation_endpoint: string;
  userinfo_endpoint: string;
  response_types_supported: readonly string[];
  grant_types_supported: readonly string[];
  code_challenge_methods_supported: readonly string[];
  scopes_supported: readonly string[];
  authorization_response_iss_parameter_supported: boolean;
  /**
   * That a client may use the URL of a JSON client metadata document as its
   * client_id, which the MCP authorization spec asks for (TASK-158).
   */
  client_id_metadata_document_supported: boolean;
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
    introspection_endpoint: `${baseUrl}${INTROSPECTION_PATH}`,
    revocation_endpoint: `${baseUrl}${REVOCATION_PATH}`,
    userinfo_endpoint: `${baseUrl}${USERINFO_PATH}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

/** RFC 9728 protected resource metadata. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: readonly string[];
  scopes_supported: readonly string[];
  bearer_methods_supported: readonly string[];
}

/**
 * The protected resource metadata for a site at `baseUrl`: the site is the
 * resource, and its own authorization server is the one to sign in at. A
 * token may come in the header or, as Micropub allows, in a form body.
 */
export function protectedResourceMetadata(baseUrl: string): ProtectedResourceMetadata {
  return {
    resource: baseUrl,
    authorization_servers: [authorizationServerMetadata(baseUrl).issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header', 'body'],
  };
}

/** The site's base URL as every absolute URL it hands out is built from. */
export function siteBaseUrl(c: { var: Pick<GeekityEnv['Variables'], 'config'> }): string {
  const { config } = c.var;
  return effectiveBaseUrl(config, readSiteSettings(config.contentDir));
}

/**
 * Mount the authorization server metadata at its own path and at the
 * well-known one, and the protected resource metadata at its well-known one.
 */
export function mountIndieAuthDiscovery(app: Hono<GeekityEnv>): void {
  for (const pathname of [INDIEAUTH_METADATA_PATH, OAUTH_METADATA_WELL_KNOWN_PATH]) {
    app.get(pathname, (c) => c.json(authorizationServerMetadata(siteBaseUrl(c))));
  }
  app.get(PROTECTED_RESOURCE_METADATA_PATH, (c) =>
    c.json(protectedResourceMetadata(siteBaseUrl(c))),
  );
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
 * Point every identity URL at the metadata (TASK-157) and the Micropub
 * endpoint (TASK-163), each with a `Link` header and a `<link>` before
 * `</head>`.
 *
 * Added to the response rather than left to the layouts so that every theme
 * carries them, a custom one that replaces the packaged base layout included. A
 * 404 for a username nobody has is left alone: it is nobody's identity.
 */
export const advertiseIdentityEndpoints: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  await next();
  if (!isIdentityPath(requestPath(c))) return;
  const { status } = c.res;
  if (status !== 304 && (status < 200 || status >= 300)) return;

  const baseUrl = siteBaseUrl(c);
  const links = [
    { rel: 'indieauth-metadata', href: `${baseUrl}${INDIEAUTH_METADATA_PATH}` },
    { rel: 'micropub', href: `${baseUrl}${MICROPUB_PATH}` },
  ];
  for (const { rel, href } of links) c.res.headers.append('link', `<${href}>; rel="${rel}"`);
  if (status === 304 || !(c.res.headers.get('content-type') ?? '').startsWith('text/html')) return;

  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  const headLinks = links.map(({ rel, href }) => `<link rel="${rel}" href="${href}">`).join('');
  const body = withHeadLink(await c.res.text(), headLinks);
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
