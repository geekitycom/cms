import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { importPluginFolders, pluginFolderChanges, scanPluginFolders } from './folder.ts';

const dirs: string[] = [];
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function pluginsDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-plugin-folder-'));
  dirs.push(dir);
  return dir;
}

/** A bundle as `geekity plugin add` leaves it: a default export that is the plugin. */
function bundle(name: string): string {
  return `export default {
  name: ${JSON.stringify(name)},
  version: '1.0.0',
  label: ${JSON.stringify(name)},
  description: 'From a folder.',
  hostApi: 1,
  requires: {},
  register() {},
};
`;
}

async function install(dir: string, name: string, source = bundle(name)): Promise<void> {
  await mkdir(path.join(dir, name), { recursive: true });
  await writeFile(path.join(dir, name, 'index.js'), source);
}

describe('scanPluginFolders', () => {
  it('finds nothing when the site names no folder, or the folder is missing', async () => {
    assert.deepEqual(scanPluginFolders(undefined), []);
    assert.deepEqual(scanPluginFolders(path.join(await pluginsDir(), 'absent')), []);
  });

  it('finds one folder per plugin, scoped or not, and skips files and hidden folders', async () => {
    const dir = await pluginsDir();
    await install(dir, 'plugin-alpha');
    await install(dir, '@acme/plugin-beta');
    await writeFile(path.join(dir, 'README.txt'), 'not a plugin');
    await install(dir, '.staging-plugin-gamma');

    assert.deepEqual(
      scanPluginFolders(dir).map((folder) => folder.name),
      ['@acme/plugin-beta', 'plugin-alpha'],
    );
  });
});

describe('pluginFolderChanges', () => {
  it('names the folders added, removed and updated since a scan, and nothing when none changed', async () => {
    const dir = await pluginsDir();
    await install(dir, 'plugin-kept');
    await install(dir, 'plugin-updated');
    await install(dir, 'plugin-removed');
    const loaded = scanPluginFolders(dir);

    assert.equal(pluginFolderChanges(loaded, scanPluginFolders(dir)), undefined);

    await install(dir, '@acme/plugin-added');
    await writeFile(
      path.join(dir, 'plugin-updated', 'index.js'),
      `${bundle('plugin-updated')}// 2\n`,
    );
    await rm(path.join(dir, 'plugin-removed'), { recursive: true });

    assert.deepEqual(pluginFolderChanges(loaded, scanPluginFolders(dir)), {
      added: ['@acme/plugin-added'],
      removed: ['plugin-removed'],
      updated: ['plugin-updated'],
    });
  });
});

describe('importPluginFolders', () => {
  it('imports each folder’s default export, naming the folder as its source', async () => {
    const dir = await pluginsDir();
    await install(dir, '@acme/plugin-beta');

    const [installed] = await importPluginFolders(scanPluginFolders(dir));
    assert.equal(installed?.plugin.name, '@acme/plugin-beta');
    assert.equal(installed?.source, 'the plugins folder, @acme/plugin-beta');
  });

  it('refuses a folder whose module exports no plugin, naming it', async () => {
    const dir = await pluginsDir();
    await install(dir, 'plugin-empty', 'export const nothing = 1;\n');

    await assert.rejects(importPluginFolders(scanPluginFolders(dir)), /plugin-empty/);
  });
});
