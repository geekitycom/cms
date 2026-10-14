import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveConfig } from '../config.ts';
import type { GeekityConfig } from '../config.ts';
import { declareNamespace } from './declare.ts';
import { DEV_MODE, readDevModeRecord } from './dev-mode.ts';
import { boolean, port } from './kinds.ts';
import { MAINTENANCE } from './maintenance.ts';
import { CORE_NAMESPACES, coreEnvPrefix, pluginEnvPrefix } from './names.ts';
import { createSettingsRegistry } from './registry.ts';
import type { NamespaceDeclaration, SettingType } from './types.ts';
import { isRecord } from '../util/guards.ts';

const dirs: string[] = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const NOW = new Date('2026-10-13T10:00:00Z');

async function site(
  config: GeekityConfig = {},
  env: Record<string, string> = {},
): Promise<{ registry: ReturnType<typeof createSettingsRegistry>; dataDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'geekity-settings-'));
  dirs.push(root);
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir);
  const resolved = resolveConfig(
    { contentDir: path.join(root, 'content'), dataDir, now: () => NOW, ...config },
    { env, cwd: root },
  );
  return { registry: createSettingsRegistry({ config: resolved, env }), dataDir };
}

const changes = (entries: Record<string, unknown>) => new Map(Object.entries(entries));

async function fileOf(dataDir: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));
}

