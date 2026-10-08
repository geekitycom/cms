/**
 * `geekity plugin add` and `geekity plugin remove` (TASK-287): installing a
 * plugin package's bundle into the plugins folder from a registry, which here
 * is a fake one on loopback.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, runCli, temporaryDir } from './__testing__/cli.ts';
import { fakeNpmRegistry, pluginFiles } from './__testing__/npm-registry.ts';
import type { FakePackage } from './__testing__/npm-registry.ts';
import { HOST_API_VERSION } from './plugin.ts';

after(cleanupTemporaryDirs);

const registries: { close(): Promise<void> }[] = [];
after(() => Promise.all(registries.map((registry) => registry.close())));

const LLM = '@acme/plugin-llm';
const SUMMARY = '@acme/plugin-summary';

function release(name: string, version: string, extra: Partial<FakePackage> = {}): FakePackage {
  return { name, version, files: pluginFiles({ name, version }), ...extra };
}

/** A site with a plugins folder, and a way to run `geekity` against a registry. */
async function setup(packages: readonly FakePackage[]) {
  const registry = await fakeNpmRegistry(packages);
  registries.push(registry);
  const site = await temporaryDir('geekity-plugin-add-');
  const pluginsDir = path.join(site, 'plugins');
  const geekity = (...args: string[]) =>
    runCli(['plugin', ...args], site, undefined, {
      GEEKITY_PLUGINS_DIR: pluginsDir,
      npm_config_registry: registry.url,
    });
  return { site, pluginsDir, registry, geekity };
}

/** Every entry under the plugins folder, hidden ones too, as paths relative to it. */
async function tree(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true });
  return entries.map((entry) => entry.split(path.sep).join('/')).sort();
}

