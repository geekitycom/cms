import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Worker } from 'node:worker_threads';

import { publicDispatcher } from '../util/public-address.ts';
import { decodeBody, fetchPublic, requestPublic } from './fetch-public.ts';

const OUTSIDE_OFFLINE_HARNESS = `
const dns = require('node:dns');
const { syncBuiltinESMExports } = require('node:module');
const { parentPort, workerData } = require('node:worker_threads');
const asked = [];
const real = dns.lookup;
dns.lookup = (host, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  asked.push(host);
  if (host === 'rebind.example') {
    process.nextTick(() => options && options.all
      ? callback(null, [{ address: '127.0.0.1', family: 4 }])
      : callback(null, '127.0.0.1', 4));
    return;
  }
  return real(host, options, callback);
};
syncBuiltinESMExports();
(async () => {
  const { requestPublic } = await import(workerData.module);
  const answered = await requestPublic('http://rebind.example:' + workerData.port + '/face.png', {
    lookup: () => Promise.resolve(['203.0.113.10']),
    signal: AbortSignal.timeout(500),
    headers: { accept: 'image/png' },
  });
  parentPort.postMessage({ ok: answered.ok, reason: answered.ok ? undefined : answered.reason, asked });
})().catch((error) => parentPort.postMessage({ error: String(error && error.stack || error) }));
`;

const reached: string[] = [];
const server = createServer((request, response) => {
  reached.push(request.url ?? '');
  response.writeHead(200, { 'content-type': 'image/png' });
  response.end('not really a picture');
});
let port = 0;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('a name whose resolution changes between the check and the connection', () => {
  it('never reaches the address the later resolution names', async () => {
    const worker = new Worker(OUTSIDE_OFFLINE_HARNESS, {
      eval: true,
      execArgv: [],
      env: {},
      workerData: { port, module: new URL('./fetch-public.ts', import.meta.url).href },
    });
    const result = await new Promise<{
      ok?: boolean;
      reason?: string;
      asked?: string[];
      error?: string;
    }>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    await worker.terminate();

    assert.equal(result.error, undefined, result.error ?? 'the worker failed');
    assert.deepEqual(reached, [], 'the loopback server was asked');
    assert.ok(!(result.asked ?? []).includes('rebind.example'), 'the system resolver was asked');
    assert.equal(result.ok, false);
  });
});

describe('a redirect', () => {
  it('connects every hop through the same pinning dispatcher', async () => {
    const lookup = (): Promise<readonly string[]> => Promise.resolve(['203.0.113.10']);
    const dispatchers: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      dispatchers.push(init?.dispatcher);
      const url = input instanceof Request ? input.url : String(input);
      return Promise.resolve(
        url === 'https://first.example/a'
          ? new Response(null, { status: 302, headers: { location: 'https://second.example/b' } })
          : new Response('here', { status: 200 }),
      );
    }) as typeof fetch;
    try {
      const answered = await requestPublic('https://first.example/a', {
        lookup,
        signal: AbortSignal.timeout(1000),
        headers: { accept: '*/*' },
      });
      assert.ok(answered.ok);
      assert.equal(answered.url, 'https://second.example/b');
    } finally {
      globalThis.fetch = original;
    }

    assert.equal(dispatchers.length, 2);
    assert.deepEqual(dispatchers, [publicDispatcher(lookup), publicDispatcher(lookup)]);
  });
});

describe('a source whose name never resolves', () => {
  it('is refused once the signal fires', async () => {
    const started = Date.now();
    const result = await fetchPublic('https://slow-dns.example/', {
      lookup: () => new Promise<readonly string[]>(() => {}),
      signal: AbortSignal.timeout(200),
      maxBytes: 1024,
      accept: 'text/html',
      contentType: { pattern: /^/, name: 'anything' },
    });
    assert.ok(Date.now() - started < 2_000);
    assert.equal(result.ok, false);
  });
});

describe('decodeBody', () => {
  const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

  it('reads the charset its content type names', () => {
    assert.equal(decodeBody(latin1('René'), 'text/html; charset=windows-1252'), 'René');
  });

  it('reads the charset a meta element names when the content type names none', () => {
    assert.equal(
      decodeBody(latin1('<meta charset="iso-8859-1">René'), 'text/html'),
      '<meta charset="iso-8859-1">René',
    );
  });

  it('reads the charset an http-equiv meta element names', () => {
    const html = '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">René';
    assert.equal(decodeBody(latin1(html), 'text/html'), html);
  });

  it('reads the encoding an XML declaration names', () => {
    const xml = '<?xml version="1.0" encoding="windows-1252"?><title>René</title>';
    assert.equal(decodeBody(latin1(xml), 'application/rss+xml'), xml);
  });

  it('takes the content type over what the body says', () => {
    const bytes = new TextEncoder().encode('<meta charset="windows-1252">René');
    assert.equal(
      decodeBody(bytes, 'text/html; charset=utf-8'),
      '<meta charset="windows-1252">René',
    );
  });

  it('reads UTF-8 when nothing names a charset or the one named is unknown', () => {
    const bytes = new TextEncoder().encode('René');
    assert.equal(decodeBody(bytes, 'text/html'), 'René');
    assert.equal(decodeBody(bytes, 'text/html; charset=no-such-thing'), 'René');
  });
});
