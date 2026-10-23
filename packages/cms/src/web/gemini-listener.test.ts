/**
 * The Gemini listener over a real TLS socket (TASK-484), in front of a stub
 * of the site's app, for what does not need a site: the request line, the
 * timeout, the throttle and the log.
 */
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { after, describe, it } from 'node:test';

import { selfSignedCertificate } from '../gemini/certificate.ts';
import { gemini, geminiRequest, refuses } from '../gemini/__testing__/client.ts';
import { listenForGemini } from './gemini-listener.ts';
import type { GeminiListener, GeminiListenerOptions } from './gemini-listener.ts';

const CERTIFICATE = selfSignedCertificate('example.com', new Date('2026-10-23T12:00:00Z'));
const listeners: GeminiListener[] = [];
after(async () => {
  for (const listener of listeners) await listener.close();
});

interface Stub {
  listener: GeminiListener;
  asked: Request[];
  lines: string[];
}

async function listen(options: Partial<GeminiListenerOptions> = {}): Promise<Stub> {
  const asked: Request[] = [];
  const lines: string[] = [];
  const listener = await listenForGemini({
    port: 0,
    certificate: CERTIFICATE,
    site: () => Promise.resolve({ host: 'example.com', origin: 'https://example.com' }),
    fetch: (request) => {
      asked.push(request);
      return Promise.resolve(
        new Response('# Hello\n', { headers: { 'content-type': 'text/gemini; charset=utf-8' } }),
      );
    },
    log: { write: (line) => lines.push(line), address: true },
    now: () => new Date(),
    ...options,
  });
  listeners.push(listener);
  return { listener, asked, lines };
}

describe('the gemini listener', () => {
  it('answers a request from the app, closing with close_notify', async () => {
    const { listener, asked } = await listen();
    const answer = await gemini(listener.port, '/2026/09/one/');
    assert.equal(answer.status, 20);
    assert.equal(answer.meta, 'text/gemini; charset=utf-8');
    assert.equal(answer.body.toString(), '# Hello\n');
    assert.ok(answer.closedCleanly, 'the session ended with close_notify');
    assert.equal(asked[0]?.url, 'https://example.com/2026/09/one/index.gmi');
    assert.equal(asked[0]?.headers.get('accept'), 'text/gemini');
  });

  it('speaks TLS 1.2 at least', async () => {
    const { listener } = await listen();
    await assert.rejects(
      new Promise((resolve, reject) => {
        const socket = tls.connect(
          {
            host: '127.0.0.1',
            port: listener.port,
            rejectUnauthorized: false,
            maxVersion: 'TLSv1.1',
            minVersion: 'TLSv1',
          },
          () => resolve(socket),
        );
        socket.on('error', reject);
      }),
    );
  });

  it('answers 59 to a request that does not end in time', async () => {
    const { listener, asked } = await listen({ requestTimeoutMs: 100 });
    const answer = await geminiRequest(listener.port, 'gemini://example.com/');
    assert.equal(answer.status, 59);
    assert.equal(asked.length, 0);
  });

  it('answers 59 to an over-long URL without waiting for the rest', async () => {
    const { listener } = await listen({ requestTimeoutMs: 60_000 });
    const answer = await geminiRequest(listener.port, `gemini://example.com/${'a'.repeat(1100)}`);
    assert.equal(answer.status, 59);
  });

  it('answers 53 to another host and 59 to a relative URL', async () => {
    const { listener, asked } = await listen();
    assert.equal(
      (await geminiRequest(listener.port, 'gemini://elsewhere.example/\r\n')).status,
      53,
    );
    assert.equal((await geminiRequest(listener.port, '/about/\r\n')).status, 59);
    assert.equal(asked.length, 0);
  });

  it('throttles connections per client address, answering 44 with the wait', async () => {
    let clock = Date.parse('2026-10-23T12:00:00Z');
    const { listener } = await listen({
      limit: { requests: 2, windowSeconds: 60 },
      now: () => new Date(clock),
    });
    assert.equal((await gemini(listener.port, '/')).status, 20);
    assert.equal((await gemini(listener.port, '/')).status, 20);
    const slowed = await gemini(listener.port, '/');
    assert.equal(slowed.status, 44);
    assert.equal(slowed.meta, '60');
    clock += 61_000;
    assert.equal((await gemini(listener.port, '/')).status, 20);
  });

  it('writes an access log line per request, with the client address', async () => {
    const { listener, lines } = await listen();
    await gemini(listener.port, '/about/?x=1');
    await geminiRequest(listener.port, 'gemini://elsewhere.example/\r\n');
    await geminiRequest(listener.port, 'nonsense\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0] ?? '', /^GEMINI \/about\/\?x=1 20 \d+\.\dms (?:::ffff:)?127\.0\.0\.1$/);
    assert.match(lines[1] ?? '', /^GEMINI \/ 53 \d+\.\dms (?:::ffff:)?127\.0\.0\.1$/);
    assert.match(lines[2] ?? '', /^GEMINI - 59 \d+\.\dms (?:::ffff:)?127\.0\.0\.1$/);
  });

  it('stops listening on close', async () => {
    const { listener } = await listen();
    await listener.close();
    assert.ok(await refuses(listener.port));
  });
});
