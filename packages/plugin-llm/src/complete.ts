/**
 * The llm service's one call (decision-33): messages in, a {@link Completion}
 * out. With a schema it asks for `json_schema` output and checks the reply
 * against the schema itself, whatever the provider claims, so a consumer never
 * parses a model's output.
 */

import { Validator } from '@cfworker/json-schema';

import { effortFor } from './catalog.ts';
import type { ModelCatalog, ReasoningEffort } from './catalog.ts';
import { chatCompletion, describeFailure, isRecord } from './connection.ts';
import type { LlmConnection, LlmFailure } from './connection.ts';

/**
 * The most a reply may run to when a call names no limit, reasoning included.
 * At the default effort a reasoning model spends a fifth or so of it
 * thinking, which leaves thousands for a short structured answer.
 */
export const DEFAULT_MAX_TOKENS = 4096;

/** The reasoning effort asked of a reasoning model when a call names none. */
export const DEFAULT_REASONING: ReasoningEffort = 'low';

/** How long a call may take, in milliseconds, before it fails as a timeout. */
export const DEFAULT_TIMEOUT_MS = 60_000;

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** A JSON Schema, as plain data. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  /** What the reply must be. With one, the completion carries `value`; without, `text`. */
  readonly schema?: JsonSchema | undefined;
  /** The model to ask, or the plugin's default model. */
  readonly model?: string | undefined;
  /** The longest reply, reasoning included, or {@link DEFAULT_MAX_TOKENS}. */
  readonly maxTokens?: number | undefined;
  /**
   * How hard a reasoning model on OpenRouter should think, or {@link DEFAULT_REASONING}.
   * `model-default` sends nothing and leaves it to the model. Other providers
   * and models that do not reason are sent nothing either way.
   */
  readonly reasoning?: ReasoningEffort | 'model-default' | undefined;
  /** Stops the call, which then fails as `aborted`. */
  readonly signal?: AbortSignal | undefined;
}

/** What a call cost, as the provider reported it. */
export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /** In the provider's currency, US dollars on OpenRouter, when it says. */
  readonly cost: number | undefined;
}

/**
 * What a call came to: the reply, the model that answered and what it cost,
 * or why there is no reply.
 */
export type Completion<Reply> =
  | ({
      readonly ok: true;
      readonly model: string;
      /** `undefined` when the provider did not report it. */
      readonly usage: LlmUsage | undefined;
    } & Reply)
  | {
      readonly ok: false;
      readonly error: LlmFailure;
      /** The failure in plain words, with where to put it right, ready to show. */
      readonly message: string;
    };

/** The service `@geekity/plugin-llm` provides, reached with `host.use('@geekity/plugin-llm')`. */
export interface LlmService {
  /**
   * Ask for a reply that satisfies `schema`. `Value` is the type the schema
   * describes: the value is checked against the schema, so it holds when the
   * two agree.
   */
  complete<Value = unknown>(
    request: LlmRequest & { readonly schema: JsonSchema },
  ): Promise<Completion<{ readonly value: Value }>>;
  /** Ask for a reply as text. */
  complete(
    request: LlmRequest & { readonly schema?: undefined },
  ): Promise<Completion<{ readonly text: string }>>;
}

/** One call: its completion, and the model and usage to record whichever way it went. */
export interface ModelCall {
  readonly completion: Completion<{ readonly text: string } | { readonly value: unknown }>;
  /** The model that answered, or the one asked for when none did. */
  readonly model: string;
  readonly usage: LlmUsage | undefined;
}

