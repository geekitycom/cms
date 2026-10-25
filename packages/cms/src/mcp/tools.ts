import type { McpScope, McpToolAnnotations, McpToolOutcome } from '../plugin.ts';
import type { StoredToken } from '../indieauth/tokens.ts';
import type { User } from '../site/users.ts';
import type { GeekityEnv } from '../web/env.ts';
import { messageOf } from '../util/errors.ts';
import type { CallLimit } from './call-limit.ts';
import { problemsWith } from '../util/json-schema.ts';
import type { FromSchema, ObjectSchema } from '../util/json-schema.ts';

/** The parts of the site a core tool reads and acts through: the request's own variables. */
export type ToolSite = Readonly<
  Pick<
    GeekityEnv['Variables'],
    | 'admin'
    | 'store'
    | 'config'
    | 'settings'
    | 'jobs'
    | 'conversation'
    | 'replyContexts'
    | 'actorProfiles'
    | 'siteAtRequestStart'
    | 'federation'
  >
>;

/** Who is calling a tool, through which connection, on which site. */
export interface ToolCall {
  readonly user: User;
  readonly token: StoredToken;
  readonly signal: AbortSignal;
  readonly site: ToolSite;
}

interface ToolSpec<I extends ObjectSchema, O extends ObjectSchema> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** The one scope a token needs for this tool. The registry checks it before `run`. */
  readonly scope: McpScope;
  readonly annotations: McpToolAnnotations;
  readonly inputSchema: I;
  readonly outputSchema: O;
  readonly run: (args: FromSchema<I>, call: ToolCall) => Promise<McpToolOutcome<FromSchema<O>>>;
}

/** A tool as the registry holds it, its argument types erased once they are checked. */
export interface McpTool extends Omit<ToolSpec<ObjectSchema, ObjectSchema>, 'run'> {
  readonly run: (args: unknown, call: ToolCall) => Promise<McpToolOutcome<unknown>>;
}

/** The app a connection was issued to: its `client_id` and name, or a hand-made token's name. */
export function callingClient(token: StoredToken): {
  readonly client: string;
  readonly clientName: string | undefined;
} {
  return token.kind === 'created'
    ? { client: token.name, clientName: undefined }
    : { client: token.clientId, clientName: token.clientName };
}

/** A tool whose `run` is handed only arguments that fit its input schema. */
export function defineTool<const I extends ObjectSchema, const O extends ObjectSchema>(
  spec: ToolSpec<I, O>,
): McpTool {
  return {
    ...spec,
    run: async (args, call) => {
      const problems = problemsWith(spec.inputSchema, args ?? {});
      if (problems.length > 0) return { ok: false, message: problems.join(' ') };
      return await spec.run((args ?? {}) as FromSchema<I>, call);
    },
  };
}

/** A tool as `tools/list` describes it. */
export function listedTool(tool: McpTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
  };
}

export type ToolCallResult =
  | { readonly kind: 'unknown-tool' }
  | { readonly kind: 'insufficient-scope'; readonly scope: McpScope }
  | { readonly kind: 'rate-limited'; readonly retryAfter: number }
  | { readonly kind: 'ran'; readonly outcome: McpToolOutcome<unknown> };

/** One call as the registry hands it to the record: what was asked, by whom, and how it ended. */
export interface ToolCallRecord {
  readonly tool: string;
  readonly args: unknown;
  readonly call: ToolCall;
  /** The answer the client was given, or why the tool threw, which the client is not told. */
  readonly outcome: ToolCallResult | { readonly kind: 'crashed'; readonly reason: string };
}

/** What every call passes through, whatever the tool: the per-token limit and the record. */
export interface ToolGuards {
  readonly limit: CallLimit;
  /** Called once per call, after it is decided. Must not throw, and is not awaited. */
  readonly record: (record: ToolCallRecord) => void;
}

/**
 * Every tool the MCP endpoint offers, and the one way to call one, so the
 * limit, the scope check and the record cannot be skipped by a tool.
 */
export interface ToolRegistry {
  list(): readonly McpTool[];
  call(name: string, args: unknown, call: ToolCall): Promise<ToolCallResult>;
}

/** MCP's rule for a tool name. */
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export function createToolRegistry(tools: readonly McpTool[], guards: ToolGuards): ToolRegistry {
  const byName = new Map<string, McpTool>();
  for (const tool of tools) {
    if (!TOOL_NAME.test(tool.name)) throw new Error(`"${tool.name}" is not an MCP tool name.`);
    if (byName.has(tool.name)) throw new Error(`Two MCP tools are named "${tool.name}".`);
    byName.set(tool.name, tool);
  }

  async function decide(
    name: string,
    args: unknown,
    call: ToolCall,
  ): Promise<ToolCallRecord['outcome']> {
    const tool = byName.get(name);
    if (tool === undefined) return { kind: 'unknown-tool' };
    if (!call.token.scopes.includes(tool.scope)) {
      return { kind: 'insufficient-scope', scope: tool.scope };
    }
    try {
      return { kind: 'ran', outcome: await tool.run(args, call) };
    } catch (error) {
      return { kind: 'crashed', reason: messageOf(error) };
    }
  }

  return {
    list: () => tools,
    call: async (name, args, call) => {
      const allowed = guards.limit.take(call.token.id);
      if (allowed.kind === 'refused') {
        const refused = { kind: 'rate-limited', retryAfter: allowed.retryAfter } as const;
        if (allowed.first) guards.record({ tool: name, args, call, outcome: refused });
        return refused;
      }
      const outcome = await decide(name, args, call);
      guards.record({ tool: name, args, call, outcome });
      if (outcome.kind !== 'crashed') return outcome;
      return {
        kind: 'ran',
        outcome: {
          ok: false,
          message: `${name} failed on the server. The site owner can see why in the admin, under Users > App activity.`,
        },
      };
    },
  };
}
