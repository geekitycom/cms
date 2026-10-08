/**
 * One call to a provider that speaks the OpenAI chat-completions API
 * (decision-33), made with Node's built-in `fetch`, and what came of it as a
 * typed outcome. OpenRouter, OpenAI and Ollama differ only in the base URL.
 */

/** Where calls go and what they are signed with. */
export interface LlmConnection {
  /** Such as `https://openrouter.ai/api/v1`; `/chat/completions` is added to it. */
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  /** The model asked for when a call names none. */
  readonly model: string;
  /**
   * Who is calling, sent to OpenRouter as `HTTP-Referer` and
   * `X-OpenRouter-Title`, or `undefined` for a provider that is not OpenRouter.
   * OpenRouter also gets `provider.require_parameters` with a schema.
   */
  readonly openRouter: { readonly siteUrl: string; readonly siteTitle: string } | undefined;
  /** How long a call may take, in milliseconds. */
  readonly timeoutMs: number;
}

/** Why a call came to nothing. */
export type LlmFailure =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'no-credit' }
  /** `retryAfter` is in seconds, when the provider said. */
  | { readonly kind: 'rate-limited'; readonly retryAfter: number | undefined }
  /**
   * The provider failed to answer: a 5xx or another status that a later try
   * may get past. `message` is the provider's own, with the key taken out.
   */
  | { readonly kind: 'unavailable'; readonly status: number; readonly message: string | undefined }
  /**
   * The provider refused the request as asked (400, 404 or 422), such as an
   * unknown model or one that cannot give structured output. Trying again
   * will not help; changing the model or the request may.
   */
  | { readonly kind: 'rejected'; readonly status: number; readonly message: string | undefined }
  /** The reply was not what was asked for: no text, not JSON, or not what the schema says. */
  | { readonly kind: 'invalid-output'; readonly reason: string }
  | { readonly kind: 'timeout'; readonly seconds: number }
  /** The caller's signal stopped the call. */
  | { readonly kind: 'aborted' }
  | { readonly kind: 'network' };

export type LlmOutcome<Value> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: LlmFailure };

/** Where OpenRouter answers. A connection to any other host gets no OpenRouter extras. */
export const OPENROUTER_HOST = 'openrouter.ai';

/**
 * POST a chat-completions request and hand back the parsed JSON of a 2xx
 * answer. Nothing is sent without an API key.
 */
export async function chatCompletion(
  connection: LlmConnection,
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<LlmOutcome<unknown>> {
  const { apiKey } = connection;
  if (apiKey === undefined || apiKey === '') return failed({ kind: 'unconfigured' });

  const timeout = AbortSignal.timeout(connection.timeoutMs);
  const stopped = (): LlmFailure => {
    if (signal?.aborted === true) return { kind: 'aborted' };
    if (timeout.aborted) return { kind: 'timeout', seconds: connection.timeoutMs / 1000 };
    return { kind: 'network' };
  };

  let response: Response;
  let text: string;
  try {
    response = await fetch(`${connection.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(connection.openRouter === undefined
          ? {}
          : {
              'http-referer': connection.openRouter.siteUrl,
              'x-openrouter-title': connection.openRouter.siteTitle,
            }),
      },
      body: JSON.stringify({ model: connection.model, ...body }),
      signal: AbortSignal.any([timeout, ...(signal ? [signal] : [])]),
    });
    text = await response.text();
  } catch {
    return failed(stopped());
  }

  if (response.ok) {
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return failed({
        kind: 'unavailable',
        status: response.status,
        message: 'The answer was not JSON.',
      });
    }
  }
  return failed(failureFor(response, text, apiKey));
}

/** A failure in plain words, naming the provider by its host and never the key. */
export function describeFailure(error: LlmFailure, connection: LlmConnection): string {
  const host = hostOf(connection.baseUrl);
  switch (error.kind) {
    case 'unconfigured':
      return 'No API key is set, so nothing was sent.';
    case 'unauthorized':
      return `${host} refused the API key.`;
    case 'no-credit':
      return `The account behind the API key has no credit left at ${host}.`;
    case 'rate-limited':
      return error.retryAfter === undefined
        ? `${host} is limiting requests. Try again shortly.`
        : `${host} is limiting requests. Try again in ${String(error.retryAfter)} seconds.`;
    case 'unavailable':
      return `${host} could not answer (status ${String(error.status)})${error.message === undefined ? '.' : `: ${error.message}`}`;
    case 'rejected':
      return `${host} refused the request (status ${String(error.status)})${error.message === undefined ? '.' : `: ${error.message}`}`;
    case 'invalid-output':
      return `The model's reply was not usable. ${error.reason}`;
    case 'timeout':
      return `${host} did not answer within ${String(error.seconds)} seconds.`;
    case 'aborted':
      return 'The call was stopped before it finished.';
    case 'network':
      return `${host} could not be reached. Check the base URL.`;
  }
}

/** Statuses that say the request itself was wrong, which no retry fixes. */
const REJECTED = new Set([400, 404, 422]);

function failureFor(response: Response, text: string, apiKey: string): LlmFailure {
  switch (response.status) {
    case 401:
    case 403:
      return { kind: 'unauthorized' };
    case 402:
      return { kind: 'no-credit' };
    case 429:
      return { kind: 'rate-limited', retryAfter: retryAfter(response.headers.get('retry-after')) };
    default:
      return {
        kind: REJECTED.has(response.status) ? 'rejected' : 'unavailable',
        status: response.status,
        message: providerMessage(text)?.replaceAll(apiKey, 'the API key'),
      };
  }
}

/** `Retry-After` as seconds from now, whether it is given as seconds or as a date. */
function retryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  if (/^\d+$/.test(header.trim())) return Number(header.trim());
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** The `error.message` of an OpenAI-shaped error body, if there is one. */
function providerMessage(text: string): string | undefined {
  try {
    const body: unknown = JSON.parse(text);
    const error = isRecord(body) ? body['error'] : undefined;
    const message = isRecord(error) ? error['message'] : undefined;
    return typeof message === 'string' && message !== '' ? message : undefined;
  } catch {
    return undefined;
  }
}

function hostOf(baseUrl: string): string {
  return URL.canParse(baseUrl) ? new URL(baseUrl).host : 'The provider';
}

function failed(error: LlmFailure): { ok: false; error: LlmFailure } {
  return { ok: false, error };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
