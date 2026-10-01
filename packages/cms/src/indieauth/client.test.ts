/**
 * What the site learns about a client from its client_id URL (TASK-158).
 *
 * The URL comes from whoever starts a sign-in, so the fetch is held to the
 * rules every fetch of a stranger's URL is: public hosts only, a timeout and a
 * byte limit. What comes back is either a JSON client metadata document (what
 * MCP clients publish) or an IndieAuth h-app page.
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import type { HostLookup } from '../webmention/public-address.ts';
import { fetchClientInformation, readClientInformation } from './client.ts';

const fetched: string[] = [];
let answer: (url: string, init: RequestInit | undefined) => Promise<Response> = () =>
  Promise.reject(new TypeError('fetch failed'));

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new Request(input).url;
  fetched.push(url);
  return answer(url, init);
}) as typeof fetch;
after(() => {
  globalThis.fetch = original;
});
beforeEach(() => {
  fetched.length = 0;
});

const PUBLIC: HostLookup = () => Promise.resolve(['203.0.113.7']);

function resolvingTo(address: string): HostLookup {
  return () => Promise.resolve([address]);
}

const LIMITS = { timeoutMs: 200, maxBytes: 1024 };

describe('readClientInformation', () => {
  it('reads a JSON client metadata document whose client_id is its own URL', () => {
    const client = readClientInformation(
      JSON.stringify({
        client_id: 'https://app.example/client.json',
        client_name: 'Example MCP Client',
        client_uri: 'https://app.example/',
        redirect_uris: ['http://127.0.0.1:3000/callback', 'https://app.example/cb'],
      }),
      'application/json',
      'https://app.example/client.json',
    );
    assert.deepEqual(client, {
      name: 'Example MCP Client',
      url: 'https://app.example/',
      redirectUris: ['http://127.0.0.1:3000/callback', 'https://app.example/cb'],
    });
  });

  it('trusts nothing in a JSON document that claims to be another client', () => {
    const client = readClientInformation(
      JSON.stringify({
        client_id: 'https://evil.example/client.json',
        client_name: 'Not You',
        redirect_uris: ['https://evil.example/cb'],
      }),
      'application/json',
      'https://app.example/client.json',
    );
    assert.deepEqual(client, { redirectUris: [] });
  });

  it('reads an h-app and the redirect_uri links on its page', () => {
    const client = readClientInformation(
      `<html><head><link rel="redirect_uri" href="https://other.example/cb"></head>
       <body><div class="h-app"><a class="u-url p-name" href="/">Quill</a>
       <img class="u-logo" src="/logo.png" alt=""></div></body></html>`,
      'text/html; charset=utf-8',
      'https://app.example/',
    );
    assert.deepEqual(client, {
      name: 'Quill',
      url: 'https://app.example/',
      redirectUris: ['https://other.example/cb'],
    });
  });

  it('reads the older h-x-app as well', () => {
    const client = readClientInformation(
      '<a class="h-x-app" href="https://app.example/">Indigenous</a>',
      'text/html',
      'https://app.example/',
    );
    assert.equal(client.name, 'Indigenous');
  });
});

describe('fetchClientInformation', () => {
  it('fetches a public client_id and reads it', async () => {
    answer = () =>
      Promise.resolve(
        new Response('<a class="h-app" href="https://app.example/">Quill</a>', {
          headers: { 'content-type': 'text/html' },
        }),
      );
    const result = await fetchClientInformation('https://app.example/', {
      lookup: PUBLIC,
      ...LIMITS,
    });
    assert.deepEqual(result, {
      ok: true,
      client: { name: 'Quill', url: 'https://app.example/', redirectUris: [] },
    });
  });

  it('refuses private, loopback and link-local addresses without fetching', async () => {
    const cases: [string, HostLookup][] = [
      ['http://127.0.0.1/', PUBLIC],
      ['http://localhost:3000/', PUBLIC],
      ['https://internal.example/', resolvingTo('10.0.0.5')],
      ['https://loopback.example/', resolvingTo('127.0.0.1')],
      ['https://metadata.example/', resolvingTo('169.254.169.254')],
      ['https://v6.example/', resolvingTo('fe80::1')],
    ];
    for (const [clientId, lookup] of cases) {
      const result = await fetchClientInformation(clientId, { lookup, ...LIMITS });
      assert.equal(result.ok, false, clientId);
    }
    assert.deepEqual(fetched, []);
  });

  it('refuses a redirect to a private address', async () => {
    answer = () =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/' } }),
      );
    const result = await fetchClientInformation('https://app.example/', {
      lookup: PUBLIC,
      ...LIMITS,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(fetched, ['https://app.example/']);
  });

  it('gives up on a client that does not answer in time', async () => {
    answer = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('timed out'));
        });
      });
    const started = Date.now();
    const result = await fetchClientInformation('https://slow.example/', {
      lookup: PUBLIC,
      ...LIMITS,
    });
    assert.equal(result.ok, false);
    assert.ok(Date.now() - started < 2000, 'returned soon after the timeout');
  });

  it('refuses a body over the byte limit', async () => {
    answer = () =>
      Promise.resolve(
        new Response(`<a class="h-app" href="/">${'x'.repeat(4096)}</a>`, {
          headers: { 'content-type': 'text/html' },
        }),
      );
    const result = await fetchClientInformation('https://big.example/', {
      lookup: PUBLIC,
      ...LIMITS,
    });
    assert.equal(result.ok, false);
  });
});
