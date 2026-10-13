import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { databaseFile } from '../cache.ts';
import { resolveConfig } from '../config.ts';
import { DEV_MODE, readDevModeRecord } from '../settings/dev-mode.ts';
import { createCms, settleConfig } from '../index.ts';
import type { Cms } from '../index.ts';

const temporaryDirs: string[] = [];
const started: Cms[] = [];

after(async () => {
  for (const cms of started) await cms.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dirs(): Promise<{ contentDir: string; dataDir: string }> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-boot-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-boot-data-'));
  temporaryDirs.push(contentDir, dataDir);
  return { contentDir, dataDir };
}

async function siteJson(contentDir: string, file: Record<string, unknown>): Promise<void> {
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(path.join(contentDir, '_data', 'site.json'), JSON.stringify(file));
}

describe('settleConfig', () => {
  it('takes the base URL site.json holds into a new frozen config, and leaves the resolved one alone', async () => {
    const { contentDir, dataDir } = await dirs();
    await siteJson(contentDir, { url: 'https://settings.example' });
    const resolved = resolveConfig({ contentDir, dataDir, watch: false, port: 0 }, { env: {} });

    const settled = await settleConfig(resolved);

    assert.notEqual(settled, resolved);
    assert.ok(Object.isFrozen(settled));
    assert.equal(settled.baseUrl, 'https://settings.example');
    assert.equal(settled.baseUrlSource, 'default');
    assert.equal(resolved.baseUrl, 'http://localhost:0');
    const cms = createCms(settled);
    started.push(cms);
    assert.equal(cms.config.baseUrl, 'https://settings.example');
  });

  it('keeps a base URL the environment or the config file sets over the one in site.json', async () => {
    const { contentDir, dataDir } = await dirs();
    await siteJson(contentDir, { url: 'https://settings.example' });

    const fromEnv = resolveConfig(
      { contentDir, dataDir },
      { env: { GEEKITY_BASE_URL: 'https://env.example' } },
    );
    const fromFile = resolveConfig(
      { contentDir, dataDir, baseUrl: 'https://config.example' },
      { env: {} },
    );

    assert.equal((await settleConfig(fromEnv)).baseUrl, 'https://env.example');
    assert.equal((await settleConfig(fromFile)).baseUrl, 'https://config.example');
  });

  it('keeps the configured base URL when site.json names none', async () => {
    const { contentDir, dataDir } = await dirs();
    const resolved = resolveConfig({ contentDir, dataDir, port: 0 }, { env: {} });

    assert.equal((await settleConfig(resolved)).baseUrl, 'http://localhost:0');
  });
});

describe('createCms', () => {
  it('uses a config that is already resolved as it is, without reading the environment again', async () => {
    const { contentDir, dataDir } = await dirs();
    const resolved = resolveConfig(
      { contentDir, dataDir, watch: false },
      { env: { GEEKITY_BASE_URL: 'https://env.example', GEEKITY_PORT: '0' } },
    );

    const cms = createCms(resolved);
    started.push(cms);

    assert.equal(cms.config.baseUrlSource, 'environment');
    assert.equal(cms.config.baseUrl, 'https://env.example');
  });

  it('adds the comment checker in a new frozen config and leaves the resolved one alone', async () => {
    const { contentDir, dataDir } = await dirs();
    const resolved = resolveConfig({ contentDir, dataDir, watch: false, port: 0 }, { env: {} });

    const cms = createCms(resolved);
    started.push(cms);

    assert.notEqual(cms.config, resolved);
    assert.ok(Object.isFrozen(cms.config));
    assert.notEqual(cms.config.commentChecker, undefined);
    assert.equal(resolved.commentChecker, undefined);
  });

  it('builds on the base URL its config holds, without reading site.json for one', async () => {
    const { contentDir, dataDir } = await dirs();
    await siteJson(contentDir, { url: 'https://settings.example' });

    const cms = createCms(
      resolveConfig({ contentDir, dataDir, watch: false, port: 0 }, { env: {} }),
    );
    started.push(cms);

    assert.equal(cms.config.baseUrl, 'http://localhost:0');
  });

  it('says on serving when the settings name a base URL it was not built for', async (t) => {
    const { contentDir, dataDir } = await dirs();
    await siteJson(contentDir, { url: 'https://settings.example' });
    const warned: string[] = [];
    t.mock.method(console, 'warn', (message: string) => warned.push(message));

    const cms = createCms(
      resolveConfig({ contentDir, dataDir, watch: false, port: 0 }, { env: {} }),
    );
    started.push(cms);
    await cms.serve();

    assert.ok(
      warned.some((message) => message.includes('https://settings.example')),
      warned.join('\n'),
    );
  });

  it('still resolves a config a site wrote by hand', async () => {
    const { contentDir, dataDir } = await dirs();

    const cms = createCms({ contentDir, dataDir, watch: false, port: 0, loginAttempts: 9 });
    started.push(cms);

    assert.equal(cms.config.loginAttempts, 9);
    assert.equal(cms.config.contentDir, contentDir);
    assert.ok(Object.isFrozen(cms.config));
  });

  it('stamps what booting writes with the clock it was given', async () => {
    const PINNED = '2026-05-06T07:08:09.000Z';
    const { contentDir, dataDir } = await dirs();

    const cms = createCms({
      contentDir,
      dataDir,
      watch: false,
      port: 0,
      devMode: true,
      now: () => new Date(PINNED),
    });
    started.push(cms);

    const db = new DatabaseSync(databaseFile(dataDir), { readOnly: true });
    try {
      for (const ledger of ['migrations', 'admin_migrations']) {
        const stamps = db
          .prepare(`SELECT DISTINCT applied_at FROM ${ledger}`)
          .all()
          .map((row) => row['applied_at']);
        assert.deepEqual(stamps, [PINNED], ledger);
      }
    } finally {
      db.close();
    }
    assert.equal(await cms.settings.get(DEV_MODE.on), true, 'boot latched dev mode');
    assert.deepEqual(
      readDevModeRecord(dataDir).map((entry) => entry.at),
      [PINNED],
    );
  });
});
