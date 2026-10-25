import type { McpScope } from '../indieauth/request.ts';
import type { StoredToken } from '../indieauth/tokens.ts';
import type { User } from '../site/users.ts';
import { problemsWith } from './schema.ts';
import type { FromSchema, ObjectSchema } from './schema.ts';

/**
 * What a tool tells a client about itself beyond its schemas. Every hint is
 * stated, so no tool falls back on MCP's defaults, which assume the worst
 * about writes and nothing about reads.
 */
export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

/** Who is calling a tool, through which connection. */
export interface ToolCall {
  readonly user: User;
  readonly token: StoredToken;
  readonly signal: AbortSignal;
}

/**
 * What a tool's run came to: a short summary for a person and the structured
 * result its output schema describes, or a message the model can act on.
 */
export type ToolOutcome<O> =
  | { readonly ok: true; readonly summary: string; readonly structured: O }
  | { readonly ok: false; readonly message: string };

interface ToolSpec<I extends ObjectSchema, O extends ObjectSchema> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** The one scope a token needs for this tool. The registry checks it before `run`. */
  readonly scope: McpScope;
  readonly annotations: ToolAnnotations;
  readonly inputSchema: I;
  readonly outputSchema: O;
  readonly run: (args: FromSchema<I>, call: ToolCall) => Promise<ToolOutcome<FromSchema<O>>>;
}

/** A tool as the registry holds it, its argument types erased once they are checked. */
export interface McpTool extends Omit<ToolSpec<ObjectSchema, ObjectSchema>, 'run'> {
  readonly run: (args: unknown, call: ToolCall) => Promise<ToolOutcome<unknown>>;
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
  | { readonly kind: 'ran'; readonly outcome: ToolOutcome<unknown> };

/**
 * Every tool the MCP endpoint offers, and the one way to call one, so the
 * scope check, and whatever else every call must pass, cannot be skipped by
 * a tool.
 */
export interface ToolRegistry {
  list(): readonly McpTool[];
  call(name: string, args: unknown, call: ToolCall): Promise<ToolCallResult>;
}

/** MCP's rule for a tool name. */
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export function createToolRegistry(tools: readonly McpTool[]): ToolRegistry {
  const byName = new Map<string, McpTool>();
  for (const tool of tools) {
    if (!TOOL_NAME.test(tool.name)) throw new Error(`"${tool.name}" is not an MCP tool name.`);
    if (byName.has(tool.name)) throw new Error(`Two MCP tools are named "${tool.name}".`);
    byName.set(tool.name, tool);
  }
  return {
    list: () => tools,
    call: async (name, args, call) => {
      const tool = byName.get(name);
      if (tool === undefined) return { kind: 'unknown-tool' };
      if (!call.token.scopes.includes(tool.scope)) {
        return { kind: 'insufficient-scope', scope: tool.scope };
      }
      return { kind: 'ran', outcome: await tool.run(args, call) };
    },
  };
}
