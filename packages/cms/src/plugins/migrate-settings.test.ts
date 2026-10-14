import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { migratePluginSettings } from './migrate-settings.ts';

const ROOT = mkdtempSync(path.join(tmpdir(), 'geekity-migrate-plugin-settings-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

let sites = 0;

const SITE_JSON = {
  title: 'Kept',
  plugins: {
    '@geekity/plugin-llm': {
      enabled: true,
      base_url: 'https://openrouter.ai/api/v1',
      default_model: 'openai/gpt-4o-mini',
    },
    '@acme/plugin-gone': { model: 'removed but kept' },
    '@acme/plugin-plain': { enabled: false },
    'not a package!': { enabled: true, note: 'left alone' },
  },
};

function site(siteJson: unknown = SITE_JSON, files: Record<string, unknown> = {}) {
  sites += 1;
  const contentDir = path.join(ROOT, `content-${String(sites)}`);
  const dataDir = path.join(ROOT, `data-${String(sites)}`);
  mkdirSync(path.join(contentDir, '_data'), { recursive: true });
  const siteJsonFile = path.join(contentDir, '_data', 'site.json');
  writeFileSync(siteJsonFile, `${JSON.stringify(siteJson, null, 2)}\n`);
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(dataDir, 'plugins', name, 'settings.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(contents));
  }
  const read = (file: string) => readFileSync(file, 'utf8');
  const llmFile = path.join(dataDir, 'plugins', '@geekity', 'plugin-llm', 'settings.json');
  const goneFile = path.join(dataDir, 'plugins', '@acme', 'plugin-gone', 'settings.json');
  const snapshot = () => ({
    siteJson: read(siteJsonFile),
    llm: read(llmFile),
    gone: read(goneFile),
  });
  const logged: string[] = [];
  const migrate = () =>
    migratePluginSettings({ contentDir, dataDir, log: (line) => logged.push(line) });
  return { contentDir, dataDir, siteJsonFile, llmFile, migrate, snapshot, logged, read };
}

describe('migrating plugin settings out of site.json', () => {
  it('moves every key but enabled, for every plugin named, installed or not, and logs each', () => {
    const { migrate, snapshot, logged, dataDir } = site();
    assert.deepEqual(migrate(), ['@geekity/plugin-llm', '@acme/plugin-gone']);

    const after = snapshot();
    assert.deepEqual(JSON.parse(after.siteJson), {
      title: 'Kept',
      plugins: {
        '@geekity/plugin-llm': { enabled: true },
        '@acme/plugin-gone': {},
        '@acme/plugin-plain': { enabled: false },
        'not a package!': { enabled: true, note: 'left alone' },
      },
    });
    assert.deepEqual(JSON.parse(after.llm), {
      base_url: 'https://openrouter.ai/api/v1',
      default_model: 'openai/gpt-4o-mini',
    });
    assert.deepEqual(JSON.parse(after.gone), { model: 'removed but kept' });
    assert.deepEqual(logged, [
      'Moved the settings of @geekity/plugin-llm from content/_data/site.json to data/plugins/@geekity/plugin-llm/settings.json.',
      'Moved the settings of @acme/plugin-gone from content/_data/site.json to data/plugins/@acme/plugin-gone/settings.json.',
    ]);
    assert.throws(
      () => readFileSync(path.join(dataDir, 'plugins', '@acme', 'plugin-plain', 'settings.json')),
      /ENOENT/,
      'a plugin with only enabled gets no file',
    );
  });

  it('moves nothing the second time, and the files are byte for byte the same', () => {
    const { migrate, snapshot, logged } = site();
    migrate();
    const first = snapshot();
    assert.deepEqual(migrate(), []);
    assert.deepEqual(snapshot(), first);
    assert.equal(logged.length, 2, 'the second run logs nothing');
  });

  it('ends on the same files after a crash between its two writes', () => {
    const clean = site();
    clean.migrate();
    const expected = clean.snapshot();

    const crashed = site();
    const before = crashed.read(crashed.siteJsonFile);
    crashed.migrate();
    writeFileSync(crashed.siteJsonFile, before);
    crashed.migrate();
    assert.deepEqual(crashed.snapshot(), expected);
    crashed.migrate();
    assert.deepEqual(crashed.snapshot(), expected);
  });

  it('lets a value already in the plugin file win over the one site.json still holds', () => {
    const { migrate, llmFile, read } = site(SITE_JSON, {
      '@geekity/plugin-llm': { default_model: 'saved-later', extra: 1 },
    });
    migrate();
    assert.deepEqual(JSON.parse(read(llmFile)), {
      base_url: 'https://openrouter.ai/api/v1',
      default_model: 'saved-later',
      extra: 1,
    });
  });

  it('does nothing to a site.json with no plugins, or none at all', () => {
    const { migrate, siteJsonFile, read } = site({ title: 'Plain' });
    const before = read(siteJsonFile);
    assert.deepEqual(migrate(), []);
    assert.equal(read(siteJsonFile), before);

    const bare = site();
    rmSync(bare.siteJsonFile);
    assert.deepEqual(bare.migrate(), []);
  });
});
