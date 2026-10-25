import type { Context, Hono, MiddlewareHandler } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../web/env.ts';
import { bearerChallenge, requireBearer } from '../web/indieauth-bearer.ts';
import type { BearerEnv } from '../web/indieauth-bearer.ts';
import {
  MCP_PATH,
  MCP_RESOURCE_METADATA_PATH,
  MCP_SERVER_CARD_PATH,
} from '../web/indieauth-discovery.ts';
import { PACKAGE_VERSION } from '../util/package-version.ts';
import {
  failure,
  isSupportedVersion,
  JSON_RPC_ERRORS,
  LATEST_PROTOCOL_VERSION,
  reply,
  SERVER_CAPABILITIES,
} from './protocol.ts';
import type { JsonRpcResponse, ServerInfo } from './protocol.ts';
import { auditToolCall } from './audit.ts';
import { createCallLimit } from './call-limit.ts';
import { createToolRegistry } from './tools.ts';
import type { McpTool, ToolGuards } from './tools.ts';
import { activePluginTools } from './plugin-tools.ts';
import { whoami } from './whoami.ts';
import { inboxSearch } from './inspect/inbox.ts';
import { postFederation } from './inspect/post.ts';
import { followers, quoteApprovals, relays } from './inspect/records.ts';
import { federationStatus } from './inspect/status.ts';
import { webmentions } from './inspect/webmentions.ts';

/** The tools core offers. */
const CORE_TOOLS: readonly McpTool[] = [
  whoami,
  federationStatus,
  inboxSearch,
  postFederation,
  followers,
  relays,
  quoteApprovals,
  webmentions,
];

/** How many tool calls one token may make in {@link MCP_CALL_WINDOW_SECONDS}. */
export const MCP_CALLS_PER_WINDOW = 60;

export const MCP_CALL_WINDOW_SECONDS = 60;

/**
 * The MCP endpoint, over Streamable HTTP, and the server card that describes
 * it.
 *
 * Stateless: every POST carries one JSON-RPC message and its bearer token,
 * and is answered with one JSON object, so there is no session to keep and no
 * stream to hold open. GET and DELETE, which open a stream and end a session,
 * answer 405, as the transport allows. Not exempt from maintenance mode, like
 * the authorization and token endpoints its tokens come from.
 */
export function mountMcp(app: Hono<GeekityEnv>): void {
  // Built on the first call, because the clock and the data directory are on
  // the context. The limit lives in the process, like the sign-in throttle.
  let guards: ToolGuards | undefined;
  function guardsFor(config: ResolvedConfig): ToolGuards {
    guards ??= {
      limit: createCallLimit({
        calls: MCP_CALLS_PER_WINDOW,
        windowSeconds: MCP_CALL_WINDOW_SECONDS,
        now: config.now,
      }),
      record: (record) => {
        auditToolCall(config.dataDir, record, config.now());
      },
    };
    return guards;
  }

  app.post(MCP_PATH, sameOriginOnly, requireMcpToken, async (c) => {
    c.header('cache-control', 'no-store');
    const version = c.req.header('mcp-protocol-version');
    if (version !== undefined && !isSupportedVersion(version)) {
      return c.json(
        failure(null, {
          code: JSON_RPC_ERRORS.invalidRequest,
          message: `This server does not speak MCP ${version}.`,
        }),
        400,
      );
    }

    let message: unknown;
    try {
      message = await c.req.json();
    } catch {
      return c.json(
        failure(null, { code: JSON_RPC_ERRORS.parseError, message: 'The body is not JSON.' }),
        400,
      );
    }

    const { user, token } = c.var.bearer;
    const answered = await reply(message, {
      registry: createToolRegistry(toolsFor(c.var), guardsFor(c.var.config)),
      info: serverInfo(c.var.siteAtRequestStart.title),
      call: { user, token, signal: c.req.raw.signal, site: c.var },
    });
    switch (answered.kind) {
      case 'accepted':
        return c.body(null, 202);
      case 'answer':
        return c.json(answered.message);
      case 'malformed':
        return c.json(answered.message, 400);
      case 'insufficient-scope':
        return refuseForScope(c, [...token.scopes, answered.scope], answered.message);
    }
  });

  app.on(['GET', 'DELETE'], MCP_PATH, sameOriginOnly, requireMcpToken, (c) => {
    c.header('allow', 'POST');
    return c.body(null, 405);
  });

  app.get(MCP_SERVER_CARD_PATH, (c) => {
    const { baseUrl } = c.var.config;
    return c.json({
      serverInfo: serverInfo(c.var.siteAtRequestStart.title),
      description: 'Tools for inspecting and running this Geekity CMS site.',
      protocolVersion: LATEST_PROTOCOL_VERSION,
      transport: { type: 'streamable-http', endpoint: `${baseUrl}${MCP_PATH}` },
      capabilities: SERVER_CAPABILITIES,
      authentication: {
        required: true,
        schemes: ['oauth2'],
        resourceMetadata: `${baseUrl}${MCP_RESOURCE_METADATA_PATH}`,
      },
      tools: toolsFor(c.var).map(({ name, title, description }) => ({ name, title, description })),
    });
  });
}

/** Core's tools and those of the plugins active for this request. */
function toolsFor(vars: Readonly<GeekityEnv['Variables']>): readonly McpTool[] {
  return [...CORE_TOOLS, ...activePluginTools(vars)];
}

function serverInfo(title: string): ServerInfo {
  return { name: 'geekity', title, version: PACKAGE_VERSION };
}

/**
 * The bearer guard for a token bound to the MCP endpoint and nothing else.
 * Built per request because the base URL is a setting.
 */
const requireMcpToken: MiddlewareHandler<BearerEnv> = async (c, next) =>
  await requireBearer({
    audience: { resource: `${c.var.config.baseUrl}${MCP_PATH}`, acceptsUnbound: false },
    resourceMetadataPath: MCP_RESOURCE_METADATA_PATH,
  })(c, next);

/**
 * A browser sends an Origin header, and a page on another origin must not
 * reach the endpoint through it: the transport spec's guard against DNS
 * rebinding. A client that is not a browser sends none and is let through.
 */
const sameOriginOnly: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  const origin = c.req.header('origin');
  if (origin !== undefined && origin !== new URL(c.var.config.baseUrl).origin) {
    return c.json(
      failure(null, {
        code: JSON_RPC_ERRORS.invalidRequest,
        message: 'Requests from another origin are refused.',
      }),
      403,
    );
  }
  await next();
};

/**
 * The MCP authorization spec's answer to a token short of a scope: 403 with a
 * challenge naming the scopes the token holds and the one it lacks, so a
 * client can ask the person for them all in one sign-in.
 */
function refuseForScope(
  c: Context<BearerEnv>,
  scopes: readonly string[],
  message: JsonRpcResponse,
): Response {
  c.header(
    'www-authenticate',
    bearerChallenge(
      c.var.config.baseUrl,
      { error: 'insufficient_scope', scope: [...new Set(scopes)].join(' ') },
      MCP_RESOURCE_METADATA_PATH,
    ),
  );
  return c.json(message, 403);
}
