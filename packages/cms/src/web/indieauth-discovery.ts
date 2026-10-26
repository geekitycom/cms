import type { Hono, MiddlewareHandler } from 'hono';

import type { GeekityEnv } from './env.ts';
import { parseAuthorPath } from '../content/authors.ts';
import { requestPath } from './request.ts';
import { SCOPES, MICROPUB_SCOPES } from '../indieauth/request.ts';
import { MCP_SCOPES } from '../plugin.ts';

/** Where the authorization server metadata document is published. */
export const INDIEAUTH_METADATA_PATH = '/_geekity/indieauth/metadata';

/** RFC 8414's well-known location for the same document. */
export const OAUTH_METADATA_WELL_KNOWN_PATH = '/.well-known/oauth-authorization-server';

/** Where a client sends the person to approve a sign-in. */
export const AUTHORIZATION_PATH = '/_geekity/indieauth/auth';

/** Where a client redeems a code for an access token. */
export const TOKEN_PATH = '/_geekity/indieauth/token';

/** Where a resource server asks what a token is good for. */
export const INTROSPECTION_PATH = '/_geekity/indieauth/introspect';

/** Where a client registers itself, by RFC 7591 dynamic client registration. */
export const REGISTRATION_PATH = '/_geekity/indieauth/register';

/** Where the client_ids registration hands out live, each one's metadata in its path. */
export const REGISTERED_CLIENTS_PATH = '/_geekity/indieauth/clients/';

/** Where a client hands a token back to end it. */
export const REVOCATION_PATH = '/_geekity/indieauth/revoke';

/** Where a client asks for the profile a token was approved to see. */
export const USERINFO_PATH = '/_geekity/indieauth/userinfo';

/** Where a Micropub client creates posts and asks what the site supports. */
export const MICROPUB_PATH = '/_geekity/micropub';

/** Where a Micropub client uploads a file before it names it in a post. */
export const MICROPUB_MEDIA_PATH = '/_geekity/micropub/media';

export const MCP_PATH = '/_geekity/mcp';

export const MCP_SERVER_CARD_PATH = '/.well-known/mcp/server-card.json';

/**
 * RFC 9728's well-known location for the protected resource metadata, which
 * a client reads to learn where to sign in.
 */
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

/**
 * The MCP endpoint's own protected resource metadata. RFC 9728 puts the
 * well-known segment between the host and the resource's path.
 */
export const MCP_RESOURCE_METADATA_PATH = `${PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}`;

/** RFC 8414 authorization server metadata, as the IndieAuth spec profiles it. */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  introspection_endpoint: string;
  revocation_endpoint: string;
  userinfo_endpoint: string;
  registration_endpoint: string;
  response_types_supported: readonly string[];
  grant_types_supported: readonly string[];
  code_challenge_methods_supported: readonly string[];
  scopes_supported: readonly string[];
  authorization_response_iss_parameter_supported: boolean;
  /**
   * That a client may use the URL of a JSON client metadata document as its
   * client_id, which the MCP authorization spec asks for.
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
    registration_endpoint: `${baseUrl}${REGISTRATION_PATH}`,
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
    scopes_supported: MICROPUB_SCOPES,
    bearer_methods_supported: ['header', 'body'],
  };
}

export function mcpResourceMetadata(baseUrl: string): ProtectedResourceMetadata {
  return {
    resource: `${baseUrl}${MCP_PATH}`,
    authorization_servers: [authorizationServerMetadata(baseUrl).issuer],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ['header'],
  };
}

/**
 * Mount the authorization server metadata at its own path and at the
 * well-known one, and the site's and the MCP endpoint's protected resource
 * metadata at theirs.
 */
export function mountIndieAuthDiscovery(app: Hono<GeekityEnv>): void {
  for (const pathname of [INDIEAUTH_METADATA_PATH, OAUTH_METADATA_WELL_KNOWN_PATH]) {
    app.get(pathname, (c) => c.json(authorizationServerMetadata(c.var.config.baseUrl)));
  }
  app.get(PROTECTED_RESOURCE_METADATA_PATH, (c) =>
    c.json(protectedResourceMetadata(c.var.config.baseUrl)),
  );
  app.get(MCP_RESOURCE_METADATA_PATH, (c) => c.json(mcpResourceMetadata(c.var.config.baseUrl)));
}

/**
 * Whether a path is an identity URL a person may type into a sign-in form:
 * the root, and every author archive's first page.
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
 * Point every identity URL at the metadata, at the authorization
 * and token endpoints for clients that predate the metadata, and at
 * the Micropub endpoint, each with a `Link` header and a `<link>`
 * before `</head>`.
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

  const baseUrl = c.var.config.baseUrl;
  const metadata = authorizationServerMetadata(baseUrl);
  const links = [
    { rel: 'indieauth-metadata', href: `${baseUrl}${INDIEAUTH_METADATA_PATH}` },
    { rel: 'authorization_endpoint', href: metadata.authorization_endpoint },
    { rel: 'token_endpoint', href: metadata.token_endpoint },
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
