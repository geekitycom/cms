import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveConfig } from '../config.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PluginSettingField, PluginSettings } from '../plugin.ts';
import { pluginEnvPrefix, settingVariable } from '../settings/names.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { createSettings } from '../site/namespace.ts';
import { createPluginRegistry } from './registry.ts';
import type { PluginRegistry } from './registry.ts';

const ROOT = mkdtempSync(path.join(tmpdir(), 'geekity-plugin-settings-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

const NAME = '@acme/plugin-llm';
const FIELDS = [
  { type: 'url', key: 'base_url', label: 'Base URL', default: 'https://llm.example/v1' },
  { type: 'secret', key: 'api_key', label: 'API key' },
  { type: 'text', key: 'model', label: 'Model', default: 'small' },
  {
    type: 'select',
    key: 'tone',
    label: 'Tone',
    default: 'plain',
    options: [
      { value: 'plain', label: 'Plain' },
      { value: 'warm', label: 'Warm' },
    ],
  },
  { type: 'checkbox', key: 'verbose', label: 'Verbose' },
] as const;

let sites = 0;

function withSettings(
  name: string,
  fields: readonly PluginSettingField[],
  registered: (settings: PluginSettings<readonly PluginSettingField[]>) => void = () => {},
): Plugin {
  return definePlugin({
    name,
    version: '1.0.0',
    label: name,
    description: 'Has settings.',
    hostApi: HOST_API_VERSION,
    register(host) {
      registered(host.settings(fields));
    },
  });
}

function siteWith(
  plugins: readonly Plugin[],
  options: {
    siteJson?: unknown;
    files?: Record<string, unknown>;
    env?: Record<string, string>;
  } = {},
): { settings: SettingsRegistry; registry: PluginRegistry; folder: string } {
  sites += 1;
  const contentDir = path.join(ROOT, `content-${String(sites)}`);
  const dataDir = path.join(ROOT, `data-${String(sites)}`);
  mkdirSync(path.join(contentDir, '_data'), { recursive: true });
  if (options.siteJson !== undefined) {
    writeFileSync(path.join(contentDir, '_data', 'site.json'), JSON.stringify(options.siteJson));
  }
  const folder = path.join(dataDir, 'plugins', '@acme', 'plugin-llm');
  for (const [file, contents] of Object.entries(options.files ?? {})) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, file), JSON.stringify(contents));
  }
  const env = options.env ?? {};
  const settings = createSettings({
    config: resolveConfig({ contentDir, dataDir }, { env, cwd: ROOT }),
    env,
  });
  const registry = createPluginRegistry(
    plugins.map((plugin) => ({ source: 'test', plugin })),
    {
      dataDir,
      contentDir,
      settings,
      siteInfo: () => Promise.resolve({ baseUrl: 'https://example.test/', title: 'Example' }),
      allowPrivateAddress: false,
      lookup: () => Promise.reject(new Error('a test resolves no names')),
    },
  );
  return { settings, registry, folder };
}

function site(options: Parameters<typeof siteWith>[1] = {}) {
  let reader: PluginSettings<typeof FIELDS> | undefined;
  const built = siteWith(
    [
      withSettings(NAME, FIELDS, (settings) => {
        reader = settings as unknown as PluginSettings<typeof FIELDS>;
      }),
    ],
    options,
  );
  assert.ok(reader !== undefined);
  return { ...built, reader };
}

describe('plugin environment variables', () => {
  it('upper-case the package name and the key, each run of other characters one underscore', () => {
    assert.equal(pluginEnvPrefix('@geekity/plugin-llm'), 'GEEKITY_PLUGIN_LLM');
    assert.equal(
      settingVariable(pluginEnvPrefix('@geekity/plugin-llm'), 'api_key'),
      'GEEKITY_PLUGIN_LLM__API_KEY',
    );
    assert.equal(
      settingVariable(pluginEnvPrefix('@acme/plugin-llm'), 'api_key'),
      'ACME_PLUGIN_LLM__API_KEY',
    );
    assert.equal(pluginEnvPrefix('@a/b-c'), pluginEnvPrefix('@a-b/c'));
    assert.equal(pluginEnvPrefix('my__odd..plugin'), 'MY_ODD_PLUGIN');
  });
});

