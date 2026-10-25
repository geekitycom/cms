import { recordMcpCall } from '../web/indieauth-activity-log.ts';
import type { McpCallFacts } from '../web/indieauth-activity-log.ts';
import type { ToolCallRecord } from './tools.ts';

/** Record one tool call in the app activity record, as the client was answered. */
export function auditToolCall(dataDir: string, record: ToolCallRecord, at: Date): void {
  recordMcpCall(
    dataDir,
    {
      tool: record.tool,
      args: record.args,
      token: record.call.token,
      username: record.call.user.username,
      ...answered(record.outcome),
    },
    at,
  );
}

/**
 * What a call came to, as an HTTP status and an error code. Every call but a
 * refusal for scope is answered 200, its failure carried in the JSON-RPC body.
 */
function answered(
  outcome: ToolCallRecord['outcome'],
): Pick<McpCallFacts, 'status' | 'error' | 'errorDescription'> {
  switch (outcome.kind) {
    case 'ran':
      return outcome.outcome.ok
        ? { status: 200 }
        : { status: 200, error: 'tool_error', errorDescription: outcome.outcome.message };
    case 'crashed':
      return { status: 200, error: 'tool_failed', errorDescription: outcome.reason };
    case 'insufficient-scope':
      return {
        status: 403,
        error: 'insufficient_scope',
        errorDescription: `The token lacks the ${outcome.scope} scope.`,
      };
    case 'unknown-tool':
      return { status: 200, error: 'unknown_tool', errorDescription: 'There is no such tool.' };
    case 'rate-limited':
      return {
        status: 200,
        error: 'rate_limited',
        errorDescription: `Over the connection's limit; told to wait ${String(outcome.retryAfter)} seconds. Further refused calls in the same window are not recorded.`,
      };
  }
}
