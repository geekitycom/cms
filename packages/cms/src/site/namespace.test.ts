import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { resolveConfig } from '../config.ts';
import type { SettingDeclaration } from '../settings/types.ts';
import { createSettings, mintMissingIndexNowKey, SITE } from './namespace.ts';

const DEMO_SITE_JSON = fileURLToPath(
  new URL('../../../../apps/demo/content/_data/site.json', import.meta.url),
);

const STABLE_SITE_JSON_KEYS = [
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
  'commentsOnPosts',
  'commentsOnPages',
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
  env: Record<string, string> = {},
): Promise<{ contentDir: string; file: string; settings: ReturnType<typeof createSettings> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'geekity-site-namespace-'));
  dirs.push(root);
  const contentDir = path.join(root, 'content');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  const siteJson = path.join(contentDir, '_data', 'site.json');
  await writeFile(siteJson, `${JSON.stringify(file, null, 2)}\n`);
  const resolved = resolveConfig(
    { contentDir, dataDir: path.join(root, 'data'), ...config },
    { env },
  );
  return { contentDir, file: siteJson, settings: createSettings({ config: resolved, env }) };
}

function fileKeysOf(declaration: SettingDeclaration<unknown>): readonly string[] {
  return declaration.fileKeys ?? [declaration.fileKey ?? declaration.key];
}

describe('the site namespace', () => {
  it('declares every key site.json holds a setting under, with a description', () => {
    const declared = SITE.declaration.settings.flatMap(fileKeysOf);
    assert.deepEqual([...declared].sort(), [...STABLE_SITE_JSON_KEYS].sort());
    for (const declaration of SITE.declaration.settings) {
      assert.notEqual(declaration.description, '', `${declaration.key} is described`);
    }
  });

  it('reads the demo site.json as its values and writes each of its keys back unchanged', async () => {
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
    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    for (const [key, value] of Object.entries(demo)) assert.deepEqual(written[key], value, key);
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
    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.equal(written['title'], 'After');
    assert.equal(written['feedSize'], 20);
    assert.deepEqual(written['plugins'], { '@acme/plugin-x': { enabled: true } });
    assert.deepEqual(written['shelf'], { books: ['Dune'] });
  });

  it('writes every setting it declares on any write, so the file shows what is in effect', async () => {
    const { settings, file } = await siteWith({ title: 'Sparse' });

    await settings.set('site', new Map([['tagline', 'now whole']]), 'admin');

    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.equal(written['title'], 'Sparse');
    assert.equal(written['tagline'], 'now whole');
    assert.equal(written['postsPerPage'], 10);
    assert.equal(written['notifyServer'], 'https://rpc.rsscloud.io');
    assert.deepEqual(written['menus'], {});
  });

  it('writes each key it does not change as the value it reads, so a hand edit is tidied', async () => {
    const { settings, file } = await siteWith({
      license: 'CC0',
      postsPerPage: 'lots',
      securityLanguages: 'en,fr',
    });

    await settings.set('site', new Map([['title', 'Tidy']]), 'admin');

    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.equal(written['license'], 'cc0');
    assert.equal(written['postsPerPage'], 10, 'a value it cannot read is written as the default');
    assert.equal(written['securityLanguages'], 'en, fr');
  });

  it('drops the retired navigation and soloAuthor keys on the next write', async () => {
    const { settings, file } = await siteWith({
      title: 'Old',
      navigation: [{ label: 'Home', url: '/' }],
      soloAuthor: true,
    });

    await settings.set('site', new Map([['title', 'New']]), 'admin');

    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.equal(written['navigation'], undefined);
    assert.equal(written['soloAuthor'], undefined);
  });

  it('mints an IndexNow key when IndexNow turns on and the site has none', async () => {
    const { settings } = await siteWith({ indexNow: false });

    await settings.set('site', new Map([['index_now', true]]), 'admin');
    const minted = await settings.get(SITE.index_now_key);
    assert.match(minted, /^[0-9a-f]{32}$/);

    await settings.set('site', new Map([['index_now', false]]), 'admin');
    await settings.set('site', new Map([['index_now', true]]), 'admin');
    assert.equal(await settings.get(SITE.index_now_key), minted, 'a key it has is kept');
  });

  it('mints a missing key for a site.json that has IndexNow on and no key', async () => {
    const { settings, file } = await siteWith({ indexNow: true });

    await mintMissingIndexNowKey(settings, 'boot');

    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.match(String(written['indexNowKey']), /^[0-9a-f]{32}$/);
  });

  it('mints a missing key when the environment turns IndexNow on', async () => {
    const { settings } = await siteWith({}, {}, { GEEKITY_SITE__INDEX_NOW: 'true' });

    await mintMissingIndexNowKey(settings, 'boot');

    assert.match(await settings.get(SITE.index_now_key), /^[0-9a-f]{32}$/);
  });

  it('mints nothing while IndexNow is off or the key is set elsewhere', async () => {
    const off = await siteWith({ title: 'Off' });
    await mintMissingIndexNowKey(off.settings, 'boot');
    assert.deepEqual(JSON.parse(await readFile(off.file, 'utf8')), { title: 'Off' });

    const elsewhere = await siteWith(
      { indexNow: true },
      {},
      { GEEKITY_SITE__INDEX_NOW_KEY: 'from-the-environment' },
    );
    await mintMissingIndexNowKey(elsewhere.settings, 'boot');
    assert.deepEqual(JSON.parse(await readFile(elsewhere.file, 'utf8')), { indexNow: true });
  });

  it('mints no key while IndexNow stays off', async () => {
    const { settings } = await siteWith({});
    await settings.set('site', new Map([['title', 'Quiet']]), 'admin');
    assert.equal(await settings.get(SITE.index_now_key), '');
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
