import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms, pluginDataFolder } from '@geekity/cms';
import type { Cms } from '@geekity/cms';
import type { PluginCommandContext, PluginSite } from '@geekity/cms/plugin';

import { importWordPressContent } from '../src/content-import.ts';
import type { ReportRow } from '../src/content-import.ts';
import { attachments } from '../src/media-import.ts';
import { postsAndPages } from '../src/posts-import.ts';
import { parseWordPressExport } from '../src/wxr.ts';
import { writeSite } from './site.ts';
import { SITE, wxr } from './wxr.ts';
import type { TestItem } from './wxr.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const REDIRECTS = '_data/redirects/wordpress.json';

const temporaryDirs: string[] = [];
const started: Cms[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function unused(): never {
  throw new Error('The redirects do not reach this.');
}

interface Site {
  readonly contentDir: string;
  run(items: readonly TestItem[]): Promise<readonly ReportRow[]>;
  serve(): Cms;
  text(relative: string): Promise<string>;
}

async function site(): Promise<Site> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geekity-wp-redirects-'));
  temporaryDirs.push(root);
  const contentDir = path.join(root, 'content');
  const uploadsDir = path.join(root, 'wp-content', 'uploads');
  await fs.mkdir(path.join(uploadsDir, '2024', '03'), { recursive: true });
  await fs.writeFile(path.join(uploadsDir, '2024', '03', 'photo.png'), PNG);
  writeSite(contentDir, { baseUrl: SITE, author: 'ada', enabled: false });
  const data = pluginDataFolder(path.join(root, 'data'), '@geekity/plugin-wordpress');
  const pluginSite: PluginSite = {
    baseUrl: SITE,
    contentDir,
    users: () => [{ username: 'ada' }],
    setActorId: unused,
    actorKey: unused,
    writeActorKey: unused,
    loadActorKeys: unused,
    followers: () => [],
    addFollower: unused,
    checkUpload: (_name, bytes) => ({ accepted: true, bytes }),
    comments: unused,
    putComments: unused,
  };
  return {
    contentDir,
    run: async (items) => {
      const context: PluginCommandContext = {
        args: [],
        options: { uploads: uploadsDir },
        cwd: root,
        site: pluginSite,
        write: () => undefined,
      };
      const report = await importWordPressContent({
        exported: parseWordPressExport(wxr(items)),
        context,
        data,
        importers: [postsAndPages, attachments],
      });
      return report.rows;
    },
    serve: () => {
      const instance = createCms({
        dataDir: path.join(root, 'data'),
        contentDir,
        watch: false,
        baseUrl: SITE,
        federation: { queue: null },
      });
      started.push(instance);
      return instance;
    },
    text: (relative) => fs.readFile(path.join(contentDir, relative), 'utf8'),
  };
}

async function location(instance: Cms, url: string): Promise<[number, string | null]> {
  const response = await instance.app.request(`${SITE}${url}`);
  return [response.status, response.headers.get('location')];
}

const POSTS_AND_PAGES: readonly TestItem[] = [
  { id: 10, slug: 'hello' },
  { id: 20, type: 'page', slug: 'about', link: `${SITE}/about/` },
  { id: 21, type: 'page', slug: 'team', parent: 20, link: `${SITE}/about/team/` },
  { id: 11, slug: 'unfinished', status: 'draft', link: `${SITE}/?p=11` },
  { id: 12, slug: 'tomorrow', status: 'future', link: `${SITE}/?p=12` },
  { id: 13, slug: 'secret', status: 'private', link: `${SITE}/?p=13` },
  { id: 14, slug: 'locked', password: 'hunter2' },
  { id: 22, type: 'page', slug: 'plans', status: 'draft', link: `${SITE}/?page_id=22` },
];

describe('the ?p= and ?page_id= redirects', () => {
  it('answer 301 at the permalink for every post and page WordPress served publicly', async () => {
    const where = await site();
    await where.run(POSTS_AND_PAGES);
    const instance = where.serve();
    await instance.sync();

    assert.deepEqual(await location(instance, '/?p=10'), [301, '/2024/03/hello/']);
    assert.deepEqual(await location(instance, '/?p=20'), [301, '/about/']);
    assert.deepEqual(await location(instance, '/?page_id=20'), [301, '/about/']);
    assert.deepEqual(await location(instance, '/?page_id=21'), [301, '/about/team/']);
    assert.deepEqual(await location(instance, '/?p=21'), [301, '/about/team/']);
    assert.equal((await instance.app.request(`${SITE}/2024/03/hello/`)).status, 200);
  });

  it('leave a withheld post or page indistinguishable from an id WordPress never had', async () => {
    const where = await site();
    await where.run(POSTS_AND_PAGES);
    const instance = where.serve();
    await instance.sync();

    const never = await instance.app.request(`${SITE}/?p=999`);
    const unknown = [never.status, never.headers.get('location')];
    for (const url of ['/?p=11', '/?p=12', '/?p=13', '/?p=14', '/?page_id=22', '/?p=22']) {
      assert.deepEqual(await location(instance, url), unknown, url);
    }
    const declared = JSON.parse(await where.text(REDIRECTS)) as Record<string, string>;
    assert.deepEqual(Object.keys(declared).sort(), [
      '/?p=10',
      '/?p=20',
      '/?p=21',
      '/?page_id=20',
      '/?page_id=21',
    ]);
  });
});

