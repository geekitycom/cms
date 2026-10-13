import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { databaseFile } from '../cache.ts';
import { resolveConfig } from '../config.ts';
import { DEV_MODE, readDevModeRecord } from '../settings/dev-mode.ts';
import { createCms } from '../index.ts';
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

  it('settles the boot-time values into a new frozen config and leaves the resolved one alone', async () => {
    const { contentDir, dataDir } = await dirs();
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ url: 'https://settings.example' }),
    );
    const resolved = resolveConfig({ contentDir, dataDir, watch: false, port: 0 }, { env: {} });

    const cms = createCms(resolved);
    started.push(cms);

    assert.notEqual(cms.config, resolved);
    assert.ok(Object.isFrozen(cms.config));
    assert.equal(cms.config.baseUrl, 'https://settings.example');
    assert.notEqual(cms.config.commentChecker, undefined);
    assert.equal(resolved.baseUrl, 'http://localhost:0');
    assert.equal(resolved.commentChecker, undefined);
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