describe('plugin settings', () => {
  it('registers a namespace named by the package, with one setting per field', () => {
    const { settings } = site();
    assert.deepEqual(
      settings
        .list()
        .filter((ref) => ref.namespace === NAME)
        .map((ref) => [ref.key, ref.declaration.secret === true]),
      [
        ['base_url', false],
        ['api_key', true],
        ['model', false],
        ['tone', false],
        ['verbose', false],
      ],
    );
  });

  it('hands the plugin typed values through a Promise, each field its default when nothing is stored', async () => {
    const { reader } = site();
    const pending = reader.current();
    assert.ok(pending instanceof Promise);
    const values = await pending;
    const baseUrl: string = values.base_url;
    const apiKey: string | undefined = values.api_key;
    const tone: 'plain' | 'warm' = values.tone;
    const verbose: boolean = values.verbose;
    assert.deepEqual(
      { baseUrl, apiKey, model: values.model, tone, verbose },
      {
        baseUrl: 'https://llm.example/v1',
        apiKey: undefined,
        model: 'small',
        tone: 'plain',
        verbose: false,
      },
    );
  });

  it('reads public values from settings.json and secrets from secrets.json, per call, never from site.json', async () => {
    const { reader, folder } = site({
      siteJson: { plugins: { [NAME]: { enabled: true, model: 'from-site-json' } } },
      files: {
        'settings.json': { base_url: 'http://127.0.0.1:9/v1', tone: 'warm', verbose: true },
        'secrets.json': { api_key: 'sk-file' },
      },
    });
    assert.deepEqual(await reader.current(), {
      base_url: 'http://127.0.0.1:9/v1',
      api_key: 'sk-file',
      model: 'small',
      tone: 'warm',
      verbose: true,
    });

    writeFileSync(path.join(folder, 'secrets.json'), JSON.stringify({ api_key: 'sk-changed' }));
    assert.equal((await reader.current()).api_key, 'sk-changed', 'read again on the next call');
  });

  it('falls back to the default for an invalid stored value and says why, naming the file', async () => {
    const { reader, settings } = site({
      files: { 'settings.json': { base_url: 'not a url', tone: 'shouty', verbose: 'yes' } },
    });
    const values = await reader.current();
    assert.equal(values.base_url, 'https://llm.example/v1');
    assert.equal(values.tone, 'plain');
    assert.equal(values.verbose, false);

    for (const ref of settings.list().filter((each) => each.namespace === NAME)) {
      const { problem } = await settings.resolve(ref);
      if (['base_url', 'tone', 'verbose'].includes(ref.key)) {
        assert.match(problem ?? '', /in plugins\/@acme\/plugin-llm\/settings\.json/, ref.key);
      } else {
        assert.equal(problem, undefined, `${ref.key} is missing, which is no problem`);
      }
    }
  });

  it('lets the variable named by the package win over the file, for a secret and a public setting', async () => {
    const { reader, settings } = site({
      files: { 'settings.json': { model: 'big' }, 'secrets.json': { api_key: 'sk-file' } },
      env: { ACME_PLUGIN_LLM__API_KEY: 'sk-env', ACME_PLUGIN_LLM__MODEL: 'from-env' },
    });
    const values = await reader.current();
    assert.equal(values.api_key, 'sk-env');
    assert.equal(values.model, 'from-env');
    const model = settings.list().find((ref) => ref.namespace === NAME && ref.key === 'model');
    assert.ok(model !== undefined);
    assert.deepEqual((await settings.resolve(model)).source, {
      tier: 'env',
      variable: 'ACME_PLUGIN_LLM__MODEL',
    });
  });

  it('reads GEEKITY_PLUGIN_LLM__API_KEY for @geekity/plugin-llm', async () => {
    let reader: PluginSettings<readonly PluginSettingField[]> | undefined;
    siteWith(
      [
        withSettings(
          '@geekity/plugin-llm',
          [{ type: 'secret', key: 'api_key', label: 'Key' }],
          (s) => {
            reader = s;
          },
        ),
      ],
      { env: { GEEKITY_PLUGIN_LLM__API_KEY: 'sk-geekity' } },
    );
    assert.ok(reader !== undefined);
    assert.deepEqual(await reader.current(), { api_key: 'sk-geekity' });
  });
});

describe('a plugin whose settings namespace cannot be registered', () => {
  it('does not load a plugin named by a reserved namespace or prefix, and registers no namespace for it', () => {
    let registered = 0;
    const count = () => {
      registered += 1;
    };
    const fields = [{ type: 'text', key: 'note', label: 'Note' }] as const;
    const { registry, settings } = siteWith([
      withSettings('site', fields, count),
      withSettings('@geekity/maintenance', fields, count),
    ]);
    assert.equal(registered, 0, 'neither register ran');
    assert.match(registry.problem('site') ?? '', /namespace site is reserved for core/);
    assert.match(
      registry.problem('@geekity/maintenance') ?? '',
      /GEEKITY_MAINTENANCE__, as core's maintenance settings do/,
    );
    assert.deepEqual(
      settings.list().filter((ref) => ref.key === 'note'),
      [],
    );
  });

  it('loads neither of two packages whose variables would share a prefix', () => {
    let registered = 0;
    const fields = [{ type: 'text', key: 'note', label: 'Note' }] as const;
    const { registry, settings } = siteWith([
      withSettings('@a/b-c', fields, () => (registered += 1)),
      withSettings('@a-b/c', fields, () => (registered += 1)),
    ]);
    assert.equal(registered, 0);
    assert.match(registry.problem('@a/b-c') ?? '', /would start A_B_C__, as those of @a-b\/c/);
    assert.match(registry.problem('@a-b/c') ?? '', /would start A_B_C__, as those of @a\/b-c/);
    assert.deepEqual(
      settings.list().filter((ref) => ref.key === 'note'),
      [],
    );
  });
});
