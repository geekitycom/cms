/**
 * The plugin registry (decision-33, TASK-281): who is installed, who can run,
 * and the order their lifecycle hooks go in. Driven through the registry's own
 * API, because the questions here are about the dependency graph rather than
 * about HTTP; `screen.test.ts` covers what the admin shows of it.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PluginFederationMiddleware, PluginHost } from '../plugin.ts';
import { createPluginRegistry, DuplicatePluginError } from './registry.ts';
import type { InstalledPlugin } from './registry.ts';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'geekity-registry-'));
after(() => rmSync(DATA_DIR, { recursive: true, force: true }));
const SITE = {
  dataDir: DATA_DIR,
  contentDir: path.join(DATA_DIR, 'content'),
  env: {},
  siteInfo: () => ({ baseUrl: 'https://example.test/', title: 'Example' }),
  allowPrivateAddress: false,
  lookup: () => Promise.reject(new Error('a test resolves no names')),
};

/** A plugin with nothing to say beyond its name and what it requires. */
function plugin(name: string, requires: Record<string, string> = {}, extra: Partial<Plugin> = {}) {
  return definePlugin({
    name,
    version: '1.0.0',
    label: name,
    description: `The ${name} plugin.`,
    hostApi: HOST_API_VERSION,
    requires,
    register() {},
    ...extra,
  });
}

/** Plugins as the site config hands them over. */
function fromConfig(...plugins: Plugin[]): InstalledPlugin[] {
  return plugins.map((entry, index) => ({
    plugin: entry,
    source: `site config, plugins[${String(index)}]`,
  }));
}