async function installedVersion(pluginsDir: string, name: string): Promise<string> {
  const manifest = JSON.parse(
    await fs.readFile(path.join(pluginsDir, name, 'plugin.json'), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

describe('geekity plugin add', () => {
  it('unpacks the bundle and manifest into plugins/<package name>/ and nothing else', async () => {
    const { pluginsDir, geekity } = await setup([release(LLM, '1.0.0')]);

    const result = await geekity('add', LLM);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Added @acme\/plugin-llm 1\.0\.0/);
    assert.match(result.stdout, /Reload/);
    assert.deepEqual(await tree(pluginsDir), [
      '@acme',
      '@acme/plugin-llm',
      '@acme/plugin-llm/index.js',
      '@acme/plugin-llm/plugin.json',
    ]);
  });

  it('installs the version, dist-tag or range it is given', async () => {
    const { pluginsDir, geekity } = await setup([
      release(LLM, '1.0.0'),
      release(LLM, '1.1.0', { tags: ['next'] }),
      release(LLM, '2.0.0'),
    ]);

    await geekity('add', `${LLM}@1.0.0`);
    assert.equal(await installedVersion(pluginsDir, LLM), '1.0.0');
    await geekity('add', `${LLM}@next`);
    assert.equal(await installedVersion(pluginsDir, LLM), '1.1.0');
    await geekity('add', `${LLM}@^1.0.0`);
    assert.equal(await installedVersion(pluginsDir, LLM), '1.1.0');
    await geekity('add', LLM);
    assert.equal(await installedVersion(pluginsDir, LLM), '2.0.0');

    const missing = await geekity('add', `${LLM}@9.9.9`);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /@acme\/plugin-llm has no version matching 9\.9\.9/);
  });

  it('is idempotent, and replaces an older version with no folder left beside it', async () => {
    const { pluginsDir, geekity } = await setup([release(LLM, '1.0.0'), release(LLM, '1.1.0')]);

    await geekity('add', `${LLM}@1.0.0`);
    const first = await tree(pluginsDir);
    const again = await geekity('add', `${LLM}@1.0.0`);
    assert.equal(again.code, 0, again.stderr);
    assert.deepEqual(await tree(pluginsDir), first);

    const newer = await geekity('add', `${LLM}@1.1.0`);
    assert.match(newer.stdout, /Replaced @acme\/plugin-llm 1\.0\.0 with 1\.1\.0/);
    assert.deepEqual(await tree(pluginsDir), first);
    assert.equal(await installedVersion(pluginsDir, LLM), '1.1.0');
  });

  it('refuses a bad tarball, a package with no bundle and a newer host API, leaving the folder as it was', async () => {
    const noBundle = pluginFiles({ name: '@acme/plugin-plain', version: '1.0.0' });
    delete noBundle['dist/bundle/index.js'];
    delete noBundle['dist/bundle/plugin.json'];
    const { pluginsDir, geekity } = await setup([
      release(LLM, '1.0.0'),
      release(LLM, '1.1.0', { integrity: `sha512-${Buffer.alloc(64).toString('base64')}` }),
      release('@acme/plugin-plain', '1.0.0', { files: noBundle }),
      {
        name: '@acme/plugin-future',
        version: '1.0.0',
        files: pluginFiles({
          name: '@acme/plugin-future',
          version: '1.0.0',
          hostApi: HOST_API_VERSION + 1,
        }),
      },
    ]);
    await geekity('add', `${LLM}@1.0.0`);
    const before = await tree(pluginsDir);
    const bundle = await fs.readFile(path.join(pluginsDir, LLM, 'index.js'), 'utf8');

    const tampered = await geekity('add', `${LLM}@1.1.0`);
    assert.equal(tampered.code, 1);
    assert.match(tampered.stderr, /integrity/);

    const plain = await geekity('add', '@acme/plugin-plain');
    assert.equal(plain.code, 1);
    assert.match(plain.stderr, /@acme\/plugin-plain 1\.0\.0 has no plugin bundle/);

    const future = await geekity('add', '@acme/plugin-future');
    assert.equal(future.code, 1);
    assert.match(
      future.stderr,
      new RegExp(
        `targets host API version ${String(HOST_API_VERSION + 1)}, and this core provides version ${String(HOST_API_VERSION)}`,
      ),
    );

    assert.deepEqual(await tree(pluginsDir), before);
    assert.equal(await fs.readFile(path.join(pluginsDir, LLM, 'index.js'), 'utf8'), bundle);
  });

  it('installs a plugin whose requirements are missing or out of range, naming each, and installs nothing else', async () => {
    const summary = {
      name: SUMMARY,
      version: '1.0.0',
      files: pluginFiles({ name: SUMMARY, version: '1.0.0', requires: { [LLM]: '^2.0.0' } }),
    };
    const { pluginsDir, registry, geekity } = await setup([release(LLM, '1.0.0'), summary]);

    const missing = await geekity('add', SUMMARY);
    assert.equal(missing.code, 0, missing.stderr);
    assert.match(
      missing.stdout,
      /It requires @acme\/plugin-llm \^2\.0\.0, which is not installed\. Add it with: geekity plugin add @acme\/plugin-llm/,
    );
    assert.deepEqual(await tree(pluginsDir), [
      '@acme',
      '@acme/plugin-summary',
      '@acme/plugin-summary/index.js',
      '@acme/plugin-summary/plugin.json',
    ]);
    assert.ok(!registry.requests.some((request) => request.includes('plugin-llm')));

    await geekity('add', LLM);
    const outOfRange = await geekity('add', SUMMARY);
    assert.match(
      outOfRange.stdout,
      /It requires @acme\/plugin-llm \^2\.0\.0, and 1\.0\.0 is installed\./,
    );
  });

  it('needs a plugins folder', async () => {
    const site = await temporaryDir('geekity-plugin-add-');
    const result = await runCli(['plugin', 'add', LLM], site, undefined, {
      GEEKITY_PLUGINS_DIR: '',
      npm_config_registry: 'http://127.0.0.1:9',
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /GEEKITY_PLUGINS_DIR/);
  });
});

describe('geekity plugin remove', () => {
  it('deletes the plugin’s folder, and says so when there is none', async () => {
    const { pluginsDir, geekity } = await setup([release(LLM, '1.0.0')]);
    await geekity('add', LLM);

    const removed = await geekity('remove', LLM);
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stdout, /Removed @acme\/plugin-llm/);
    assert.deepEqual(await tree(pluginsDir), ['@acme']);

    const absent = await geekity('remove', LLM);
    assert.equal(absent.code, 1);
    assert.match(absent.stderr, /@acme\/plugin-llm is not in the plugins folder/);
  });
});
