/**
 * Plugin settings (decision-33, TASK-283): where each value is read from and
 * written to, and what a plugin is handed. Public values sit under the
 * plugin's key in `site.json`, secrets in its `secrets.json` at mode 0600, and
 * an environment variable named by the package wins over the file.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { PluginSettings } from '../plugin.ts';
import { createPluginRegistry } from './registry.ts';
import {
  pluginEnvPrefix,
  pluginVariable,
  resolvePluginSettings,
  savePluginSettings,
} from './settings.ts';

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

/** A fresh site with this plugin installed, and the reader its register got. */
function site(
  options: { siteJson?: unknown; secrets?: unknown; env?: Record<string, string> } = {},
) {
  sites += 1;
  const contentDir = path.join(ROOT, `content-${String(sites)}`);
  const dataDir = path.join(ROOT, `data-${String(sites)}`);
  mkdirSync(path.join(contentDir, '_data'), { recursive: true });
  if (options.siteJson !== undefined) {
    writeFileSync(path.join(contentDir, '_data', 'site.json'), JSON.stringify(options.siteJson));
  }
  const folder = path.join(dataDir, 'plugins', '@acme', 'plugin-llm');
  if (options.secrets !== undefined) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'secrets.json'), JSON.stringify(options.secrets));
  }
  const env = options.env ?? {};
  let reader: PluginSettings<typeof FIELDS> | undefined;
  createPluginRegistry(
    [
      {
        source: 'test',
        plugin: definePlugin({
          name: NAME,
          version: '1.0.0',
          label: 'LLM',
          description: 'Talks to a model.',
          hostApi: HOST_API_VERSION,
          register(host) {
            reader = host.settings(FIELDS);
          },
        }),
      },
    ],
    {
      dataDir,
      contentDir,
      env,
      siteInfo: () => ({ baseUrl: 'https://example.test/', title: 'Example' }),
    },
  );
  assert.ok(reader !== undefined);
  const settings = reader;
  const where = { contentDir, dataDir, env, name: NAME, fields: FIELDS };
  return {
    settings,
    where,
    siteJson: () =>
      JSON.parse(readFileSync(path.join(contentDir, '_data', 'site.json'), 'utf8')) as Record<
        string,
        unknown
      >,
    secretsFile: path.join(folder, 'secrets.json'),
  };
}

describe('plugin environment variables', () => {
  it('upper-case the package name and the key, each run of other characters one underscore', () => {
    assert.equal(pluginEnvPrefix('@geekity/plugin-llm'), 'GEEKITY_PLUGIN_LLM');
    assert.equal(pluginVariable('@geekity/plugin-llm', 'api_key'), 'GEEKITY_PLUGIN_LLM__API_KEY');
    assert.equal(pluginVariable('@acme/plugin-llm', 'api_key'), 'ACME_PLUGIN_LLM__API_KEY');
    assert.equal(pluginEnvPrefix('@a/b-c'), pluginEnvPrefix('@a-b/c'));
    assert.equal(pluginEnvPrefix('my__odd..plugin'), 'MY_ODD_PLUGIN');
  });
});

