import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveConfig } from '../config.ts';
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
});
