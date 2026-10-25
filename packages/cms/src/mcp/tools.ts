import type { McpScope, McpToolAnnotations, McpToolOutcome } from '../plugin.ts';
import type { StoredToken } from '../indieauth/tokens.ts';
import type { User } from '../site/users.ts';
import type { GeekityEnv } from '../web/env.ts';
import { messageOf } from '../util/errors.ts';
import type { CallLimit } from './call-limit.ts';
import { problemsWith } from '../util/json-schema.ts';
import type { FromSchema, ObjectSchema } from '../util/json-schema.ts';

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
    | 'siteRecords'
    | 'announce'
    | 'learnHandles'
  >
>;

export interface ToolCall {
  readonly user: User;
  readonly token: StoredToken;
  readonly signal: AbortSignal;
  readonly site: ToolSite;
}

export interface ScopeShortfall {
  readonly needsScope: McpScope;
}

type ToolAnswer<O> = McpToolOutcome<O> | ScopeShortfall;

export type Refused = Extract<McpToolOutcome<never>, { ok: false }>;

export function refused(message: string): Refused {
  return { ok: false, message };
}

export function isRefused<T extends object>(found: T | Refused): found is Refused {
  return 'ok' in found;
}

interface ToolSpec<I extends ObjectSchema, O extends ObjectSchema> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly scope: McpScope;
  readonly annotations: McpToolAnnotations;
  readonly inputSchema: I;
  readonly outputSchema: O;
  readonly run: (args: FromSchema<I>, call: ToolCall) => Promise<ToolAnswer<FromSchema<O>>>;
}

export interface McpTool extends Omit<ToolSpec<ObjectSchema, ObjectSchema>, 'run'> {
  readonly run: (args: unknown, call: ToolCall) => Promise<ToolAnswer<unknown>>;
}

export function callingClient(token: StoredToken): {
  readonly client: string;
  readonly clientName: string | undefined;
} {
  return token.kind === 'created'
    ? { client: token.name, clientName: undefined }
    : { client: token.clientId, clientName: token.clientName };
}

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

export interface ToolCallRecord {
  readonly tool: string;
  readonly args: unknown;
  readonly call: ToolCall;
  readonly outcome: ToolCallResult | { readonly kind: 'crashed'; readonly reason: string };
}

export interface ToolGuards {
  readonly limit: CallLimit;
  readonly record: (record: ToolCallRecord) => void;
}

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
      const answer = await tool.run(args, call);
      if ('needsScope' in answer) return { kind: 'insufficient-scope', scope: answer.needsScope };
      return { kind: 'ran', outcome: answer };
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