describe('the plugin registry', () => {
  it('refuses two plugins with one name, naming both sources', () => {
    assert.throws(
      () =>
        createPluginRegistry(
          [
            { plugin: plugin('@acme/plugin-a'), source: 'site config, plugins[0]' },
            { plugin: plugin('@acme/plugin-a'), source: 'site config, plugins[2]' },
          ],
          SITE,
        ),
      (error: unknown) =>
        error instanceof DuplicatePluginError &&
        error.message.includes('@acme/plugin-a') &&
        error.message.includes('site config, plugins[0]') &&
        error.message.includes('site config, plugins[2]'),
    );
  });

  it('marks a plugin whose name is not a package name unavailable', () => {
    const registry = createPluginRegistry(fromConfig(plugin('Not A Package')), SITE);
    assert.match(registry.problem('Not A Package') ?? '', /not an npm package name/);
  });

  it('marks a plugin with a missing dependency unavailable, naming it and its range', () => {
    const registry = createPluginRegistry(
      fromConfig(plugin('@acme/plugin-a', { '@acme/plugin-missing': '^2.0.0' })),
      SITE,
    );
    assert.equal(
      registry.problem('@acme/plugin-a'),
      'It requires @acme/plugin-missing ^2.0.0, which is not installed.',
    );
  });

  it('marks every plugin in a dependency cycle unavailable, and what depends on them', () => {
    const registry = createPluginRegistry(
      fromConfig(
        plugin('@acme/plugin-a', { '@acme/plugin-b': '*' }),
        plugin('@acme/plugin-b', { '@acme/plugin-a': '*' }),
        plugin('@acme/plugin-c', { '@acme/plugin-a': '*' }),
        plugin('@acme/plugin-d'),
      ),
      SITE,
    );
    assert.match(registry.problem('@acme/plugin-a') ?? '', /dependency cycle/);
    assert.match(registry.problem('@acme/plugin-b') ?? '', /dependency cycle/);
    assert.equal(
      registry.problem('@acme/plugin-c'),
      'It requires @acme/plugin-a *, which is unavailable.',
    );
    assert.equal(registry.problem('@acme/plugin-d'), undefined);
  });

  it('marks a plugin that targets a newer host API unavailable', () => {
    const registry = createPluginRegistry(
      fromConfig(plugin('@acme/plugin-a', {}, { hostApi: HOST_API_VERSION + 1 })),
      SITE,
    );
    assert.match(registry.problem('@acme/plugin-a') ?? '', /host API version/);
  });

  it('keeps a plugin that could not be loaded unavailable with its reason, never registering it', () => {
    let registered = false;
    const registry = createPluginRegistry(
      [
        {
          plugin: plugin('@acme/plugin-broken', {}, { register: () => (registered = true) }),
          source: 'the plugins folder, @acme/plugin-broken',
          problem: 'Its index.js failed to load: boom',
        },
        ...fromConfig(plugin('@acme/plugin-fine')),
      ],
      SITE,
    );
    assert.equal(registry.problem('@acme/plugin-broken'), 'Its index.js failed to load: boom');
    assert.equal(registered, false);
    assert.equal(registry.problem('@acme/plugin-fine'), undefined);
  });

  it('marks a folder install whose manifest peer ranges core or an installed plugin misses unavailable', () => {
    const folder = (name: string, peers: Record<string, string>, requires = {}) => ({
      plugin: plugin(name, requires),
      source: `the plugins folder, ${name}`,
      peerDependencies: peers,
    });
    const registry = createPluginRegistry(
      [
        ...fromConfig(plugin('@acme/plugin-llm')),
        folder('@acme/plugin-new-core', { '@geekity/cms': '>=999.0.0' }),
        folder(
          '@acme/plugin-new-llm',
          { '@geekity/cms': '>=0.0.0', '@acme/plugin-llm': '^2.0.0' },
          { '@acme/plugin-llm': '^2.0.0' },
        ),
        folder(
          '@acme/plugin-fits',
          { '@geekity/cms': '>=0.0.0', '@acme/plugin-llm': '^1.0.0' },
          { '@acme/plugin-llm': '^1.0.0' },
        ),
      ],
      SITE,
    );
    assert.match(
      registry.problem('@acme/plugin-new-core') ?? '',
      /^It needs @geekity\/cms >=999\.0\.0, and this core is \d+\.\d+\.\d+\.$/,
    );
    assert.equal(
      registry.problem('@acme/plugin-new-llm'),
      'It needs @acme/plugin-llm ^2.0.0, and 1.0.0 is installed.',
    );
    assert.equal(registry.problem('@acme/plugin-fits'), undefined);
  });

  it('marks a plugin whose register throws unavailable, and still registers the rest', () => {
    const registry = createPluginRegistry(
      fromConfig(
        plugin(
          '@acme/plugin-a',
          {},
          {
            register() {
              throw new Error('no thanks');
            },
          },
        ),
        plugin('@acme/plugin-b'),
      ),
      SITE,
    );
    assert.equal(registry.problem('@acme/plugin-a'), 'Its register failed: no thanks');
    assert.equal(registry.problem('@acme/plugin-b'), undefined);
  });

  it('runs register once per installed plugin, enabled or not, with the host API version', () => {
    const seen: [string, number][] = [];
    const record = (name: string) =>
      plugin(
        name,
        {},
        {
          register(host: PluginHost) {
            seen.push([host.name, host.apiVersion]);
          },
        },
      );
    createPluginRegistry(fromConfig(record('@acme/plugin-b'), record('@acme/plugin-a')), SITE);
    assert.deepEqual(seen, [
      ['@acme/plugin-b', HOST_API_VERSION],
      ['@acme/plugin-a', HOST_API_VERSION],
    ]);
  });

  it('gives register a host whose only way to another plugin is use, once all have registered', () => {
    let keys: string[] = [];
    createPluginRegistry(
      fromConfig(
        plugin(
          '@acme/plugin-a',
          {},
          {
            register(host: PluginHost) {
              keys = Object.keys(host).sort();
            },
          },
        ),
      ),
      SITE,
    );
    assert.deepEqual(keys, [
      'apiVersion',
      'command',
      'data',
      'editorAction',
      'federation',
      'fetch',
      'get',
      'name',
      'provide',
      'screen',
      'settings',
      'siteInfo',
      'use',
    ]);
  });

  it('fails the register of a plugin whose editor action ids are not usable', () => {
    const suggest = () => ({ ok: true as const, value: '' });
    const registry = createPluginRegistry(
      fromConfig(
        plugin(
          '@acme/plugin-shouting',
          {},
          {
            register(host: PluginHost) {
              host.editorAction({ id: 'Suggest Title', field: 'title', label: 'X', suggest });
            },
          },
        ),
        plugin(
          '@acme/plugin-twice',
          {},
          {
            register(host: PluginHost) {
              host.editorAction({ id: 'suggest', field: 'title', label: 'X', suggest });
              host.editorAction({ id: 'suggest', field: 'tags', label: 'Y', suggest });
            },
          },
        ),
      ),
      SITE,
    );
    assert.match(
      registry.problem('@acme/plugin-shouting') ?? '',
      /"Suggest Title" is not an editor action id/,
    );
    assert.match(
      registry.problem('@acme/plugin-twice') ?? '',
      /two editor actions with the id "suggest"/,
    );
  });

  it('refuses two packages whose names make one variable prefix, naming both', () => {
    const registry = createPluginRegistry(
      fromConfig(plugin('@a/b-c'), plugin('@a-b/c'), plugin('@a/other')),
      SITE,
    );
    for (const [name, other] of [
      ['@a/b-c', '@a-b/c'],
      ['@a-b/c', '@a/b-c'],
    ] as const) {
      const problem = registry.problem(name) ?? '';
      assert.match(problem, /A_B_C__/, `${name} names the prefix`);
      assert.ok(problem.includes(other), `${name} names ${other}`);
    }
    assert.equal(registry.problem('@a/other'), undefined);
  });

  it('marks a plugin whose settings cannot be stored unavailable', () => {
    const declaring = (name: string, register: Plugin['register']) =>
      plugin(name, {}, { register });
    const registry = createPluginRegistry(
      fromConfig(
        declaring('@acme/plugin-camel', (host) => {
          host.settings([{ type: 'text', key: 'baseUrl', label: 'Base URL' }]);
        }),
        declaring('@acme/plugin-twice', (host) => {
          host.settings([
            { type: 'text', key: 'model', label: 'Model' },
            { type: 'secret', key: 'model', label: 'Model' },
          ]);
        }),
        declaring('@acme/plugin-enabled', (host) => {
          host.settings([{ type: 'checkbox', key: 'enabled', label: 'On' }]);
        }),
      ),
      SITE,
    );
    assert.match(registry.problem('@acme/plugin-camel') ?? '', /"baseUrl"/);
    assert.match(registry.problem('@acme/plugin-twice') ?? '', /"model".*twice/);
    assert.match(registry.problem('@acme/plugin-enabled') ?? '', /"enabled"/);
  });

  it('gives each plugin a private data folder under data/plugins/<package name>/', async () => {
    let folder: PluginHost['data'] | undefined;
    createPluginRegistry(
      fromConfig(plugin('@acme/plugin-files', {}, { register: (host) => (folder = host.data) })),
      SITE,
    );
    assert.ok(folder !== undefined);
    assert.equal(folder.path, path.join(DATA_DIR, 'plugins', '@acme', 'plugin-files'));
    assert.equal(folder.read('state.json'), undefined, 'nothing is there before a write');

    await Promise.all([
      folder.update('state.json', (current) => `${current ?? ''}a`),
      folder.update('state.json', (current) => `${current ?? ''}b`),
    ]);
    assert.equal(readFileSync(path.join(folder.path, 'state.json'), 'utf8'), 'ab');
    assert.equal(folder.read('state.json'), 'ab', 'two updates at once lose neither');
  });

  it('keeps a plugin inside its data folder', () => {
    let folder: PluginHost['data'] | undefined;
    createPluginRegistry(
      fromConfig(plugin('@acme/plugin-files', {}, { register: (host) => (folder = host.data) })),
      SITE,
    );
    for (const name of ['../escape.json', 'nested/file.json', '.hidden', '']) {
      assert.throws(() => folder?.read(name), /file name/, name);
    }
  });

  it('collects the federation middleware, the screen and the commands a plugin declares', () => {
    const middleware: PluginFederationMiddleware = (_context, next) => next();
    const command = { words: ['say'], usage: '', summary: 'Says.', run: () => 0 };
    const registry = createPluginRegistry(
      fromConfig(
        plugin(
          '@acme/plugin-a',
          {},
          {
            register(host) {
              host.federation(middleware);
              host.screen({ title: 'A', render: () => [] });
              host.command(command);
            },
          },
        ),
      ),
      SITE,
    );
    const found = registry.find('@acme/plugin-a');
    assert.deepEqual(found?.federation, [middleware]);
    assert.equal(found?.screen?.title, 'A');
    assert.deepEqual(found?.commands, [command]);
  });

  it('refuses a second screen, and anything declared after register returns', () => {
    let late: PluginHost | undefined;
    const registry = createPluginRegistry(
      fromConfig(
        plugin(
          '@acme/plugin-two-screens',
          {},
          {
            register(host) {
              host.screen({ title: 'One', render: () => [] });
              host.screen({ title: 'Two', render: () => [] });
            },
          },
        ),
        plugin('@acme/plugin-late', {}, { register: (host) => (late = host) }),
      ),
      SITE,
    );
    assert.match(registry.problem('@acme/plugin-two-screens') ?? '', /one screen/);
    assert.equal(registry.find('@acme/plugin-two-screens')?.screen, undefined);
    assert.throws(() => late?.command({ words: ['x'], usage: '', summary: '', run: () => 0 }));
  });

  it('counts a plugin active only when it and everything it requires is enabled', () => {
    const registry = createPluginRegistry(
      fromConfig(plugin('@acme/plugin-a', { '@acme/plugin-b': '*' }), plugin('@acme/plugin-b')),
      SITE,
    );
    assert.deepEqual([...registry.active(new Set(['@acme/plugin-a']))], []);
    assert.deepEqual([...registry.active(new Set(['@acme/plugin-a', '@acme/plugin-b']))].sort(), [
      '@acme/plugin-a',
      '@acme/plugin-b',
    ]);
    assert.deepEqual([...registry.active(new Set(['@acme/plugin-x']))], []);
  });

  it('starts dependencies first and stops dependents first', async () => {
    const calls: string[] = [];
    const tracked = (name: string, requires: Record<string, string> = {}) =>
      plugin(name, requires, {
        start: () => {
          calls.push(`start ${name}`);
        },
        stop: () => {
          calls.push(`stop ${name}`);
        },
      });
    // Installed dependents first, so the order cannot be install order.
    const registry = createPluginRegistry(
      fromConfig(
        tracked('@acme/plugin-c', { '@acme/plugin-b': '*' }),
        tracked('@acme/plugin-b', { '@acme/plugin-a': '*' }),
        tracked('@acme/plugin-a'),
      ),
      SITE,
    );
    const all = new Set(['@acme/plugin-a', '@acme/plugin-b', '@acme/plugin-c']);

    await registry.reconcile(all);
    await registry.reconcile(all);
    assert.deepEqual(calls, [
      'start @acme/plugin-a',
      'start @acme/plugin-b',
      'start @acme/plugin-c',
    ]);

    calls.length = 0;
    await registry.reconcile(new Set(['@acme/plugin-b', '@acme/plugin-c']));
    assert.deepEqual(calls, ['stop @acme/plugin-c', 'stop @acme/plugin-b', 'stop @acme/plugin-a']);

    calls.length = 0;
    await registry.reconcile(all);
    await registry.close();
    assert.deepEqual(calls, [
      'start @acme/plugin-a',
      'start @acme/plugin-b',
      'start @acme/plugin-c',
      'stop @acme/plugin-c',
      'stop @acme/plugin-b',
      'stop @acme/plugin-a',
    ]);

    calls.length = 0;
    await registry.reconcile(all);
    assert.deepEqual(calls, [], 'nothing starts once the registry is closed');
  });

  it('runs nothing of a plugin before every plugin has registered', () => {
    const calls: string[] = [];
    createPluginRegistry(
      fromConfig(
        plugin(
          '@acme/plugin-a',
          {},
          {
            register: () => calls.push('register a'),
            start: () => {
              calls.push('start a');
            },
          },
        ),
        plugin('@acme/plugin-b', {}, { register: () => calls.push('register b') }),
      ),
      SITE,
    );
    assert.deepEqual(calls, ['register a', 'register b']);
  });

  it('says what stands in the way of enabling a plugin, and of disabling one', () => {
    const registry = createPluginRegistry(
      fromConfig(
        plugin('@acme/plugin-a', { '@acme/plugin-b': '^1.0.0', '@acme/plugin-gone': '^3.0.0' }),
        plugin('@acme/plugin-b'),
        plugin('@acme/plugin-c', { '@acme/plugin-b': '*' }),
      ),
      SITE,
    );
    assert.deepEqual(registry.requirements('@acme/plugin-c', new Set()), [
      { name: '@acme/plugin-b', range: '*', state: 'disabled' },
    ]);
    assert.deepEqual(registry.requirements('@acme/plugin-c', new Set(['@acme/plugin-b'])), [
      { name: '@acme/plugin-b', range: '*', state: 'enabled' },
    ]);
    assert.deepEqual(registry.requirements('@acme/plugin-a', new Set()), [
      { name: '@acme/plugin-b', range: '^1.0.0', state: 'disabled' },
      { name: '@acme/plugin-gone', range: '^3.0.0', state: 'missing' },
    ]);
    assert.deepEqual(
      registry.enabledDependents('@acme/plugin-b', new Set(['@acme/plugin-b', '@acme/plugin-c'])),
      ['@acme/plugin-c'],
    );
  });
});