describe('the settings registry', () => {
  it('resolves env, then the config override, then the file, then the default, naming the source', async () => {
    const plain = await site();
    assert.deepEqual(await plain.registry.resolve(MAINTENANCE.on), {
      value: false,
      source: { tier: 'default' },
      stored: undefined,
      problem: undefined,
    });

    assert.deepEqual(await plain.registry.set('maintenance', changes({ on: true }), 'cli'), {
      ok: true,
    });
    assert.deepEqual(await plain.registry.resolve(MAINTENANCE.on), {
      value: true,
      source: { tier: 'file' },
      stored: true,
      problem: undefined,
    });

    const configured = await site({ maintenance: true });
    const fromConfig = await configured.registry.resolve(MAINTENANCE.on);
    assert.deepEqual(fromConfig.source, { tier: 'config', field: 'maintenance' });
    assert.equal(fromConfig.value, true);

    const fromOldVariable = await site({}, { GEEKITY_MAINTENANCE: 'on' });
    assert.deepEqual((await fromOldVariable.registry.resolve(MAINTENANCE.on)).source, {
      tier: 'env',
      variable: 'GEEKITY_MAINTENANCE',
    });

    const generic = await site(
      { maintenance: true },
      { GEEKITY_MAINTENANCE__UNTIL: '2026-10-14T09:00:00Z' },
    );
    assert.deepEqual(await generic.registry.resolve(MAINTENANCE.until), {
      value: '2026-10-14T09:00:00.000Z',
      source: { tier: 'env', variable: 'GEEKITY_MAINTENANCE__UNTIL' },
      stored: undefined,
      problem: undefined,
    });
  });

  it('keeps the stored value beside an override, and reads every value of a namespace', async () => {
    const { registry, dataDir } = await site({ maintenance: true });
    await writeFile(
      path.join(dataDir, 'maintenance.json'),
      JSON.stringify({ on: false, until: '2026-10-14T09:00:00.000Z' }),
    );

    const on = await registry.resolve(MAINTENANCE.on);
    assert.equal(on.value, true);
    assert.equal(on.stored, false);
    assert.deepEqual(await registry.values(MAINTENANCE), {
      on: true,
      until: '2026-10-14T09:00:00.000Z',
    });
  });

  it('gives dev_mode.on no generic variable', async () => {
    const { registry } = await site({}, { GEEKITY_DEV_MODE__ON: 'true' });
    assert.deepEqual((await registry.resolve(DEV_MODE.on)).source, { tier: 'default' });
  });

  it('sets a stored value that does not parse aside for the default, saying why', async () => {
    const { registry, dataDir } = await site();
    await writeFile(path.join(dataDir, 'maintenance.json'), JSON.stringify({ on: 'yes please' }));
    const on = await registry.resolve(MAINTENANCE.on);
    assert.equal(on.value, false);
    assert.equal(on.source.tier, 'default');
    assert.match(on.problem ?? '', /true or false/);
  });

  it('reads a file the previous CLI wrote as on, and stores the new shape on the next write', async () => {
    const { registry, dataDir } = await site();
    await writeFile(
      path.join(dataDir, 'maintenance.json'),
      JSON.stringify({ until: '2026-09-28T14:00:00.000Z' }),
    );
    await writeFile(
      path.join(dataDir, 'dev-mode.json'),
      JSON.stringify({ since: NOW.toISOString(), by: 'command' }),
    );

    assert.deepEqual(await registry.values(MAINTENANCE), {
      on: true,
      until: '2026-09-28T14:00:00.000Z',
    });
    assert.equal(await registry.get(DEV_MODE.on), true);

    await registry.set('maintenance', changes({ until: '' }), 'cli');
    assert.deepEqual(await fileOf(dataDir, 'maintenance.json'), { on: true, until: '' });

    await writeFile(path.join(dataDir, 'maintenance.json'), 'not json');
    assert.equal(
      await registry.get(MAINTENANCE.on),
      true,
      'a file that is there but unreadable still means on',
    );
    await registry.set('maintenance', changes({ on: true }), 'cli');
    assert.deepEqual(await fileOf(dataDir, 'maintenance.json'), { on: true, until: '' });
  });

  it('writes maintenance whole, so its own file is never read as a presence-means-on file', async () => {
    const { registry, dataDir } = await site();

    await registry.set('maintenance', changes({ until: '2026-10-14T09:00:00Z' }), 'cli');

    assert.deepEqual(await fileOf(dataDir, 'maintenance.json'), {
      until: '2026-10-14T09:00:00.000Z',
      on: false,
    });
    assert.equal(await registry.get(MAINTENANCE.on), false);
    await registry.set('maintenance', changes({ on: undefined }), 'cli');
    assert.equal(await registry.get(MAINTENANCE.on), false);
  });

  it('rewrites each maintenance key a set does not name as the value it reads, an unreadable one as the default', async () => {
    const { registry, dataDir } = await site();
    const file = path.join(dataDir, 'maintenance.json');

    await writeFile(file, JSON.stringify({ on: true, until: '2026-10-14T09:00:00Z' }));
    await registry.set('maintenance', changes({ on: true }), 'cli');
    assert.deepEqual(await fileOf(dataDir, 'maintenance.json'), {
      on: true,
      until: '2026-10-14T09:00:00.000Z',
    });

    await writeFile(file, JSON.stringify({ on: 'yes', until: '' }));
    assert.equal(await registry.get(MAINTENANCE.on), false, 'an unreadable on reads as off');
    await registry.set('maintenance', changes({ until: '2026-10-14T09:00:00Z' }), 'cli');
    assert.deepEqual(await fileOf(dataDir, 'maintenance.json'), {
      on: false,
      until: '2026-10-14T09:00:00.000Z',
    });
    assert.equal(await registry.get(MAINTENANCE.on), false, 'and still reads as off');
  });

  it('refuses a key an override is in effect for, naming the source, and writes nothing for the whole call', async () => {
    const { registry, dataDir } = await site({}, { GEEKITY_MAINTENANCE: 'true' });

    const result = await registry.set(
      'maintenance',
      changes({ on: false, until: '2026-10-14T09:00:00Z' }),
      'admin',
    );

    assert.deepEqual(result, {
      ok: false,
      problems: { on: 'maintenance.on is set by GEEKITY_MAINTENANCE and cannot be changed here.' },
    });
    await assert.rejects(stat(path.join(dataDir, 'maintenance.json')), { code: 'ENOENT' });
  });

  it('refuses a value that does not parse and a key the namespace does not declare', async () => {
    const { registry, dataDir } = await site();

    const result = await registry.set(
      'maintenance',
      changes({ on: true, until: 'soonish', sideways: 1 }),
      'cli',
    );

    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.ok ? {} : result.problems).sort(), ['sideways', 'until']);
    await assert.rejects(stat(path.join(dataDir, 'maintenance.json')), { code: 'ENOENT' });
  });

  it('removes a key given as undefined, so the default applies, and keeps keys it does not declare', async () => {
    const { registry, dataDir } = await site();
    const plain = declareNamespace({
      namespace: 'plain',
      storage: {
        kind: 'file',
        under: 'data',
        path: 'plain.json',
        dataClass: { kept: true, secret: false },
      },
      envPrefix: 'PLAIN',
      settings: { on: { type: boolean, default: false, description: 'A switch.' } },
    });
    registry.register(plain.declaration);
    await writeFile(path.join(dataDir, 'plain.json'), JSON.stringify({ on: true, theirs: 1 }));

    await registry.set('plain', changes({ on: undefined }), 'cli');

    assert.deepEqual(await fileOf(dataDir, 'plain.json'), { theirs: 1 });
    assert.equal(await registry.get(plain.on), false);
  });

  it('reads and writes a setting under its file key, and one value under several file keys', async () => {
    const { registry, dataDir } = await site();
    const spelled = declareNamespace({
      namespace: 'spelled',
      storage: {
        kind: 'file',
        under: 'data',
        path: 'spelled.json',
        dataClass: { kept: true, secret: false },
      },
      envPrefix: 'SPELLED',
      settings: {
        posts_per_page: {
          fileKey: 'postsPerPage',
          type: port,
          default: 10,
          description: 'A count.',
        },
        pair: {
          fileKeys: ['first', 'second'],
          type: {
            fromJson: (raw) =>
              isRecord(raw) && typeof raw['first'] === 'string'
                ? {
                    ok: true,
                    value: `${raw['first']}/${typeof raw['second'] === 'string' ? raw['second'] : ''}`,
                  }
                : { ok: false, problem: 'needs a first' },
            fromText: (text) => ({ ok: true, value: text }),
            toJson: (value) => {
              const [first, second] = value.split('/');
              return { first, second: second === '' ? undefined : second };
            },
            toText: (value) => value,
          } satisfies SettingType<string>,
          default: '',
          description: 'Two keys, one value.',
        },
      },
    });
    registry.register(spelled.declaration);
    await writeFile(
      path.join(dataDir, 'spelled.json'),
      JSON.stringify({ postsPerPage: 7, posts_per_page: 99, first: 'a', second: 'b', theirs: 1 }),
    );

    assert.deepEqual(await registry.values(spelled), { posts_per_page: 7, pair: 'a/b' });

    assert.deepEqual(
      await registry.set('spelled', changes({ posts_per_page: 8, pair: { first: 'c' } }), 'cli'),
      { ok: true },
    );
    assert.deepEqual(await fileOf(dataDir, 'spelled.json'), {
      postsPerPage: 8,
      posts_per_page: 99,
      first: 'c',
      theirs: 1,
    });
    assert.deepEqual(await registry.values(spelled), { posts_per_page: 8, pair: 'c/' });

    await registry.set('spelled', changes({ posts_per_page: undefined, pair: undefined }), 'cli');
    assert.deepEqual(await fileOf(dataDir, 'spelled.json'), { posts_per_page: 99, theirs: 1 });
  });

  it('answers a read after a write it did not wait for with what was written', async () => {
    const { registry } = await site();
    const written = registry.set('dev_mode', changes({ on: true }), 'boot');
    assert.equal(await registry.get(DEV_MODE.on), true);
    await written;
  });

  it('records dev mode going on and off, with who did it, and nothing when it did not change', async () => {
    const { registry, dataDir } = await site();

    await registry.set('dev_mode', changes({ on: true }), 'boot');
    await registry.set('dev_mode', changes({ on: true }), 'cli');
    await registry.set('dev_mode', changes({ on: false }), 'admin');
    await registry.set('dev_mode', changes({ on: true }), 'cli');
    await registry.set('dev_mode', changes({ on: false }), 'cli');

    assert.deepEqual(readDevModeRecord(dataDir), [
      { type: 'on', at: NOW.toISOString(), by: 'config' },
      { type: 'off', at: NOW.toISOString(), by: 'admin' },
      { type: 'on', at: NOW.toISOString(), by: 'command' },
      { type: 'off', at: NOW.toISOString(), by: 'command' },
    ]);
  });

  it('logs a change hook that throws and keeps the write', async () => {
    const { registry, dataDir } = await site();
    const failing = declareNamespace({
      namespace: 'failing',
      storage: { kind: 'file', under: 'data', path: 'failing.json', dataClass: { kept: false } },
      envPrefix: 'FAILING',
      settings: {
        on: {
          type: boolean,
          default: false,
          description: 'Fails.',
          onChange: () => {
            throw new Error('the hook broke');
          },
        },
      },
    });
    registry.register(failing.declaration);
    const logged: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => logged.push(args.join(' '));
    try {
      assert.deepEqual(await registry.set('failing', changes({ on: true }), 'plugin'), {
        ok: true,
      });
    } finally {
      console.error = error;
    }
    assert.deepEqual(await fileOf(dataDir, 'failing.json'), { on: true });
    assert.match(String(logged[0]), /failing\.on.*the hook broke/);
  });

  it('hands a change hook the registry, so it can set a second setting', async () => {
    const { registry, dataDir } = await site();
    const paired = declareNamespace({
      namespace: 'paired',
      storage: { kind: 'file', under: 'data', path: 'paired.json', dataClass: { kept: false } },
      envPrefix: 'PAIRED',
      settings: {
        on: {
          type: boolean,
          default: false,
          description: 'Turns the other on.',
          onChange: async ({ next, settings }) => {
            if (next) await settings.set('paired', changes({ other: true }), 'plugin');
          },
        },
        other: { type: boolean, default: false, description: 'Follows on.' },
      },
    });
    registry.register(paired.declaration);
    await registry.set('paired', changes({ on: true }), 'admin');
    assert.deepEqual(await fileOf(dataDir, 'paired.json'), { on: true, other: true });
  });

  it('runs a watcher of one setting when it changes, and not after it stops watching', async () => {
    const { registry } = await site();
    const seen: [unknown, unknown][] = [];
    const unwatch = registry.watch(MAINTENANCE.on, ({ previous, next }) => {
      seen.push([previous, next]);
    });
    await registry.set('maintenance', changes({ on: true }), 'cli');
    await registry.set('maintenance', changes({ until: '2026-10-14T09:00:00.000Z' }), 'cli');
    unwatch();
    await registry.set('maintenance', changes({ on: false }), 'cli');
    assert.deepEqual(seen, [[false, true]]);
  });
});

