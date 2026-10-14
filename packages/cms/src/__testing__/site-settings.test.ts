import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { changeSiteSettings } from './site-settings.ts';

const dirs: string[] = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('changeSiteSettings', () => {
  it('drops the retired navigation and soloAuthor keys, as a registry write does', async () => {
    const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-site-settings-'));
    dirs.push(contentDir);
    await mkdir(path.join(contentDir, '_data'));
    const siteJson = path.join(contentDir, '_data', 'site.json');
    await writeFile(siteJson, JSON.stringify({ navigation: [], soloAuthor: true, feedSize: 5 }));

    await changeSiteSettings(contentDir, { title: 'Changed' });

    const written = JSON.parse(await readFile(siteJson, 'utf8')) as Record<string, unknown>;
    assert.equal(written['title'], 'Changed');
    assert.equal(written['feedSize'], 5);
    assert.equal(written['navigation'], undefined);
    assert.equal(written['soloAuthor'], undefined);
  });
});
