/**
 * A plugin's outbound fetch (decision-33, TASK-286): another site's URL, with
 * the guard the site's federation keeps against reaching its own network.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { PluginHost } from '../plugin.ts';
import { createPluginRegistry } from './registry.ts';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'geekity-plugin-fetch-'));
const PUBLIC = 'https://public.example/tag';

/** What the loopback server was asked for, which a refused redirect must leave empty. */
const reached: string[] = [];
const server = createServer((request, response) => {
  reached.push(request.url ?? '');
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('inside');
});
let inside = '';

const offline = globalThis.fetch;
const sent: Request[] = [];

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  inside = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/secret`;
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).hostname !== 'public.example') return offline(input, init);
    sent.push(request);
    return Promise.resolve(
      request.url === PUBLIC
        ? new Response(null, { status: 302, headers: { location: inside } })
        : new Response('public', { headers: { 'content-type': 'text/plain' } }),
    );
  };
});
afterEach(() => {
  reached.length = 0;
  sent.length = 0;
});
after(() => {
  globalThis.fetch = offline;
  server.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

function hostFor(allowPrivateAddress: boolean): PluginHost {
  let captured: PluginHost | undefined;
  createPluginRegistry(
    [
      {
        source: 'test',
        plugin: definePlugin({
          name: '@acme/plugin-fetcher',
          version: '1.0.0',
          label: 'Fetcher',
          description: 'Fetches.',
          hostApi: HOST_API_VERSION,
          register(host) {
            captured = host;
          },
        }),
      },
    ],
    {
      dataDir: DATA_DIR,
      contentDir: path.join(DATA_DIR, 'content'),
      env: {},
      siteInfo: () => ({ baseUrl: 'https://example.test/', title: 'Example' }),
      allowPrivateAddress,
      lookup: (hostname) =>
        Promise.resolve(hostname === 'public.example' ? ['93.184.216.34'] : ['10.0.0.8']),
    },
  );
  assert.ok(captured !== undefined);
  return captured;
}

describe('a plugin’s fetch', () => {
  it('refuses a redirect planted to 127.0.0.1, without reaching it', async () => {
    await assert.rejects(hostFor(false).fetch(PUBLIC), /not a public address/);
    assert.equal(sent.length, 1, 'the public URL was asked');
    assert.deepEqual(reached, [], 'the loopback server was never reached');
  });

  it('refuses a loopback address or a name that resolves privately, asking nothing', async () => {
    const host = hostFor(false);
    await assert.rejects(host.fetch(inside), /not a public address/);
    await assert.rejects(host.fetch('https://intranet.example/'), /not a public address/);
    assert.deepEqual(reached, []);
  });

  it('follows the redirect to loopback when the site allows private addresses', async () => {
    const response = await hostFor(true).fetch(PUBLIC);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'inside');
    assert.deepEqual(reached, ['/secret']);
  });

  it('sends the plugin’s headers and answers the response as it came', async () => {
    const response = await hostFor(false).fetch('https://public.example/plain', {
      headers: { 'user-agent': 'Acme/1.0 (+https://example.test/)', accept: 'text/plain' },
    });
    assert.equal(await response.text(), 'public');
    assert.equal(sent[0]?.headers.get('user-agent'), 'Acme/1.0 (+https://example.test/)');
    assert.equal(sent[0]?.headers.get('accept'), 'text/plain');
  });

  it('refuses anything but http and https', async () => {
    await assert.rejects(hostFor(true).fetch('file:///etc/passwd'), /not an http or https URL/);
  });
});
