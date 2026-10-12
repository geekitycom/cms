import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { resolveConfig } from '../config.ts';
import {
  createSiteDataSource,
  frontPageSlugs,
  postsPerPage,
  siteLocale,
  siteTimezone,
  themeName,
} from './site-data.ts';
import type { SiteData } from './site-data.ts';

/**
 * The site data source re-reads `site.json` when it changes. A filesystem
 * rounds modification times to its clock tick, Linux to a few milliseconds,
 * so a second write inside one tick that keeps the size and the inode is
 * invisible to `stat`. The source must see it anyway (TASK-76, PR #34's
 * Node 26 run): a theme name swapped for another of the same length is
 * exactly that write.
 */
describe('the site data source', () => {
  let contentDir: string;
  let file: string;

  beforeEach(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-site-data-'));
    await mkdir(path.join(contentDir, '_data'));
    file = path.join(contentDir, '_data', 'site.json');
  });

  afterEach(async () => {
    await rm(contentDir, { recursive: true, force: true });
  });

  it('sees a same-size rewrite in place that lands inside one clock tick', async () => {
    // Both writes are pinned to one whole second, which is what a coarse
    // clock does on its own when two writes share a tick.
    const tick = new Date('2026-09-13T12:00:00Z');
    await writeFile(file, JSON.stringify({ theme: 'midnight' }), 'utf8');
    await utimes(file, tick, tick);
    const source = createSiteDataSource(resolveConfig({ contentDir }, {}));
    assert.equal(source.read()['theme'], 'midnight');

    const before = await stat(file);
    await writeFile(file, JSON.stringify({ theme: 'daylight' }), 'utf8');
    await utimes(file, tick, tick);
    const after = await stat(file);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.size, before.size);
    assert.equal(after.ino, before.ino);

    assert.equal(source.read()['theme'], 'daylight');
  });

  it('still answers the defaults when the file goes away, and the file again when it is back', async () => {
    await writeFile(file, JSON.stringify({ title: 'Here' }), 'utf8');
    const source = createSiteDataSource(resolveConfig({ contentDir }, {}));
    assert.equal(source.read().title, 'Here');

    await rm(file);
    assert.equal(source.read().title, 'Geekity');

    await writeFile(file, JSON.stringify({ title: 'Back' }), 'utf8');
    assert.equal(source.read().title, 'Back');
  });
});

describe('reading the site data', () => {
  const site = (data: Record<string, unknown>): SiteData => ({
    title: 'A Site',
    url: '/',
    ...data,
  });

  it('pages listings by the site’s count, or ten', () => {
    assert.equal(postsPerPage(site({ postsPerPage: 3 })), 3);
    assert.equal(postsPerPage(site({ postsPerPage: 0 })), 10);
    assert.equal(postsPerPage(site({ postsPerPage: '3' })), 10);
  });

  it('names the chosen theme, or the empty string for the packaged one', () => {
    assert.equal(themeName(site({ theme: ' mine ' })), 'mine');
    assert.equal(themeName(site({ theme: 7 })), '');
  });

  it('reads dates in the site’s zone, or UTC', () => {
    assert.equal(siteTimezone(site({ timezone: 'Europe/London' })), 'Europe/London');
    assert.equal(siteTimezone(site({})), 'UTC');
  });

  it('writes in the locale, else the language, else the default', () => {
    assert.equal(siteLocale(site({ locale: 'en-gb', language: 'fr' })), 'en-GB');
    assert.equal(siteLocale(site({ language: 'fr' })), 'fr');
    assert.equal(siteLocale(site({})), 'en');
  });

  it('keeps a posts page only beside a homepage', () => {
    assert.deepEqual(frontPageSlugs(site({ homepage: ' welcome ', postsPage: 'news' })), {
      homepage: 'welcome',
      postsPage: 'news',
    });
    assert.deepEqual(frontPageSlugs(site({ postsPage: 'news' })), { homepage: '', postsPage: '' });
  });
});
