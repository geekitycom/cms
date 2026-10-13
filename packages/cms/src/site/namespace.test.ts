import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { resolveConfig } from '../config.ts';
import type { SettingDeclaration } from '../settings/types.ts';
import { createSettings, SITE } from './namespace.ts';

const DEMO_SITE_JSON = fileURLToPath(
  new URL('../../../../apps/demo/content/_data/site.json', import.meta.url),
);

const FILE_KEYS = [
  'title',
  'tagline',
  'url',
  'timezone',
  'language',
  'locale',
  'postsPerPage',
  'homepage',
  'postsPage',
  'author',
  'theme',
  'icon',
  'license',
  'licenseName',
  'tagBase',
  'categoryBase',
  'comments',
  'commentsCloseAfterDays',
  'commentEmailRetentionDays',
  'addressHashRetentionDays',
  'contactMessageRetentionDays',
  'webmentionsSend',
  'webmentionsReceive',
  'notifyServer',
  'feedUpdatePeriod',
  'feedUpdateFrequency',
  'aiCrawlers',
  'contentSignalSearch',
  'contentSignalAiInput',
  'contentSignalAiTrain',
  'robotsRules',
  'llmsTxt',
  'indexNow',
  'indexNowKey',
  'mailProvider',
  'mailFromName',
  'mailFromAddress',
  'mailReplyTo',
  'contactEmail',
  'securityContacts',
  'securityPolicy',
  'securityLanguages',
  'relays',
  'menus',
  'taxonomyRedirects',
  'locationSharing',
  'clientsWithoutPkce',
  'avatar',
];

const dirs: string[] = [];
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function siteWith(
  file: Record<string, unknown>,
  config: { baseUrl?: string } = {},
): Promise<{ contentDir: string; file: string; settings: ReturnType<typeof createSettings> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'geekity-site-namespace-'));
  dirs.push(root);
  const contentDir = path.join(root, 'content');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  const siteJson = path.join(contentDir, '_data', 'site.json');
  await writeFile(siteJson, `${JSON.stringify(file, null, 2)}\n`);
  const resolved = resolveConfig(
    { contentDir, dataDir: path.join(root, 'data'), ...config },
    { env: {} },
  );
  return { contentDir, file: siteJson, settings: createSettings({ config: resolved, env: {} }) };
}

function fileKeysOf(declaration: SettingDeclaration<unknown>): readonly string[] {
  const { fileKey = declaration.key } = declaration;
  return typeof fileKey === 'string' ? [fileKey] : fileKey;
}

describe('the site namespace', () => {
  it('declares every key site.json holds a setting under, with a description', () => {
    const declared = SITE.declaration.settings.flatMap(fileKeysOf);
    assert.deepEqual([...declared].sort(), [...FILE_KEYS].sort());
    for (const declaration of SITE.declaration.settings) {
      assert.notEqual(declaration.description, '', `${declaration.key} is described`);
    }
  });

  it('reads the demo site.json as its values and writes them back as the same file', async () => {
    const demo = JSON.parse(await readFile(DEMO_SITE_JSON, 'utf8')) as Record<string, unknown>;
    const { settings, file } = await siteWith(demo);

    const values = (await settings.values(SITE)) as Readonly<Record<string, unknown>>;
    for (const declaration of SITE.declaration.settings) {
      const keys = fileKeysOf(declaration);
      if (keys.every((key) => demo[key] === undefined)) {
        assert.deepEqual(values[declaration.key], declaration.default, `${declaration.key}`);
        continue;
      }
      const json = declaration.type.toJson(values[declaration.key]);
      const written = typeof declaration.fileKey === 'object' ? json : { [keys[0] ?? '']: json };
      for (const key of keys) {
        assert.deepEqual((written as Record<string, unknown>)[key], demo[key], key);
      }
    }
    assert.equal(values['title'], 'Geekity Demo');
    assert.equal(values['posts_per_page'], 2);
    assert.equal(values['posts_page'], 'posts');

    const result = await settings.set('site', new Map([['title', 'Geekity Demo']]), 'admin');
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), demo);
  });

  it('keeps the keys it does not declare through a write', async () => {
    const { settings, file } = await siteWith({
      title: 'Before',
      feedSize: 20,
      plugins: { '@acme/plugin-x': { enabled: true } },
      shelf: { books: ['Dune'] },
    });

    const result = await settings.set('site', new Map([['title', 'After']]), 'admin');

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      title: 'After',
      feedSize: 20,
      plugins: { '@acme/plugin-x': { enabled: true } },
      shelf: { books: ['Dune'] },
    });
  });

  it('gives the base URL the config sets over the one in the file, and refuses to write it', async () => {
    const { settings } = await siteWith(
      { url: 'https://file.example' },
      { baseUrl: 'https://config.example' },
    );

    const resolved = await settings.resolve(SITE.base_url);
    assert.equal(resolved.value, 'https://config.example');
    assert.equal(resolved.stored, 'https://file.example');
    const refused = await settings.set(
      'site',
      new Map([['base_url', 'https://other.example']]),
      'admin',
    );
    assert.equal(refused.ok, false);
  });
});
