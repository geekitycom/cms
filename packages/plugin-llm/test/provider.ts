import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A chat-completions provider on loopback, so the tests reach no real one
 * (TASK-279). Each test says what it answers; it records what it was sent.
 * Post summary and Tag suggest import it from here rather than keep copies.
 */

export interface ProviderAnswer {
  status: number;
  /** How long to wait before answering, to outlast a timeout. */
  delayMs?: number;
  headers?: Record<string, string>;
  body: string;
}

/** An answer, or one worked out from the request body. */
export type Answering = ProviderAnswer | ((sent: SentBody) => ProviderAnswer);

export interface SentBody {
  max_tokens?: number;
  reasoning?: { effort?: string };
}

export interface Received {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: unknown;
}

/** One entry of OpenRouter's model list, as much of it as the plugin reads. */
export interface CatalogModel {
  id: string;
  supported_parameters: string[];
  reasoning?: { mandatory?: boolean; supported_efforts?: string[] };
}

export interface FakeProvider {
  /** Such as `http://127.0.0.1:40123/api/v1`. */
  baseUrl: string;
  /** The chat-completions requests, in order. */
  received: Received[];
  /** How many times the model list was fetched. */
  catalogFetches: number;
  /** What `GET /models` lists. */
  catalog: CatalogModel[];
  answer(next: Answering): void;
  close(): Promise<void>;
}

/** A 200 whose message content is `content`, as a provider answers one. */
export function replying(content: string): ProviderAnswer {
  return {
    status: 200,
    body: JSON.stringify({
      id: 'gen-2',
      model: 'acme/tiny-1',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52, cost: 0.00031 },
    }),
  };
}

export const ANSWERED = {
  status: 200,
  body: JSON.stringify({
    id: 'gen-1',
    model: 'acme/tiny-1',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
  }),
} satisfies ProviderAnswer;

/** Efforts at which {@link thinker} keeps its reasoning short. */
const BRIEF = new Set(['none', 'minimal', 'low']);

/**
 * A reasoning model, as z-ai/glm-5.3-flash behaved on shll.me: unless the
 * request asks for low effort it reasons until `max_tokens` runs out and
 * answers nothing, with `finish_reason: "length"`. Asked for low effort it
 * spends `briefly` tokens reasoning, then answers `content` if there is room.
 */
export function thinker(
  content: string,
  { briefly = 300 } = {},
): (sent: SentBody) => ProviderAnswer {
  return (sent) => {
    const cap = sent.max_tokens ?? Number.POSITIVE_INFINITY;
    const effort = sent.reasoning?.effort;
    const reasoning =
      effort !== undefined && BRIEF.has(effort) ? briefly : Number.POSITIVE_INFINITY;
    const answer = 20;
    const fits = reasoning + answer <= cap;
    const spent = fits ? reasoning + answer : cap;
    return {
      status: 200,
      body: JSON.stringify({
        id: 'gen-3',
        model: 'acme/thinker',
        choices: [
          {
            index: 0,
            finish_reason: fits ? 'stop' : 'length',
            native_finish_reason: fits ? 'stop' : 'length',
            message: { role: 'assistant', content: fits ? content : '', reasoning: null },
          },
        ],
        usage: {
          prompt_tokens: 40,
          completion_tokens: spent,
          total_tokens: 40 + spent,
          completion_tokens_details: { reasoning_tokens: fits ? reasoning : cap },
        },
      }),
    };
  };
}

/** The model list a fake starts with: a reasoning model, a plain one, and openrouter/auto. */
export const CATALOG: CatalogModel[] = [
  {
    id: 'acme/thinker',
    supported_parameters: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs'],
    reasoning: { mandatory: true, supported_efforts: ['max', 'high', 'low'] },
  },
  {
    id: 'acme/plain',
    supported_parameters: ['max_tokens', 'response_format', 'structured_outputs'],
  },
  {
    id: 'openrouter/auto',
    supported_parameters: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs'],
  },
];

export async function fakeProvider(): Promise<FakeProvider> {
  let next: Answering = ANSWERED;
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (request.method === 'GET' && request.url?.endsWith('/models') === true) {
        fake.catalogFetches += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: fake.catalog }));
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text === '' ? undefined : (JSON.parse(text) as unknown);
      fake.received.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      });
      const answer = typeof next === 'function' ? next((body ?? {}) as SentBody) : next;
      const { status, headers, body: reply, delayMs = 0 } = answer;
      setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(status, { 'content-type': 'application/json', ...headers });
        response.end(reply);
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const fake: FakeProvider = {
    baseUrl: `http://127.0.0.1:${String(port)}/api/v1`,
    received: [],
    catalogFetches: 0,
    catalog: structuredClone(CATALOG),
    answer(answer) {
      next = answer;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  return fake;
}

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Send what the plugin means for OpenRouter to `provider` instead, so a site
 * keeps OpenRouter's base URL, and gets what only OpenRouter is sent, while
 * the test stays on loopback. Returns the function that stops it.
 */
export function standInForOpenRouter(provider: FakeProvider): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith(OPENROUTER_BASE_URL)
      ? realFetch(provider.baseUrl + url.slice(OPENROUTER_BASE_URL.length), init)
      : realFetch(input, init);
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}
