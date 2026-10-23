/**
 * The Gemini listener over a real TLS socket (TASK-484), in front of a stub
 * of the site's app, for what does not need a site: the request line, the
 * timeout, the throttle and the log.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { after, describe, it } from 'node:test';

import { selfSignedCertificate } from '../gemini/certificate.ts';
import { gemini, geminiRequest, proxyV2, refuses } from '../gemini/__testing__/client.ts';
import { isLocalAddress } from '../util/public-address.ts';
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
    trustProxy: () => false,
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

const LOCAL = /(?:::ffff:)?127\.0\.0\.1$/;

function proxyV1(address: string): Buffer {
  return Buffer.from(`PROXY TCP4 ${address} 192.0.2.1 51000 1965\r\n`);
}

function proxied(port: number, preamble: Buffer): ReturnType<typeof geminiRequest> {
  return geminiRequest(port, 'gemini://example.com/\r\n', 'example.com', preamble);
}

/** Whether the server closes a connection that has sent `bytes` and then nothing, without a word. */
async function closesSilently(port: number, bytes: Buffer): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(bytes));
    let answered = false;
    socket.on('data', () => {
      answered = true;
    });
    socket.on('error', () => undefined);
    socket.on('close', () => resolve(!answered));
  });
}

describe('the gemini listener behind a layer-4 proxy (TASK-485)', () => {
  it('logs and throttles by the address a PROXY v1 or v2 header carries, when it trusts the proxy', async () => {
    const { listener, lines } = await listen({
      trustProxy: isLocalAddress,
      limit: { requests: 1, windowSeconds: 60 },
    });
    assert.equal((await proxied(listener.port, proxyV1('203.0.113.7'))).status, 20);
    assert.equal((await proxied(listener.port, proxyV2({ address: '198.51.100.9' }))).status, 20);
    assert.equal((await proxied(listener.port, proxyV2({ address: '2001:db8::7' }))).status, 20);
    assert.equal(
      (await proxied(listener.port, proxyV1('203.0.113.7'))).status,
      44,
      'the second request from one proxied client is slowed',
    );
    assert.match(lines[0] ?? '', / 203\.0\.113\.7$/);
    assert.match(lines[1] ?? '', / 198\.51\.100\.9$/);
    assert.match(lines[2] ?? '', / 2001:db8::7$/);
  });

  it('uses the socket address for a v2 LOCAL header or no header at all', async () => {
    const { listener, lines } = await listen({ trustProxy: isLocalAddress });
    assert.equal((await proxied(listener.port, proxyV2({ local: true }))).status, 20);
    assert.equal((await gemini(listener.port, '/')).status, 20);
    assert.match(lines[0] ?? '', LOCAL);
    assert.match(lines[1] ?? '', LOCAL);
  });

  it('refuses a PROXY header when it does not trust a proxy', async () => {
    const { listener, lines } = await listen({ trustProxy: () => false });
    await assert.rejects(proxied(listener.port, proxyV1('203.0.113.7')));
    await assert.rejects(proxied(listener.port, proxyV2({ address: '203.0.113.7' })));
    assert.ok(await closesSilently(listener.port, proxyV1('203.0.113.7')));
    assert.deepEqual(lines, []);
    assert.equal((await gemini(listener.port, '/')).status, 20, 'a direct client is served');
  });

  it('believes a PROXY header only from a loopback or private peer (TASK-504)', async () => {
    const peers: string[] = [];
    const { listener, lines } = await listen({
      trustProxy: (peer) => {
        peers.push(peer);
        return isLocalAddress(peer);
      },
      limit: { requests: 1, windowSeconds: 60 },
    });
    assert.equal((await proxied(listener.port, proxyV1('203.0.113.7'))).status, 20);
    assert.equal(
      (await proxied(listener.port, proxyV1('203.0.113.7'))).status,
      44,
      'the throttle keys on the address the header carries',
    );
    assert.match(lines[0] ?? '', / 203\.0\.113\.7$/);
    assert.ok(peers.length > 0 && peers.every((peer) => LOCAL.test(peer)), 'asked of the TCP peer');
  });

  it('closes a connection whose PROXY header comes from a public peer, and serves its TLS', async () => {
    const { listener, lines } = await listen({
      trustProxy: (peer) => isLocalAddress(LOCAL.test(peer) ? '198.51.100.20' : peer),
    });
    await assert.rejects(proxied(listener.port, proxyV1('203.0.113.7')));
    await assert.rejects(proxied(listener.port, proxyV2({ address: '203.0.113.7' })));
    assert.ok(await closesSilently(listener.port, proxyV1('203.0.113.7')));
    assert.deepEqual(lines, [], 'the spoofed address is neither logged nor throttled');
    assert.equal((await gemini(listener.port, '/')).status, 20, 'a direct client is served');
    assert.match(lines[0] ?? '', LOCAL, 'under the address of its own socket');
  });

  it('closes a connection whose header is malformed, too long, or never finishes', async () => {
    const { listener, asked } = await listen({ trustProxy: isLocalAddress, requestTimeoutMs: 200 });
    assert.ok(await closesSilently(listener.port, Buffer.from('PROXY TCP4 nonsense\r\n')));
    assert.ok(await closesSilently(listener.port, Buffer.from(`PROXY ${'9'.repeat(200)}`)));
    assert.ok(
      await closesSilently(
        listener.port,
        proxyV2({ address: '203.0.113.7', tlv: Buffer.alloc(8192) }).subarray(0, 16),
      ),
    );
    assert.ok(await closesSilently(listener.port, Buffer.from('PROXY TCP4 203.0.')));
    assert.equal(asked.length, 0);
  });
});
