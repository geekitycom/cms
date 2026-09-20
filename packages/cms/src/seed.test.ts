import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, exists, readJson, temporaryDir } from './__testing__/cli.ts';
import { initSite, seedStarterContent } from './init.ts';

after(cleanupTemporaryDirs);

const BASE_URL = 'https://blog.example';

/** Every file under a directory, relative to it and sorted. */
async function filesUnder(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort();
}

describe('seedStarterContent', () => {
  it('writes the starter site into a content directory that does not exist', async () => {
    const site = await temporaryDir('geekity-seed-missing-');
    const contentDir = path.join(site, 'content');

    const seeded = await seedStarterContent({ contentDir, baseUrl: BASE_URL });

    assert.equal(seeded, true);
    assert.deepEqual(await filesUnder(contentDir), [
      '_data/site.json',
      'pages/about.md',
      'pages/pages.json',
      'posts/2026-01-01-hello-world.md',
      'posts/posts.json',
    ]);
  });

  it('writes the starter site into a content directory with nothing in it', async () => {
    const site = await temporaryDir('geekity-seed-empty-');
    const contentDir = path.join(site, 'content');
    await fs.mkdir(contentDir);

    const seeded = await seedStarterContent({ contentDir, baseUrl: BASE_URL });

    assert.equal(seeded, true);
    assert.ok(await exists(path.join(contentDir, 'posts', '2026-01-01-hello-world.md')));
  });

  it('gives the seeded site.json the base URL the site is served at', async () => {
    const site = await temporaryDir('geekity-seed-url-');
    const contentDir = path.join(site, 'content');

    await seedStarterContent({ contentDir, baseUrl: BASE_URL });

    const settings = await readJson(path.join(contentDir, '_data', 'site.json'));
    assert.equal(settings['url'], 'https://blog.example');
    assert.equal(settings['title'], 'A Geekity site');
  });

  it('types the About page into the primary menu (TASK-106 AC #6, TASK-107)', async () => {
    const site = await temporaryDir('geekity-seed-menu-');
    const contentDir = path.join(site, 'content');

    await seedStarterContent({ contentDir, baseUrl: BASE_URL });

    // The menu is the setting and nothing else, so the one page a new site
    // ships is reachable because the starter site.json names it, not because
    // its front matter says anything.
    const settings = await readJson(path.join(contentDir, '_data', 'site.json'));
    assert.deepEqual(settings['menus'], { primary: [{ label: 'About', url: '/about/' }] });

    const about = await fs.readFile(path.join(contentDir, 'pages', 'about.md'), 'utf8');
    assert.ok(!/^navigation:/m.test(about), 'and the page opts into nothing');
  });

  it('leaves a content directory holding a lone dotfile exactly as it was', async () => {
    const site = await temporaryDir('geekity-seed-dotfile-');
    const contentDir = path.join(site, 'content');
    await fs.mkdir(contentDir);
    await fs.writeFile(path.join(contentDir, '.keep'), 'mine\n', 'utf8');

    const seeded = await seedStarterContent({ contentDir, baseUrl: BASE_URL });

    assert.equal(seeded, false);
    assert.deepEqual(await fs.readdir(contentDir), ['.keep']);
    assert.equal(await fs.readFile(path.join(contentDir, '.keep'), 'utf8'), 'mine\n');
  });

  it('leaves a content directory holding a site exactly as it was', async () => {
    const site = await temporaryDir('geekity-seed-site-');
    const contentDir = path.join(site, 'content');
    await fs.mkdir(path.join(contentDir, '_data'), { recursive: true });
    const mine = '{ "title": "Mine", "url": "https://mine.example" }\n';
    await fs.writeFile(path.join(contentDir, '_data', 'site.json'), mine, 'utf8');

    const seeded = await seedStarterContent({ contentDir, baseUrl: BASE_URL });

    assert.equal(seeded, false);
    assert.deepEqual(await filesUnder(contentDir), ['_data/site.json']);
    assert.equal(await fs.readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'), mine);
  });

  it('seeds the very content geekity init writes, apart from the url', async () => {
    const parent = await temporaryDir('geekity-seed-same-');
    const initialised = await initSite({ directory: 'from-init', cwd: parent });
    const fromInit = path.join(initialised.directory, 'content');
    const seededDir = path.join(parent, 'seeded');

    await seedStarterContent({ contentDir: seededDir, baseUrl: BASE_URL });

    const files = await filesUnder(fromInit);
    assert.deepEqual(await filesUnder(seededDir), files);
    for (const file of files.filter((name) => name !== '_data/site.json')) {
      assert.equal(
        await fs.readFile(path.join(seededDir, file), 'utf8'),
        await fs.readFile(path.join(fromInit, file), 'utf8'),
        file,
      );
    }
    const { url: _seededUrl, ...seeded } = await readJson(
      path.join(seededDir, '_data', 'site.json'),
    );
    const { url: _initUrl, ...init } = await readJson(path.join(fromInit, '_data', 'site.json'));
    assert.deepEqual(seeded, init);
  });
});
