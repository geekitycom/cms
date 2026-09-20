import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, exists, readJson, temporaryDir } from './__testing__/cli.ts';
import { createCms } from './index.ts';
import type { Cms } from './index.ts';
import { initSite, seedStarterContent } from './init.ts';

/** Every CMS a test booted over a starter site, waiting to be closed. */
const started: Cms[] = [];

after(async () => {
  for (const cms of started) await cms.close();
  await cleanupTemporaryDirs();
});

const BASE_URL = 'https://blog.example';

/** Every file under a directory, relative to it and sorted. */
async function filesUnder(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort();
}

/**
 * A CMS serving a content directory, indexed and ready to answer requests: the
 * starter site as a reader meets it rather than as JSON on disk.
 */
async function serving(contentDir: string): Promise<Cms> {
  const dataDir = await temporaryDir('geekity-seed-data-');
  const cms = createCms({ contentDir, dataDir, watch: false, baseUrl: BASE_URL });
  started.push(cms);
  await cms.sync();
  return cms;
}

/**
 * The links of one menu on a rendered page, as `[label, href]` pairs, read out
 * of the markup rather than off the settings the markup was drawn from.
 */
function menuLinks(html: string, label: string): [string, string][] {
  const pattern = new RegExp(`<nav class="site-nav" aria-label="${label}">([\\s\\S]*?)</nav>`);
  const nav = pattern.exec(html);
  assert.ok(nav !== null, `the page drew a menu labelled ${label}`);
  return [...(nav[1] ?? '').matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((link) => [
    link[2] ?? '',
    link[1] ?? '',
  ]);
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

  it('types the About page into the primary menu and the feed into the footer (TASK-106 AC #6, TASK-107, TASK-105)', async () => {
    const site = await temporaryDir('geekity-seed-menu-');
    const contentDir = path.join(site, 'content');

    await seedStarterContent({ contentDir, baseUrl: BASE_URL });

    // The menu is the setting and nothing else, so the one page a new site
    // ships is reachable because the starter site.json names it, not because
    // its front matter says anything. Search is typed in beside it (TASK-104):
    // the box is on /search/ and nowhere else, so without the line there is no
    // way in. The footer prints its menu and nothing of its own (TASK-105), so
    // the RSS link a new site wants is a line in it.
    const settings = await readJson(path.join(contentDir, '_data', 'site.json'));
    assert.deepEqual(settings['menus'], {
      primary: [
        { label: 'About', url: '/about/' },
        { label: 'Search', url: '/search/' },
      ],
      footer: [{ label: 'RSS', url: '/feed/' }],
    });

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

/**
 * The starter site as a reader arriving at it finds it (TASK-104).
 *
 * The menu is the setting and nothing else, so a page a new site ships is
 * reachable only where the starter `site.json` types a line for it. These
 * tests read the rendered markup rather than the JSON, because what the
 * criterion is about is whether a new site has a menu on the screen.
 */
describe('the starter site, served', () => {
  it('draws a menu holding About and Search, and both go somewhere', async () => {
    const site = await temporaryDir('geekity-seed-served-');
    const contentDir = path.join(site, 'content');
    await seedStarterContent({ contentDir, baseUrl: BASE_URL });

    const cms = await serving(contentDir);
    const html = await (await cms.app.request('/')).text();

    // Search is in the menu because a new site has no front page: `/` is the
    // post listing, which carries no search form, and the box lives only on
    // `/search/`. Without the line there is no way to reach it at all.
    assert.deepEqual(menuLinks(html, 'Site'), [
      ['About', '/about/'],
      ['Search', '/search/'],
    ]);
    assert.equal((await cms.app.request('/about/')).status, 200);
    assert.equal((await cms.app.request('/search/')).status, 200);
  });

  it('draws the same menu on a site geekity init wrote', async () => {
    const parent = await temporaryDir('geekity-seed-served-init-');
    const initialised = await initSite({ directory: 'from-init', cwd: parent });

    const cms = await serving(path.join(initialised.directory, 'content'));
    const html = await (await cms.app.request('/')).text();

    assert.deepEqual(menuLinks(html, 'Site'), [
      ['About', '/about/'],
      ['Search', '/search/'],
    ]);
  });

  it('says on the About page how it got into the menu and how to take it out', async () => {
    const site = await temporaryDir('geekity-seed-about-');
    const contentDir = path.join(site, 'content');
    await seedStarterContent({ contentDir, baseUrl: BASE_URL });

    const cms = await serving(contentDir);
    const html = await (await cms.app.request('/about/')).text();

    // The starter page is the documentation of the feature it demonstrates:
    // where the line lives, and that deleting it is what takes the page out.
    assert.match(html, /Reading/);
    assert.match(html, /menus\.primary/);
    assert.match(html, /[Dd]elete that line/);
  });
});
