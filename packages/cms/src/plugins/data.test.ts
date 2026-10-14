import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { dataFileFor } from '../files/data-files.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import { pluginRegistryOptions } from '../__testing__/plugin-registry-options.ts';
import { siteDataFiles } from './data.ts';
import { createPluginRegistry } from './registry.ts';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'geekity-plugin-data-'));
after(() => rmSync(DATA_DIR, { recursive: true, force: true }));

function folderWith(name: string, ...files: string[]): void {
  const folder = path.join(DATA_DIR, 'plugins', ...name.split('/'));
  mkdirSync(folder, { recursive: true });
  for (const file of files) writeFileSync(path.join(folder, file), '{}');
}

describe('siteDataFiles', () => {
  const options = pluginRegistryOptions(DATA_DIR);
  const plugins = createPluginRegistry(
    [
      {
        source: 'site config, plugins[0]',
        plugin: definePlugin({
          name: '@acme/plugin-loaded',
          version: '1.0.0',
          label: 'Loaded',
          description: 'Keeps files.',
          hostApi: HOST_API_VERSION,
          data: { 'records.json': 'kept', 'cache.json': 'rebuildable' },
          register(host) {
            host.settings([{ type: 'secret', key: 'api_key', label: 'API key' }]);
          },
        }),
      },
      {
        source: 'site config, plugins[1]',
        plugin: definePlugin({
          name: '@acme/plugin-broken',
          version: '1.0.0',
          label: 'Broken',
          description: 'Fails to register.',
          hostApi: HOST_API_VERSION,
          data: { 'cache.json': 'rebuildable' },
          register() {
            throw new Error('no');
          },
        }),
      },
    ],
    options,
  );
  folderWith('@acme/plugin-loaded', 'records.json', 'stray.json');
  folderWith('@acme/plugin-broken', 'cache.json');
  folderWith('@gone/plugin-removed', 'settings.json', 'secrets.json', 'actors.json');
  folderWith('plugin-unscoped', 'notes.json');

  const declared = siteDataFiles({ dataDir: DATA_DIR, settings: options.settings, plugins });
  const classOf = (relative: string) => dataFileFor(declared, relative)?.dataClass.kind;

  it('holds the core files and the settings files', () => {
    assert.equal(classOf('users.json'), 'kept');
    assert.equal(classOf('geekity.db'), 'rebuildable');
    assert.equal(classOf('mail.json'), 'credential');
    assert.equal(classOf('plugins/@acme/plugin-loaded/settings.json'), 'kept');
    assert.equal(classOf('plugins/@acme/plugin-loaded/secrets.json'), 'credential');
  });

  it("holds a loaded plugin's own files, and nothing else in its folder", () => {
    assert.equal(classOf('plugins/@acme/plugin-loaded/records.json'), 'kept');
    assert.equal(classOf('plugins/@acme/plugin-loaded/cache.json'), 'rebuildable');
    assert.equal(classOf('plugins/@acme/plugin-loaded/stray.json'), undefined);
    assert.equal(classOf('plugins/@acme/plugin-loaded/records.json.123-1.tmp'), 'scratch');
  });

  it('reads a folder whose plugin is not loaded as kept, apart from its secrets', () => {
    assert.equal(classOf('plugins/@gone/plugin-removed/actors.json'), 'kept');
    assert.equal(classOf('plugins/@gone/plugin-removed/settings.json'), 'kept');
    assert.equal(classOf('plugins/@gone/plugin-removed/secrets.json'), 'credential');
    assert.equal(classOf('plugins/@acme/plugin-broken/cache.json'), 'kept');
    assert.equal(classOf('plugins/plugin-unscoped/notes.json'), 'kept');
  });
});

describe('Cms.dataFiles', () => {
  const box = sandbox();
  after(() => box.cleanup());

  it("is the booted site's declarations: core, settings and each loaded plugin's", async () => {
    const cms = await box.site({
      plugins: [
        definePlugin({
          name: '@acme/plugin-kept',
          version: '1.0.0',
          label: 'Kept',
          description: 'Keeps a file.',
          hostApi: HOST_API_VERSION,
          data: { 'records.json': 'kept' },
          register(host) {
            host.settings([{ type: 'secret', key: 'api_key', label: 'API key' }]);
          },
        }),
      ],
    });
    const left = path.join(cms.config.dataDir, 'plugins', '@gone', 'plugin-left');
    mkdirSync(left, { recursive: true });
    writeFileSync(path.join(left, 'notes.json'), '{}');
    const classOf = (relative: string) => dataFileFor(cms.dataFiles(), relative)?.dataClass.kind;

    assert.equal(classOf('queue.sqlite'), 'pending');
    assert.equal(classOf('akismet.json'), 'credential');
    assert.equal(classOf('plugins/@acme/plugin-kept/records.json'), 'kept');
    assert.equal(classOf('plugins/@acme/plugin-kept/secrets.json'), 'credential');
    assert.equal(classOf('plugins/@acme/plugin-kept/stray.json'), undefined);
    assert.equal(classOf('plugins/@gone/plugin-left/notes.json'), 'kept');
  });
});
