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
      'pages/privacy.md',
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

  it('types the About page into the primary menu and the feed and privacy page into the footer (TASK-106 AC #6, TASK-107, TASK-105, TASK-136)', async () => {
    const site = await temporaryDir('geekity-seed-menu-');
    const contentDir = path.join(site, 'content');

    await seedStarterContent({ contentDir, baseUrl: BASE_URL });

    // The menu is the setting and nothing else, so the one page a new site
    // ships is reachable because the starter site.json names it, not because
    // its front matter says anything. Search is typed in beside it (TASK-104):
    // the box is on /search/ and nowhere else, so without the line there is no
    // way in. The footer prints its menu and nothing of its own (TASK-105), so
    // the RSS link a new site wants is a line in it, and so is the privacy
    // page: deleting that line is how a site that drops the page unlinks it.
    const settings = await readJson(path.join(contentDir, '_data', 'site.json'));
    assert.deepEqual(settings['menus'], {
      primary: [
        { label: 'About', url: '/about/' },
        { label: 'Search', url: '/search/' },
      ],
      footer: [
        { label: 'RSS', url: '/feed/' },
        { label: 'Privacy', url: '/privacy/' },
      ],
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

  it('links the privacy page from the footer, and it answers (TASK-136 AC #2)', async () => {
    const parent = await temporaryDir('geekity-seed-privacy-footer-');
    const initialised = await initSite({ directory: 'from-init', cwd: parent });

    const cms = await serving(path.join(initialised.directory, 'content'));
    const html = await (await cms.app.request('/')).text();

    assert.deepEqual(menuLinks(html, 'Footer'), [
      ['RSS', '/feed/'],
      ['Privacy', '/privacy/'],
    ]);
    assert.equal((await cms.app.request('/privacy/')).status, 200);
  });
});

/**
 * The starter privacy page (TASK-136). Every row of the README's Personal data
 * table is something this page has to own up to, and each optional feature has
 * to say it is optional, so the assertions read the rendered page for each.
 */
describe('the starter privacy page', () => {
  async function privacyText(): Promise<string> {
    const parent = await temporaryDir('geekity-seed-privacy-');
    const initialised = await initSite({ directory: 'from-init', cwd: parent });
    const cms = await serving(path.join(initialised.directory, 'content'));
    const response = await cms.app.request('/privacy/');
    assert.equal(response.status, 200);
    const html = await response.text();
    const main = /<main id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
    return main
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#39;|&rsquo;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');
  }

  it('says it is a starting point for the owner to review, not legal advice', async () => {
    const text = await privacyText();
    assert.match(text, /starting point/i);
    assert.match(text, /not legal advice/i);
    assert.match(text, /review/i);
  });

  it('lists everything the CMS stores about a reader', async () => {
    const text = await privacyText();
    for (const [what, pattern] of [
      [
        'comment name, website and words',
        /name, (?:your )?website and (?:the )?(?:words|comment)/i,
      ],
      ['commenter email', /email address/i],
      ['reply notices', /repl(?:y|ies)[^.]*email|email[^.]*repl(?:y|ies)/i],
      ['opt-out list', /unsubscribe/i],
      ['salted address hash, never the address', /hash/i],
      [
        'the address itself is not stored',
        /IP address itself|address itself is never|never store(?:s|d)? (?:your|the) (?:IP )?address/i,
      ],
      ['webmentions', /webmention/i],
      ['contact messages', /contact form/i],
      ['fediverse followers', /follow/i],
      ['fediverse replies, likes and boosts', /boost/i],
      ['remote avatars fetched by the site', /avatar/i],
      ['accounts', /account/i],
      ['the session cookie', /geekity_session/],
      ['no cookie for readers', /no cookies?/i],
      ['rate-limit counts, in memory only', /in memory/i],
      ['server logs', /log/i],
      ['the referrer sent on to other sites', /which site you came from, not which page/i],
    ] as const) {
      assert.match(text, pattern, `the page does not mention ${what}`);
    }
  });

  it('marks the optional features as optional', async () => {
    const text = await privacyText();
    assert.match(text, /Reply emails \(optional\)/);
    assert.match(text, /The contact form \(optional\)/);
    assert.match(text, /Spam checking with Akismet \(optional\)/);
    assert.match(text, /Akismet, a spam-checking service run by Automattic/);
  });

  it('quotes the retention periods a new site starts with, and says to keep them in step', async () => {
    const text = await privacyText();
    assert.match(text, /180 days/);
    assert.match(text, /30 days/);
    assert.match(text, /365 days/);
    assert.match(text, /Settings > Discussion/);
    assert.match(text, /Tools > Personal data|erase/i);
  });
});
