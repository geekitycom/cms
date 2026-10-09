import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  importPluginFolders,
  pluginFolderChanges,
  pluginFolderSignature,
  pluginsFingerprint,
  scanPluginFolders,
} from './folder.ts';

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

describe('what the supervisor watches (TASK-309)', () => {
  it('changes the signature with any write in a plugin folder, and not in a hidden one', async () => {
    const dir = await pluginsDir();
    await install(dir, 'plugin-alpha');
    const before = pluginFolderSignature(dir);
    assert.equal(pluginFolderSignature(dir), before, 'reading it again changes nothing');

    await install(dir, '.staging-plugin-beta');
    assert.equal(pluginFolderSignature(dir), before, 'a folder being staged is not watched');

    await writeFile(path.join(dir, 'plugin-alpha', 'extra.js'), '// more\n');
    assert.notEqual(pluginFolderSignature(dir), before);
  });

  it('fingerprints a scan by content, so a folder put back as it was reads as unchanged', async () => {
    const dir = await pluginsDir();
    await install(dir, 'plugin-alpha');
    const loaded = pluginsFingerprint(scanPluginFolders(dir));

    await install(dir, '@acme/plugin-beta');
    assert.notEqual(pluginsFingerprint(scanPluginFolders(dir)), loaded);

    await rm(path.join(dir, '@acme'), { recursive: true });
    await install(dir, 'plugin-alpha');
    assert.equal(pluginsFingerprint(scanPluginFolders(dir)), loaded);
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

  it('keeps a folder that fails to import, or exports no plugin, as an unavailable plugin with the reason', async () => {
    const dir = await pluginsDir();
    await install(dir, 'plugin-empty', 'export const nothing = 1;\n');
    await install(dir, '@acme/plugin-throws', "throw new Error('no network at import');\n");
    await mkdir(path.join(dir, 'plugin-no-bundle'));

    const installed = await importPluginFolders(scanPluginFolders(dir));
    assert.deepEqual(
      installed.map(({ plugin, source, problem }) => ({ name: plugin.name, source, problem })),
      [
        {
          name: '@acme/plugin-throws',
          source: 'the plugins folder, @acme/plugin-throws',
          problem: 'Its index.js failed to load: no network at import',
        },
        {
          name: 'plugin-empty',
          source: 'the plugins folder, plugin-empty',
          problem: 'Its index.js does not export a plugin as its default export.',
        },
        {
          name: 'plugin-no-bundle',
          source: 'the plugins folder, plugin-no-bundle',
          problem: 'It has no index.js.',
        },
      ],
    );
  });

  it('carries the peer ranges a folder’s plugin.json names', async () => {
    const dir = await pluginsDir();
    await install(dir, '@acme/plugin-beta');
    const peers = { '@geekity/cms': '^0.24.0', '@acme/plugin-llm': '^1.0.0' };
    await writeFile(
      path.join(dir, '@acme', 'plugin-beta', 'plugin.json'),
      JSON.stringify({
        name: '@acme/plugin-beta',
        version: '1.0.0',
        hostApi: 1,
        peerDependencies: peers,
      }),
    );

    const [installed] = await importPluginFolders(scanPluginFolders(dir));
    assert.deepEqual(installed?.peerDependencies, peers);
    assert.equal(installed?.problem, undefined);
  });
});
