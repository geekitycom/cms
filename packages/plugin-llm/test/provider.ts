import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A chat-completions provider on loopback, so the tests reach no real one
 * (TASK-279). Each test says what it answers; it records what it was sent.
 */

export interface ProviderAnswer {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

export interface Received {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface FakeProvider {
  /** Such as `http://127.0.0.1:40123/api/v1`. */
  baseUrl: string;
  received: Received[];
  answer(next: ProviderAnswer): void;
  close(): Promise<void>;
}

export const ANSWERED = {
  status: 200,
  body: JSON.stringify({
    id: 'gen-1',
    model: 'acme/tiny-1',
    choices: [{ index: 0, message: { role: 'assistant', content: 'OK' } }],
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
  }),
} satisfies ProviderAnswer;

export async function fakeProvider(): Promise<FakeProvider> {
  const received: Received[] = [];
  let next: ProviderAnswer = ANSWERED;
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      received.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
      });
      response.writeHead(next.status, { 'content-type': 'application/json', ...next.headers });
      response.end(next.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/api/v1`,
    received,
    answer(answer) {
      next = answer;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