describe('registering a plugin namespace', () => {
  const pluginNamespace = (
    namespace: string,
    envPrefix = pluginEnvPrefix(namespace),
  ): NamespaceDeclaration =>
    declareNamespace({
      namespace,
      storage: {
        kind: 'file',
        under: 'data',
        path: `plugins/${namespace}/settings.json`,
        dataClass: { kept: true, secret: true },
      },
      envPrefix,
      settings: {
        api_key: { type: boolean, default: false, description: 'A key.', secret: true },
      },
    }).declaration;

  it('refuses a reserved core namespace, naming it', async () => {
    const { registry } = await site();
    assert.throws(() => registry.register(pluginNamespace('site')), /namespace site is reserved/);
  });

  it('refuses a plugin whose prefix is GEEKITY or a core one, naming the clash', async () => {
    const { registry } = await site();
    assert.throws(
      () => registry.register(pluginNamespace('@geekity/maintenance')),
      /GEEKITY_MAINTENANCE__, as core's maintenance settings do/,
    );
    assert.throws(() => registry.register(pluginNamespace('geekity')), /GEEKITY__/);
  });

  it('refuses a namespace that is already registered', async () => {
    const { registry } = await site();
    registry.register(pluginNamespace('@acme/plugin-llm'));
    assert.throws(
      () => registry.register(pluginNamespace('@acme/plugin-llm')),
      /already registered/,
    );
  });

  it('lists core settings first, then the plugin, until it is unregistered', async () => {
    const { registry } = await site();
    registry.register(pluginNamespace('@acme/plugin-llm'));

    const named = () => registry.list().map((ref) => `${ref.namespace}.${ref.key}`);
    const core = [
      'maintenance.on',
      'maintenance.until',
      'dev_mode.on',
      'mail.brevo_api_key',
      'mail.smtp_host',
      'mail.smtp_port',
      'mail.smtp_secure',
      'mail.smtp_user',
      'mail.smtp_password',
      'akismet.key',
      'akismet.status',
      'akismet.checked_at',
    ];
    assert.deepEqual(named(), [...core, '@acme/plugin-llm.api_key']);
    registry.unregister('@acme/plugin-llm');
    assert.deepEqual(named(), core);
  });

  it('writes a secret namespace at mode 0600', async () => {
    const { registry, dataDir } = await site();
    registry.register(pluginNamespace('@acme/plugin-llm'));
    await registry.set('@acme/plugin-llm', changes({ api_key: true }), 'admin');
    const { mode } = await stat(path.join(dataDir, 'plugins/@acme/plugin-llm/settings.json'));
    assert.equal(mode & 0o777, 0o600);
  });

  it('never gives core a namespace a @geekity/plugin- package could clash with', () => {
    assert.deepEqual(
      CORE_NAMESPACES.filter((namespace) => coreEnvPrefix(namespace).startsWith('GEEKITY_PLUGIN')),
      [],
    );
  });
});