export async function callModel(
  connection: LlmConnection,
  request: LlmRequest,
  catalog: ModelCatalog,
): Promise<ModelCall> {
  const { schema } = request;
  const validator = schema === undefined ? undefined : new Validator(schema, '2020-12', false);
  const asked = request.model ?? connection.model;
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  const reasoning = await reasoningFor(connection, request, asked, catalog);
  const failure = (error: LlmFailure): ModelCall['completion'] => ({
    ok: false,
    error,
    message: describeFailure(error, connection),
  });

  const outcome = await chatCompletion(
    connection,
    {
      model: asked,
      messages: request.messages,
      max_tokens: maxTokens,
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(schema === undefined
        ? {}
        : {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'reply', strict: true, schema },
            },
            ...(connection.openRouter === undefined
              ? {}
              : { provider: { require_parameters: true } }),
          }),
    },
    request.signal,
  );
  if (!outcome.ok) return { completion: failure(outcome.error), model: asked, usage: undefined };

  const answer = isRecord(outcome.value) ? outcome.value : {};
  const model =
    typeof answer['model'] === 'string' && answer['model'] !== '' ? answer['model'] : asked;
  const usage = usageOf(answer['usage']);
  const failed = (error: LlmFailure): ModelCall => ({ completion: failure(error), model, usage });
  const invalid = (reason: string) => failed({ kind: 'invalid-output', reason });

  const { text, finishReason } = firstChoice(answer);
  const atCap = usage !== undefined && usage.completionTokens >= maxTokens;
  if (finishReason === 'length' || ((text === undefined || text.trim() === '') && atCap)) {
    return failed({
      kind: 'cut-off',
      maxTokens,
      reasoningTokens: reasoningTokens(answer['usage']),
    });
  }
  if (text === undefined) return invalid('It had no text.');
  if (validator === undefined)
    return { completion: { ok: true, model, usage, text }, model, usage };

  let value: unknown;
  try {
    value = JSON.parse(withoutFence(text));
  } catch {
    return invalid('It was not JSON.');
  }
  const result = validator.validate(value);
  if (!result.valid) {
    const errors = result.errors
      .filter((error) => !SUMMARY_KEYWORDS.has(error.keyword))
      .slice(0, 3)
      .map((error) =>
        error.instanceLocation === '#'
          ? error.error
          : `At ${error.instanceLocation.slice(1)}: ${error.error}`,
      );
    return invalid(`It does not match the schema. ${errors.join(' ')}`);
  }
  return { completion: { ok: true, model, usage, value }, model, usage };
}

/**
 * Keywords whose error only says that a nested one failed, or repeats one:
 * the nested error says what is wrong.
 */
const SUMMARY_KEYWORDS = new Set(['properties', 'items', 'false', 'allOf', '$ref']);

async function reasoningFor(
  connection: LlmConnection,
  request: LlmRequest,
  model: string,
  catalog: ModelCatalog,
): Promise<{ effort: ReasoningEffort; exclude: true } | undefined> {
  const asked = request.reasoning ?? DEFAULT_REASONING;
  if (connection.openRouter === undefined || asked === 'model-default') return undefined;
  const reasoner = await catalog(connection, model, request.signal);
  return reasoner === undefined ? undefined : { effort: effortFor(asked, reasoner), exclude: true };
}

function firstChoice(answer: Record<string, unknown>): {
  text: string | undefined;
  finishReason: unknown;
} {
  const choices = answer['choices'];
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first['message'] : undefined;
  const content = isRecord(message) ? message['content'] : undefined;
  return {
    text: typeof content === 'string' ? content : undefined,
    finishReason: isRecord(first) ? first['finish_reason'] : undefined,
  };
}

function reasoningTokens(usage: unknown): number | undefined {
  const details = isRecord(usage) ? usage['completion_tokens_details'] : undefined;
  const count = isRecord(details) ? details['reasoning_tokens'] : undefined;
  return typeof count === 'number' ? count : undefined;
}

/** JSON as a model may send it without strict output: inside one Markdown code fence. */
function withoutFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}

function usageOf(usage: unknown): LlmUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const count = (key: string) => (typeof usage[key] === 'number' ? usage[key] : 0);
  return {
    promptTokens: count('prompt_tokens'),
    completionTokens: count('completion_tokens'),
    totalTokens: count('total_tokens'),
    cost: typeof usage['cost'] === 'number' ? usage['cost'] : undefined,
  };
}
