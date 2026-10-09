/**
 * The shared plugin bundle build (decision-33, TASK-287):
 * `scripts/build-plugin-bundle.js`, run on fixture plugin packages written to
 * a scratch directory, each with the dependencies a real package would have
 * installed.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { cleanupTemporaryDirs, PACKAGE_ROOT, temporaryDir } from './__testing__/cli.ts';

after(cleanupTemporaryDirs);

const SCRIPT = path.resolve(PACKAGE_ROOT, '..', '..', 'scripts', 'build-plugin-bundle.js');
const ESBUILD = path.dirname(createRequire(import.meta.url).resolve('esbuild/package.json'));
const CORE_VERSION = (
  JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

const NAME = '@fixture/plugin-echo';
const BASE = '@fixture/plugin-base';

interface Fixture {
  packageJson?: Record<string, unknown>;
  source?: string;
  modules?: Record<string, Record<string, string>>;
}

const PACKAGE_JSON = {
  name: NAME,
  version: '1.2.3',
  type: 'module',
  geekity: { plugin: true, hostApi: 1, requires: { [BASE]: '>=0.3.0 <1.0.0' } },
  peerDependencies: { '@geekity/cms': 'workspace:^', [BASE]: 'workspace:>=0.3.0 <1.0.0' },
};

const SOURCE = `import { shout } from 'tiny-shout';

export default {
  name: '${NAME}',
  version: '1.2.3',
  label: shout('echo'),
  description: 'Echoes.',
  hostApi: 1,
  requires: { '${BASE}': '>=0.3.0 <1.0.0' },
  register() {},
};
`;

const TINY_SHOUT = {
  'package.json': JSON.stringify({ name: 'tiny-shout', version: '1.0.0', main: 'index.js' }),
  'index.js': 'exports.shout = (text) => text.toUpperCase() + "!";\n',
};

/** A plugin package on disk, with esbuild, core and its dependencies installed. */
async function fixture(options: Fixture = {}): Promise<string> {
  const dir = await temporaryDir('geekity-plugin-bundle-');
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(options.packageJson ?? PACKAGE_JSON),
  );
  await fs.mkdir(path.join(dir, 'src'));
  await fs.writeFile(path.join(dir, 'src', 'index.ts'), options.source ?? SOURCE);
  await fs.mkdir(path.join(dir, 'node_modules', '@geekity'), { recursive: true });
  await fs.symlink(ESBUILD, path.join(dir, 'node_modules', 'esbuild'));
  await fs.symlink(PACKAGE_ROOT, path.join(dir, 'node_modules', '@geekity', 'cms'));
  const modules = {
    'tiny-shout': TINY_SHOUT,
    [BASE]: { 'package.json': JSON.stringify({ name: BASE, version: '0.4.0' }) },
    ...options.modules,
  };
  for (const [name, files] of Object.entries(modules)) {
    for (const [file, text] of Object.entries(files)) {
      const target = path.join(dir, 'node_modules', ...name.split('/'), file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, text);
    }
  }
  return dir;
}

async function build(dir: string): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [SCRIPT], { cwd: dir });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: (failure.stdout ?? '') + (failure.stderr ?? '') };
  }
}

describe('the plugin bundle build', () => {
  it('writes one index.js with its dependencies inlined, and plugin.json from package.json', async () => {
    const dir = await fixture();

    const result = await build(dir);
    assert.equal(result.code, 0, result.output);

    const bundle = path.join(dir, 'dist', 'bundle', 'index.js');
    const text = await fs.readFile(bundle, 'utf8');
    assert.doesNotMatch(text, /from ['"]tiny-shout['"]|require\(['"]tiny-shout['"]\)/);
    assert.deepEqual(await fs.readdir(path.join(dir, 'dist', 'bundle')), [
      'index.js',
      'plugin.json',
    ]);

    const moved = path.join(await temporaryDir('geekity-plugin-bundle-alone-'), 'index.js');
    await fs.copyFile(bundle, moved);
    const plugin = ((await import(pathToFileURL(moved).href)) as { default: { label: string } })
      .default;
    assert.equal(plugin.label, 'ECHO!', 'the bundle runs with no node_modules beside it');

    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(dir, 'dist', 'bundle', 'plugin.json'), 'utf8')),
      {
        name: NAME,
        version: '1.2.3',
        hostApi: 1,
        peerDependencies: { '@geekity/cms': `>=${CORE_VERSION} <1.0.0`, [BASE]: '>=0.3.0 <1.0.0' },
      },
    );
  });

  it('fails on a dependency that is a native module', async () => {
    const gyp = await fixture({
      modules: {
        'tiny-shout': {
          ...TINY_SHOUT,
          'binding.gyp': '{ "targets": [] }',
        },
      },
    });
    const gypResult = await build(gyp);
    assert.notEqual(gypResult.code, 0);
    assert.match(gypResult.output, /tiny-shout is a native module/);

    const addon = await fixture({
      modules: {
        'tiny-shout': {
          ...TINY_SHOUT,
          'index.js': 'module.exports = require("./build/Release/shout.node");\n',
          'build/Release/shout.node': 'not really a binary',
        },
      },
    });
    const addonResult = await build(addon);
    assert.notEqual(addonResult.code, 0);
    assert.match(addonResult.output, /shout\.node is a native module/);
  });

  it('fails when package.json does not mark the package a plugin', async () => {
    const { geekity: _geekity, ...unmarked } = PACKAGE_JSON;
    const result = await build(await fixture({ packageJson: unmarked }));
    assert.notEqual(result.code, 0);
    assert.match(result.output, /"geekity": \{ "plugin": true/);
  });

  it('fails when a required plugin package is not a peer dependency', async () => {
    const result = await build(
      await fixture({
        packageJson: { ...PACKAGE_JSON, peerDependencies: { '@geekity/cms': 'workspace:^' } },
      }),
    );
    assert.notEqual(result.code, 0);
    assert.match(result.output, /requires @fixture\/plugin-base, which is not a peer dependency/);
  });

  it('fails when the plugin object’s requires differ from package.json', async () => {
    const result = await build(
      await fixture({ source: SOURCE.replace("'>=0.3.0 <1.0.0'", "'>=0.4.0 <1.0.0'") }),
    );
    assert.notEqual(result.code, 0);
    assert.match(result.output, /requires/);
    assert.match(result.output, />=0\.4\.0 <1\.0\.0/);
  });

  it('fails when a required plugin’s peer range differs from its range in requires', async () => {
    const result = await build(
      await fixture({
        packageJson: {
          ...PACKAGE_JSON,
          peerDependencies: { '@geekity/cms': 'workspace:^', [BASE]: 'workspace:^' },
        },
      }),
    );
    assert.notEqual(result.code, 0);
    assert.match(
      result.output,
      /requires @fixture\/plugin-base >=0\.3\.0 <1\.0\.0, and its peer dependency publishes >=0\.4\.0 <1\.0\.0/,
    );
  });
});