describe('the old slugs', () => {
  it('become redirect_from entries on the post, with its old dates', async () => {
    const where = await site();
    await where.run([
      {
        id: 15,
        slug: 'final-name',
        date: '2016-09-26 09:46:09',
        link: `${SITE}/2016/09/final-name/`,
        meta: [
          { key: '_wp_old_slug', value: '15' },
          { key: '_wp_old_slug', value: 'first-name' },
          { key: '_wp_old_date', value: '2026-03-22' },
        ],
      },
      { id: 16, slug: 'never-renamed', link: `${SITE}/2024/03/never-renamed/` },
    ]);

    const renamed = await where.text('posts/2016-09-26-final-name.md');
    assert.match(
      renamed,
      /\npermalink: \/2016\/09\/final-name\/\nredirect_from:\n {2}- \/2016\/09\/15\/\n {2}- \/2016\/09\/first-name\/\n {2}- \/2026\/03\/final-name\/\n {2}- \/2026\/03\/15\/\n {2}- \/2026\/03\/first-name\/\n/,
    );
    assert.doesNotMatch(await where.text('posts/2024-03-05-never-renamed.md'), /redirect_from/);

    const instance = where.serve();
    await instance.sync();
    for (const old of ['/2016/09/first-name/', '/2016/09/15/', '/2026/03/final-name/']) {
      assert.deepEqual(await location(instance, old), [301, '/2016/09/final-name/'], old);
    }
  });
});

describe('the attachment pages', () => {
  it('answer 301 at the file under /uploads/, at their page URL, ?attachment_id= and ?p=', async () => {
    const where = await site();
    await where.run([
      { id: 10, slug: 'pictures' },
      {
        id: 30,
        type: 'attachment',
        status: 'inherit',
        slug: 'photo',
        parent: 10,
        link: `${SITE}/2024/03/pictures/photo/`,
        attachmentUrl: `${SITE}/wp-content/uploads/2024/03/photo.png`,
        meta: [{ key: '_wp_attached_file', value: '2024/03/photo.png' }],
      },
      {
        id: 31,
        type: 'attachment',
        status: 'inherit',
        slug: 'missing',
        link: `${SITE}/missing-png/`,
        attachmentUrl: `${SITE}/wp-content/uploads/2024/03/missing.png`,
        meta: [{ key: '_wp_attached_file', value: '2024/03/missing.png' }],
      },
    ]);
    const instance = where.serve();
    await instance.sync();

    for (const url of ['/2024/03/pictures/photo/', '/?attachment_id=30', '/?p=30']) {
      assert.deepEqual(await location(instance, url), [301, '/uploads/2024/03/photo.png'], url);
    }
    assert.equal((await instance.app.request(`${SITE}/uploads/2024/03/photo.png`)).status, 200);
    assert.equal((await instance.app.request(`${SITE}/missing-png/`)).status, 404);
    assert.deepEqual(await location(instance, '/?attachment_id=31'), [200, null]);
  });
});

describe('redirects the site declared itself', () => {
  it('survive a rerun: redirects.json is never touched, and a key the site set or changed is kept', async () => {
    const where = await site();
    const own = `${JSON.stringify([{ from: '/?page_id=21', to: '/elsewhere/' }], null, 2)}\n`;
    await fs.writeFile(path.join(where.contentDir, '_data', 'redirects.json'), own);
    await where.run(POSTS_AND_PAGES);

    const declared = JSON.parse(await where.text(REDIRECTS)) as Record<string, string>;
    declared['/?p=20'] = '/about-us/';
    declared['/old-feed/'] = '/feed/';
    const edited = `${JSON.stringify(declared, null, 2)}\n`;
    await fs.writeFile(path.join(where.contentDir, REDIRECTS), edited);

    const rows = await where.run(POSTS_AND_PAGES);

    assert.equal(await where.text('_data/redirects.json'), own);
    assert.equal(await where.text(REDIRECTS), edited);
    const forRedirect = (key: string) =>
      rows.filter((row) => row.path === REDIRECTS && row.why.startsWith(key));
    assert.deepEqual(
      forRedirect('/?p=20').map((row) => row.outcome),
      ['kept'],
    );
    assert.deepEqual(
      forRedirect('/?page_id=21 ').map((row) => row.outcome),
      ['unchanged'],
    );

    const instance = where.serve();
    await instance.sync();
    assert.deepEqual(await location(instance, '/?page_id=21'), [301, '/elsewhere/']);
    assert.deepEqual(await location(instance, '/?p=20'), [301, '/about-us/']);
  });
});
