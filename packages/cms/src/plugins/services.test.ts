/**
 * Services between plugins (decision-33, TASK-284): a plugin provides at most
 * one, named by its package name, and a plugin that requires it reaches it
 * with `host.use` once every plugin has registered.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PluginHost } from '../plugin.ts';
import { createPluginRegistry } from './registry.ts';

interface Clock {
  now(): number;
}

declare module '../plugin.ts' {
  interface PluginServices {
    '@acme/plugin-clock': Clock;
  }
}

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'geekity-services-'));
after(() => rmSync(DATA_DIR, { recursive: true, force: true }));
const SITE = {
  dataDir: DATA_DIR,
  contentDir: path.join(DATA_DIR, 'content'),
  env: {},
  siteInfo: () => ({ baseUrl: 'https://example.test/', title: 'Example' }),
};

function registry(...plugins: Plugin[]) {
  return createPluginRegistry(
    plugins.map((plugin, index) => ({ plugin, source: `plugins[${String(index)}]` })),
    SITE,
  );
}

const META = { version: '1.0.0', description: 'A test plugin.', hostApi: HOST_API_VERSION };

function clockPlugin(clock: Clock = { now: () => 42 }) {
  return definePlugin({
    ...META,
    name: '@acme/plugin-clock',
    label: 'Clock',
    register(host) {
      host.provide(clock);
    },
  });
}

describe('services between plugins', () => {
  it('hands every consumer the one instance the provider registered, typed', () => {
    const clock = { now: () => 7 };
    const reached: Clock[] = [];
    const consumer = (name: string) =>
      definePlugin({
        ...META,
        name,
        label: name,
        requires: { '@acme/plugin-clock': '^1.0.0' },
        register(host) {
          host.get('/time', () => {
            const service = host.use('@acme/plugin-clock');
            reached.push(service);
            return new Response(String(service.now()));
          });
        },
      });

    const plugins = registry(
      consumer('@acme/plugin-a'),
      clockPlugin(clock),
      consumer('@acme/plugin-b'),
    );
    for (const name of ['@acme/plugin-a', '@acme/plugin-b']) {
      assert.equal(plugins.problem(name), undefined);
      void plugins
        .find(name)
        ?.routes[0]?.handler({ request: new Request('http://x/time'), params: {} });
    }
    assert.equal(reached.length, 2);
    assert.ok(reached.every((service) => service === clock));
  });

  it('throws from use during register, so registration order never matters', () => {
    const plugins = registry(
      clockPlugin(),
      definePlugin({
        ...META,
        name: '@acme/plugin-eager',
        label: 'Eager',
        requires: { '@acme/plugin-clock': '*' },
        register(host) {
          host.use('@acme/plugin-clock');
        },
      }),
    );
    assert.match(
      plugins.problem('@acme/plugin-eager') ?? '',
      /^Its register failed: .*use\(.*@acme\/plugin-clock.*once every plugin has registered/,
    );
  });

  it('refuses use on a name missing from requires, as a type error and at boot', () => {
    let held: PluginHost | undefined;
    const plugins = registry(
      clockPlugin(),
      definePlugin({
        ...META,
        name: '@acme/plugin-sneaky',
        label: 'Sneaky',
        register(host) {
          held = host;
          // @ts-expect-error -- @acme/plugin-clock is not in requires.
          host.use('@acme/plugin-clock');
        },
      }),
    );
    assert.equal(
      plugins.problem('@acme/plugin-sneaky'),
      'Its register failed: @acme/plugin-sneaky uses @acme/plugin-clock, which is not in its requires.',
    );
    assert.throws(() => held?.use('@acme/plugin-clock'), /not in its requires/);
  });

  it('refuses a second provide from one plugin, naming it', () => {
    const plugins = registry(
      definePlugin({
        ...META,
        name: '@acme/plugin-clock',
        label: 'Clock',
        register(host) {
          host.provide({ now: () => 1 });
          host.provide({ now: () => 2 });
        },
      }),
    );
    assert.equal(
      plugins.problem('@acme/plugin-clock'),
      'Its register failed: @acme/plugin-clock provides a second service. A plugin provides at most one, named by its package name.',
    );
  });

  it('refuses provide after register returns', () => {
    let held: PluginHost<'@acme/plugin-clock'> | undefined;
    registry(
      definePlugin({
        ...META,
        name: '@acme/plugin-clock',
        label: 'Clock',
        register(host) {
          held = host;
        },
      }),
    );
    assert.throws(() => held?.provide({ now: () => 1 }), /after its register returned/);
  });

  it('says so when a required plugin provides nothing', () => {
    let held: PluginHost<'@acme/plugin-c', { '@acme/plugin-clock': '*' }> | undefined;
    registry(
      definePlugin({ ...META, name: '@acme/plugin-clock', label: 'Clock', register() {} }),
      definePlugin({
        ...META,
        name: '@acme/plugin-c',
        label: 'C',
        requires: { '@acme/plugin-clock': '*' },
        register(host) {
          held = host;
        },
      }),
    );
    assert.throws(() => held?.use('@acme/plugin-clock'), /@acme\/plugin-clock provides no service/);
  });

  it('types provide by the plugin name and the service map', () => {
    definePlugin({
      ...META,
      name: '@acme/plugin-clock',
      label: 'Clock',
      register(host) {
        // @ts-expect-error -- the map says @acme/plugin-clock provides a Clock.
        host.provide({ time: 1 });
      },
    });
  });

  it('hands register the site base URL and title, read when asked', () => {
    let info: unknown;
    registry(
      definePlugin({
        ...META,
        name: '@acme/plugin-site',
        label: 'Site',
        register(host) {
          info = host.siteInfo();
        },
      }),
    );
    assert.deepEqual(info, { baseUrl: 'https://example.test/', title: 'Example' });
  });
});
