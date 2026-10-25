import type { McpScope, McpToolOutcome } from '../plugin.ts';
import { listedTool } from './tools.ts';
import type { ToolCall, ToolRegistry } from './tools.ts';

/**
 * The MCP revisions this server speaks, newest first. It offers tools and
 * nothing else, which reads the same in each.
 */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;

export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];

export const LATEST_PROTOCOL_VERSION = PROTOCOL_VERSIONS[0];

/**
 * What the server can do: list and call tools. The list changes when a
 * plugin is enabled or disabled, but a stateless server holds no stream to
 * announce that on, so a client finds out when it lists again.
 */
export const SERVER_CAPABILITIES = { tools: { listChanged: false } } as const;

export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  /** In the range JSON-RPC leaves to servers. */
  insufficientScope: -32001,
  rateLimited: -32002,
} as const;

type RequestId = string | number;

interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export type JsonRpcResponse =
  | { readonly jsonrpc: '2.0'; readonly id: RequestId; readonly result: unknown }
  | { readonly jsonrpc: '2.0'; readonly id: RequestId | null; readonly error: JsonRpcError };

export interface ServerInfo {
  readonly name: string;
  readonly title: string;
  readonly version: string;
}

/**
 * What one posted message comes to, for the transport to send: 202 with no
 * body for a notification or a response, 200 with an answer, 400 for what is
 * not a message, and 403 for a tool call the token lacks the scope for.
 */
export type McpReply =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'answer'; readonly message: JsonRpcResponse }
  | { readonly kind: 'malformed'; readonly message: JsonRpcResponse }
  | {
      readonly kind: 'insufficient-scope';
      readonly scope: McpScope;
      readonly message: JsonRpcResponse;
    };

export interface McpServer {
  readonly registry: ToolRegistry;
  readonly info: ServerInfo;
  readonly call: ToolCall;
}

export function failure(id: RequestId | null, error: JsonRpcError): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error };
}

/** Answer one JSON-RPC message posted to the endpoint. */
export async function reply(message: unknown, server: McpServer): Promise<McpReply> {
  if (!isRecord(message) || message['jsonrpc'] !== '2.0') {
    return malformed('The body must be one JSON-RPC 2.0 message.');
  }
  const { id, method } = message;
  if (typeof method !== 'string') {
    const isResponse = isRequestId(id) && ('result' in message || 'error' in message);
    return isResponse ? { kind: 'accepted' } : malformed('The message names no method.');
  }
  if (id === undefined) return { kind: 'accepted' };
  if (!isRequestId(id)) return malformed('The id must be a string or a number.');

  const params = isRecord(message['params']) ? message['params'] : {};
  const answer = (result: unknown): McpReply => ({
    kind: 'answer',
    message: { jsonrpc: '2.0', id, result },
  });
  switch (method) {
    case 'initialize':
      return answer({
        protocolVersion: negotiatedVersion(params['protocolVersion']),
        capabilities: SERVER_CAPABILITIES,
        serverInfo: server.info,
      });
    case 'ping':
      return answer({});
    case 'tools/list':
      return answer({ tools: server.registry.list().map(listedTool) });
    case 'tools/call':
      return await callTool(id, params, server);
    default:
      return {
        kind: 'answer',
        message: failure(id, {
          code: JSON_RPC_ERRORS.methodNotFound,
          message: `This server does not offer ${method}.`,
        }),
      };
  }
}

async function callTool(
  id: RequestId,
  params: Readonly<Record<string, unknown>>,
  server: McpServer,
): Promise<McpReply> {
  const name = params['name'];
  const invalid = (text: string): McpReply => ({
    kind: 'answer',
    message: failure(id, { code: JSON_RPC_ERRORS.invalidParams, message: text }),
  });
  if (typeof name !== 'string') return invalid('tools/call needs the name of a tool.');

  const result = await server.registry.call(name, params['arguments'], server.call);
  switch (result.kind) {
    case 'unknown-tool':
      return invalid(`There is no tool named ${name}.`);
    case 'insufficient-scope':
      return {
        kind: 'insufficient-scope',
        scope: result.scope,
        message: failure(id, {
          code: JSON_RPC_ERRORS.insufficientScope,
          message: `${name} needs the ${result.scope} scope, which this connection was not granted. Sign in again and approve it.`,
          data: { scope: result.scope },
        }),
      };
    case 'rate-limited':
      return {
        kind: 'answer',
        message: failure(id, {
          code: JSON_RPC_ERRORS.rateLimited,
          message: `Too many tool calls through this connection. Try again in ${String(result.retryAfter)} seconds.`,
          data: { retryAfter: result.retryAfter },
        }),
      };
    case 'ran':
      return {
        kind: 'answer',
        message: { jsonrpc: '2.0', id, result: toolResult(result.outcome) },
      };
  }
}

/**
 * A tool's outcome as MCP's CallToolResult. The structured result is also
 * written out as text, as the spec asks, for clients that read only text.
 */
function toolResult(outcome: McpToolOutcome<unknown>) {
  if (!outcome.ok) return { content: [{ type: 'text', text: outcome.message }], isError: true };
  return {
    content: [
      { type: 'text', text: outcome.summary },
      { type: 'text', text: JSON.stringify(outcome.structured) },
    ],
    structuredContent: outcome.structured,
    isError: false,
  };
}

/** The client's version when this server speaks it, or else its own newest, as the spec says. */
function negotiatedVersion(asked: unknown): ProtocolVersion {
  return isSupportedVersion(asked) ? asked : LATEST_PROTOCOL_VERSION;
}

export function isSupportedVersion(version: unknown): version is ProtocolVersion {
  return (PROTOCOL_VERSIONS as readonly unknown[]).includes(version);
}

function malformed(text: string): McpReply {
  return {
    kind: 'malformed',
    message: failure(null, { code: JSON_RPC_ERRORS.invalidRequest, message: text }),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}
