import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, runCli, temporaryDir } from './__testing__/cli.ts';
import { fakeNpmRegistry, pluginFiles } from './__testing__/npm-registry.ts';
import type { FakePackage } from './__testing__/npm-registry.ts';

after(cleanupTemporaryDirs);

const registries: { close(): Promise<void> }[] = [];
after(() => Promise.all(registries.map((registry) => registry.close())));

const LLM = '@acme/plugin-llm';
const SUMMARY = '@acme/plugin-summary';
const TAGS = '@acme/plugin-tags';
const RELOAD =
  'No running geekity serve answered. A running site loads the change by itself within a few seconds.';
const CORE = (
  JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

function release(
  name: string,
  version: string,
  options: { core?: string; requires?: Record<string, string> } & Partial<FakePackage> = {},
): FakePackage {
  const { core = '>=0.0.0', requires = {}, ...extra } = options;
  return { name, version, files: pluginFiles({ name, version, core, requires }), ...extra };
}

async function setup(packages: readonly FakePackage[]) {
  const registry = await fakeNpmRegistry(packages);
  registries.push(registry);
  const site = await temporaryDir('geekity-plugin-upgrade-');
  const pluginsDir = path.join(site, 'plugins');
  const run =
    (registryUrl: string) =>
    (...args: string[]) =>
      runCli(['plugin', ...args], site, undefined, {
        GEEKITY_PLUGINS_DIR: pluginsDir,
        npm_config_registry: registryUrl,
      });
  return { pluginsDir, registry, geekity: run(registry.url), offline: run('http://127.0.0.1:9') };
}

async function installedVersion(pluginsDir: string, name: string): Promise<string> {
  const manifest = JSON.parse(
    await fs.readFile(path.join(pluginsDir, name, 'plugin.json'), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

async function tree(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true });
  return entries.map((entry) => entry.split(path.sep).join('/')).sort();
}

function tarballRequests(requests: readonly string[]): string[] {
  return requests.filter((request) => request.startsWith('/tarballs/'));
}

describe('geekity plugin upgrade', () => {
  it('installs the newest version this core can run, one line per plugin, and says to Reload', async () => {
    const { pluginsDir, geekity } = await setup([
      release(LLM, '1.0.0'),
      release(LLM, '1.1.0'),
      release(LLM, '2.0.0', { core: '>=99.0.0' }),
      release(TAGS, '1.0.0'),
    ]);
    await geekity('add', `${LLM}@1.0.0`);
    await geekity('add', TAGS);

    const result = await geekity('upgrade');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      [
        `${LLM}: upgraded from 1.0.0 to 1.1.0. 2.0.0 needs @geekity/cms >=99.0.0, and this core is ${CORE}.`,
        `${TAGS}: 1.0.0 is the newest.`,
        RELOAD,
        '',
      ].join('\n'),
    );
    assert.equal(await installedVersion(pluginsDir, LLM), '1.1.0');
    assert.ok(!(await tree(pluginsDir)).some((entry) => entry.split('/').pop()?.startsWith('.')));

    const again = await geekity('upgrade');
    assert.equal(again.code, 0, again.stderr);
    assert.equal(
      again.stdout,
      [
        `${LLM}: held back at 1.1.0: 2.0.0 needs @geekity/cms >=99.0.0, and this core is ${CORE}.`,
        `${TAGS}: 1.0.0 is the newest.`,
        '',
      ].join('\n'),
    );
  });

  it('upgrades only the plugins it is named, and --check installs nothing', async () => {
    const { pluginsDir, registry, geekity } = await setup([
      release(LLM, '1.0.0'),
      release(TAGS, '1.0.0'),
      release(LLM, '1.1.0'),
      release(TAGS, '1.1.0'),
    ]);
    await geekity('add', `${LLM}@1.0.0`);
    await geekity('add', `${TAGS}@1.0.0`);
    const before = await tree(pluginsDir);
    const asked = registry.requests.length;

    const check = await geekity('upgrade', '--check');
    assert.equal(check.code, 0, check.stderr);
    assert.equal(
      check.stdout,
      [
        `${LLM}: 1.0.0 can be upgraded to 1.1.0.`,
        `${TAGS}: 1.0.0 can be upgraded to 1.1.0.`,
        'Run geekity plugin upgrade without --check to install them.',
        '',
      ].join('\n'),
    );
    assert.deepEqual(tarballRequests(registry.requests.slice(asked)), []);
    assert.deepEqual(await tree(pluginsDir), before);
    assert.equal(await installedVersion(pluginsDir, LLM), '1.0.0');

    const named = await geekity('upgrade', LLM);
    assert.equal(named.code, 0, named.stderr);
    assert.equal(named.stdout, [`${LLM}: upgraded from 1.0.0 to 1.1.0.`, RELOAD, ''].join('\n'));
    assert.equal(await installedVersion(pluginsDir, LLM), '1.1.0');
    assert.equal(await installedVersion(pluginsDir, TAGS), '1.0.0');

    const absent = await geekity('upgrade', '@acme/plugin-nowhere');
    assert.equal(absent.code, 0, absent.stderr);
    assert.match(absent.stdout, /@acme\/plugin-nowhere: skipped: it is not in the plugins folder/);
  });

  it('skips a plugin the registry does not have, and every plugin when it cannot be reached', async () => {
    const { pluginsDir, geekity, offline } = await setup([
      release(LLM, '1.0.0'),
      release(LLM, '1.1.0'),
    ]);
    await geekity('add', `${LLM}@1.0.0`);
    const handmade = path.join(pluginsDir, '@acme', 'plugin-handmade');
    await fs.mkdir(handmade, { recursive: true });
    const files = pluginFiles({ name: '@acme/plugin-handmade', version: '0.1.0' });
    await fs.writeFile(path.join(handmade, 'index.js'), files['dist/bundle/index.js'] ?? '');
    await fs.writeFile(path.join(handmade, 'plugin.json'), files['dist/bundle/plugin.json'] ?? '');

    const result = await geekity('upgrade');
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      result.stdout,
      /@acme\/plugin-handmade: skipped: @acme\/plugin-handmade is not on the registry at http:\/\/127\.0\.0\.1:\d+\./,
    );
    assert.match(result.stdout, /@acme\/plugin-llm: upgraded from 1\.0\.0 to 1\.1\.0\./);

    const unreachable = await offline('upgrade');
    assert.equal(unreachable.code, 0, unreachable.stderr);
    assert.match(
      unreachable.stdout,
      /@acme\/plugin-handmade: skipped: The registry at http:\/\/127\.0\.0\.1:9 could not be reached/,
    );
    assert.match(
      unreachable.stdout,
      /@acme\/plugin-llm: skipped: The registry at http:\/\/127\.0\.0\.1:9 could not be reached/,
    );
    assert.doesNotMatch(unreachable.stdout, /Reload/);
  });

  it('exits non-zero when an install it attempted failed, after upgrading the others', async () => {
    const { pluginsDir, geekity } = await setup([
      release(LLM, '1.0.0'),
      release(TAGS, '1.0.0'),
      release(LLM, '1.1.0', { integrity: `sha512-${Buffer.alloc(64).toString('base64')}` }),
      release(TAGS, '1.1.0'),
    ]);
    await geekity('add', `${LLM}@1.0.0`);
    await geekity('add', `${TAGS}@1.0.0`);

    const result = await geekity('upgrade');
    assert.equal(result.code, 1);
    assert.match(
      result.stdout,
      /@acme\/plugin-llm: upgrading from 1\.0\.0 to 1\.1\.0 failed: .*integrity/,
    );
    assert.match(result.stdout, /@acme\/plugin-tags: upgraded from 1\.0\.0 to 1\.1\.0\./);
    assert.match(result.stdout, new RegExp(RELOAD.replace(/\./g, '\\.')));
    assert.equal(await installedVersion(pluginsDir, LLM), '1.0.0');
    assert.equal(await installedVersion(pluginsDir, TAGS), '1.1.0');
  });

  describe('plugins that require each other', () => {
    const packages = [
      release(LLM, '1.0.0'),
      release(SUMMARY, '1.0.0', { requires: { [LLM]: '>=1.0.0 <2.0.0' } }),
      release(LLM, '2.0.0'),
      release(SUMMARY, '2.0.0', { requires: { [LLM]: '>=2.0.0 <3.0.0' } }),
    ];

    async function installedPair() {
      const site = await setup(packages);
      await site.geekity('add', `${LLM}@1.0.0`);
      await site.geekity('add', `${SUMMARY}@1.0.0`);
      return site;
    }

    it('moves a consumer and the plugin it requires together, the required one first', async () => {
      const { pluginsDir, registry, geekity } = await installedPair();
      const asked = registry.requests.length;

      const result = await geekity('upgrade');
      assert.equal(result.code, 0, result.stderr);
      assert.equal(
        result.stdout,
        [
          `${LLM}: upgraded from 1.0.0 to 2.0.0.`,
          `${SUMMARY}: upgraded from 1.0.0 to 2.0.0.`,
          RELOAD,
          '',
        ].join('\n'),
      );
      assert.deepEqual(tarballRequests(registry.requests.slice(asked)), [
        `/tarballs/${LLM}-2.0.0.tgz`,
        `/tarballs/${SUMMARY}-2.0.0.tgz`,
      ]);
      assert.equal(await installedVersion(pluginsDir, LLM), '2.0.0');
      assert.equal(await installedVersion(pluginsDir, SUMMARY), '2.0.0');
    });

    it('holds one back, saying why, rather than leave the other unsatisfied', async () => {
      const { pluginsDir, geekity } = await installedPair();

      const provider = await geekity('upgrade', LLM);
      assert.equal(provider.code, 0, provider.stderr);
      assert.equal(
        provider.stdout,
        `${LLM}: held back at 1.0.0: ${SUMMARY} 1.0.0 requires ${LLM} >=1.0.0 <2.0.0.\n`,
      );

      const consumer = await geekity('upgrade', SUMMARY);
      assert.equal(consumer.code, 0, consumer.stderr);
      assert.equal(
        consumer.stdout,
        `${SUMMARY}: held back at 1.0.0: 2.0.0 requires ${LLM} >=2.0.0 <3.0.0, and ${LLM} is at 1.0.0.\n`,
      );
      assert.equal(await installedVersion(pluginsDir, LLM), '1.0.0');
      assert.equal(await installedVersion(pluginsDir, SUMMARY), '1.0.0');
    });

    it('holds back a required plugin that is too new, and still upgrades the plugin requiring it', async () => {
      const { pluginsDir, geekity } = await setup([
        release(LLM, '1.0.0'),
        release(SUMMARY, '1.0.0', { requires: { [LLM]: '>=1.0.0 <2.0.0' } }),
        release(LLM, '2.0.0'),
        release(SUMMARY, '1.1.0', { requires: { [LLM]: '>=1.0.0 <2.0.0' } }),
      ]);
      await geekity('add', `${LLM}@1.0.0`);
      await geekity('add', `${SUMMARY}@1.0.0`);

      const result = await geekity('upgrade');
      assert.equal(result.code, 0, result.stderr);
      assert.equal(
        result.stdout,
        [
          `${LLM}: held back at 1.0.0: ${SUMMARY} 1.1.0 requires ${LLM} >=1.0.0 <2.0.0.`,
          `${SUMMARY}: upgraded from 1.0.0 to 1.1.0.`,
          RELOAD,
          '',
        ].join('\n'),
      );
      assert.equal(await installedVersion(pluginsDir, SUMMARY), '1.1.0');
    });

    it('holds back a plugin whose required plugin failed to upgrade', async () => {
      const { pluginsDir, geekity } = await setup([
        release(LLM, '1.0.0'),
        release(SUMMARY, '1.0.0', { requires: { [LLM]: '>=1.0.0 <2.0.0' } }),
        release(LLM, '2.0.0', { integrity: `sha512-${Buffer.alloc(64).toString('base64')}` }),
        release(SUMMARY, '2.0.0', { requires: { [LLM]: '>=2.0.0 <3.0.0' } }),
      ]);
      await geekity('add', `${LLM}@1.0.0`);
      await geekity('add', `${SUMMARY}@1.0.0`);

      const result = await geekity('upgrade');
      assert.equal(result.code, 1);
      assert.match(result.stdout, /^@acme\/plugin-llm: upgrading from 1\.0\.0 to 2\.0\.0 failed: /);
      assert.ok(
        result.stdout.includes(
          `${SUMMARY}: held back at 1.0.0: 2.0.0 requires ${LLM} >=2.0.0 <3.0.0, and upgrading ${LLM} failed.\n`,
        ),
        result.stdout,
      );
      assert.doesNotMatch(result.stdout, /Reload/);
      assert.equal(await installedVersion(pluginsDir, SUMMARY), '1.0.0');
    });

    it('names a requirement left unmet once the run is over', async () => {
      const { geekity } = await setup(packages);
      await geekity('add', `${SUMMARY}@1.0.0`);

      const result = await geekity('upgrade');
      assert.equal(result.code, 0, result.stderr);
      assert.equal(
        result.stdout,
        [
          `${SUMMARY}: held back at 1.0.0: 2.0.0 requires ${LLM} >=2.0.0 <3.0.0, which is not installed.`,
          `${SUMMARY}: It requires ${LLM} >=1.0.0 <2.0.0, which is not installed. Add it with: geekity plugin add ${LLM}`,
          '',
        ].join('\n'),
      );
    });
  });
});