describe('plugin settings', () => {
  it('hands the plugin typed values, each field its default when nothing is stored', () => {
    const { settings } = site();
    const values = settings.current();
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

  it('reads public values from site.json and secrets from secrets.json, per call', () => {
    const { settings, secretsFile, where } = site({
      siteJson: {
        plugins: {
          [NAME]: { enabled: true, base_url: 'http://127.0.0.1:9/v1', tone: 'warm', verbose: true },
        },
      },
      secrets: { api_key: 'sk-file' },
    });
    assert.deepEqual(settings.current(), {
      base_url: 'http://127.0.0.1:9/v1',
      api_key: 'sk-file',
      model: 'small',
      tone: 'warm',
      verbose: true,
    });

    writeFileSync(secretsFile, JSON.stringify({ api_key: 'sk-changed' }));
    assert.equal(settings.current().api_key, 'sk-changed', 'read again on the next call');
    assert.equal(
      resolvePluginSettings(where).find((entry) => entry.field.key === 'api_key')?.source,
      'file',
    );
  });

  it('falls back to the default for an invalid stored value and says why', () => {
    const { settings, where } = site({
      siteJson: { plugins: { [NAME]: { base_url: 'not a url', tone: 'shouty', verbose: 'yes' } } },
    });
    const values = settings.current();
    assert.equal(values.base_url, 'https://llm.example/v1');
    assert.equal(values.tone, 'plain');
    assert.equal(values.verbose, false);

    const resolved = new Map(resolvePluginSettings(where).map((entry) => [entry.field.key, entry]));
    for (const key of ['base_url', 'tone', 'verbose']) {
      assert.match(resolved.get(key)?.problem ?? '', /default/, `${key} says the default is used`);
    }
    assert.equal(resolved.get('model')?.problem, undefined, 'a missing value is no problem');
  });

  it('lets an environment variable win over the file for a secret', () => {
    const { settings, where } = site({
      secrets: { api_key: 'sk-file' },
      env: { ACME_PLUGIN_LLM__API_KEY: 'sk-env' },
    });
    assert.equal(settings.current().api_key, 'sk-env');
    const key = resolvePluginSettings(where).find((entry) => entry.field.key === 'api_key');
    assert.equal(key?.source, 'environment');
    assert.equal(key.variable, 'ACME_PLUGIN_LLM__API_KEY');
  });
});

describe('saving plugin settings', () => {
  it('writes public values under plugins[<name>], keeping every key it does not model', async () => {
    const { where, siteJson, settings } = site({
      siteJson: { title: 'Kept', plugins: { [NAME]: { enabled: true, note: 'by hand' } } },
    });
    const result = await savePluginSettings({
      ...where,
      values: { base_url: 'https://openrouter.example/api/v1', model: 'big', tone: 'warm' },
      forget: new Set(),
    });
    assert.deepEqual(result.problems, {});

    const file = siteJson();
    assert.equal(file['title'], 'Kept');
    assert.deepEqual((file['plugins'] as Record<string, unknown>)[NAME], {
      enabled: true,
      note: 'by hand',
      base_url: 'https://openrouter.example/api/v1',
      model: 'big',
      tone: 'warm',
      verbose: false,
    });
    assert.equal(settings.current().model, 'big');
  });

  it('writes a secret to secrets.json at mode 0600 and never to site.json', async () => {
    const { where, siteJson, secretsFile, settings } = site({ siteJson: {} });
    await savePluginSettings({
      ...where,
      values: { api_key: 'sk-secret-123' },
      forget: new Set(),
    });
    assert.deepEqual(JSON.parse(readFileSync(secretsFile, 'utf8')), { api_key: 'sk-secret-123' });
    assert.equal(statSync(secretsFile).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(siteJson()), /sk-secret-123/);
    assert.equal(settings.current().api_key, 'sk-secret-123');
  });

  it('keeps the stored secret when the box is left blank, and forgets it when asked', async () => {
    const { where, settings } = site({ secrets: { api_key: 'sk-kept' } });
    await savePluginSettings({ ...where, values: { api_key: '', model: 'm' }, forget: new Set() });
    assert.equal(settings.current().api_key, 'sk-kept');

    await savePluginSettings({ ...where, values: {}, forget: new Set(['api_key']) });
    assert.equal(settings.current().api_key, undefined);
  });

  it('refuses an invalid value, naming the field, and writes nothing', async () => {
    const { where, settings } = site({ siteJson: {} });
    const result = await savePluginSettings({
      ...where,
      values: { base_url: 'ftp://nope', tone: 'shouty', model: 'changed' },
      forget: new Set(),
    });
    assert.match(result.problems['base_url'] ?? '', /URL/);
    assert.match(result.problems['tone'] ?? '', /Tone/);
    assert.equal(settings.current().model, 'small', 'nothing was written');
  });

  it('leaves a secret the environment sets alone', async () => {
    const { where, secretsFile } = site({ env: { ACME_PLUGIN_LLM__API_KEY: 'sk-env' } });
    await savePluginSettings({
      ...where,
      values: { api_key: 'sk-typed' },
      forget: new Set(['api_key']),
    });
    assert.throws(() => readFileSync(secretsFile), /ENOENT/);
  });
});
