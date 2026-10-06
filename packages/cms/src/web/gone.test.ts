import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, resolveNothing, signIn } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { databaseFiles } from '../cache.ts';
import { seedActorKeys } from '../federation/__testing__/keys.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

const BASE_URL = 'https://blog.example';
const ADA = { username: 'ada', password: 'correct horse battery' };
const ACTIVITY_STREAMS = 'application/activity+json';

const GONE_FILE = '_trash/posts/2026-09-02-gone.md';
const GONE_URL = '/2026/09/gone/';
const NOW = new Date('2026-09-20T12:00:00Z');

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

interface Site {
  cms: Cms;
  contentDir: string;
  dataDir: string;
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

async function boot(contentDir: string, dataDir: string): Promise<Cms> {
  const cms = createCms({
    dataDir,
    contentDir,
    watch: false,
    baseUrl: BASE_URL,
    hostLookup: resolveNothing,
    now: () => NOW,
  });
  started.push(cms);
  await cms.sync();
  return cms;
}

async function site(files: Record<string, string>): Promise<Site> {
  const dataDir = await temporaryDir('geekity-gone-data-');
  const contentDir = await temporaryDir('geekity-gone-content-');
  await writeTree(contentDir, files);
  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'Geekity',
      baseUrl: BASE_URL,
      timezone: 'UTC',
      author: ADA.username,
      notifyServer: '',
      webmentionsReceive: true,
    },
  });
  writeUsers(dataDir, [ADA]);
  seedActorKeys(dataDir, ADA.username);
  return { cms: await boot(contentDir, dataDir), contentDir, dataDir };
}

function post(
  title: string,
  options: { date: string; permalink: string; draft?: boolean; extra?: string[] },
): string {
  return [
    '---',
    `title: ${title}`,
    `date: '${options.date}'`,
    `permalink: ${options.permalink}`,
    ...(options.draft === true ? ['draft: true'] : []),
    ...(options.extra ?? []),
    '---',
    '',
    `${title}, in words.`,
    '',
  ].join('\n');
}

const GONE = {
  [GONE_FILE]: post('Gone', { date: '2026-09-02T09:00:00Z', permalink: GONE_URL }),
};

async function get(cms: Cms, pathname: string, accept?: string): Promise<Response> {
  return await cms.app.request(
    new Request(`${BASE_URL}${pathname}`, accept === undefined ? {} : { headers: { accept } }),
  );
}

async function submit(
  agent: Browser,
  url: string,
  changes: Record<string, string>,
): Promise<Response> {
  const token = csrfField(await (await agent.get(url)).text());
  assert.ok(token !== undefined, `the editor at ${url} carried a CSRF token`);
  return agent.post(url, { csrf_token: token, ...changes });
}

describe('a deleted post', () => {
  it('answers 410 Gone with a small page, not 404', async () => {
    const { cms } = await site(GONE);

    const response = await get(cms, GONE_URL);

    assert.equal(response.status, 410);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(response.headers.get('x-pingback'), null, 'a gone post takes no pingbacks');
    const html = await response.text();
    assert.match(html, /This content has been deleted/);
    assert.ok(!html.includes('Gone, in words.'), 'the deleted words are not served');
  });

  it('answers 410 for its Markdown and JSON as well', async () => {
    const { cms } = await site(GONE);

    assert.equal((await get(cms, `${GONE_URL}index.md`)).status, 410);
    assert.equal((await get(cms, `${GONE_URL}index.json`)).status, 410);
  });

  it('still 404s where nothing was ever public: a trashed draft and a URL naming nothing', async () => {
    const { cms } = await site({
      '_trash/posts/2026-09-03-secret.md': post('Secret', {
        date: '2026-09-03T09:00:00Z',
        permalink: '/2026/09/secret/',
        draft: true,
      }),
    });

    assert.equal((await get(cms, '/2026/09/secret/')).status, 404);
    assert.equal((await get(cms, '/2026/09/never-written/')).status, 404);
  });

  it('answers an ActivityStreams request at its id with 410 and a Tombstone', async () => {
    const { cms } = await site(GONE);

    const response = await get(cms, GONE_URL, ACTIVITY_STREAMS);

    assert.equal(response.status, 410);
    assert.match(response.headers.get('content-type') ?? '', /application\/activity\+json/);
    const object = (await response.json()) as Record<string, unknown>;
    assert.equal(object['type'], 'Tombstone');
    assert.equal(object['id'], `${BASE_URL}${GONE_URL}`);
    assert.equal(object['formerType'], 'as:Note', 'the same Tombstone a Delete carries');
  });

  it('answers 410 and a Tombstone at the id a moved post kept, and no Article', async () => {
    const formerId = `${BASE_URL}/2026/09/old-name/`;
    const { cms } = await site({
      [GONE_FILE]: post('Gone', {
        date: '2026-09-02T09:00:00Z',
        permalink: GONE_URL,
        extra: ['activitypub:', `  id: ${formerId}`],
      }),
    });

    for (const pathname of ['/2026/09/old-name/', GONE_URL]) {
      const response = await get(cms, pathname, ACTIVITY_STREAMS);
      assert.equal(response.status, 410, pathname);
      const object = (await response.json()) as Record<string, unknown>;
      assert.equal(object['type'], 'Tombstone', pathname);
      assert.equal(object['id'], formerId, pathname);
    }
  });

  it('is served again once restored from the trash', async () => {
    const { cms } = await site({
      'posts/2026-09-02-gone.md': post('Gone', {
        date: '2026-09-02T09:00:00Z',
        permalink: GONE_URL,
      }),
    });
    const agent = await signIn(cms, ADA);

    assert.equal((await submit(agent, '/admin/posts/gone', { action: 'trash' })).status, 303);
    assert.equal((await get(cms, GONE_URL)).status, 410, 'deleted');

    assert.equal((await submit(agent, '/admin/posts/gone', { action: 'restore' })).status, 303);
    const restored = await get(cms, GONE_URL);
    assert.equal(restored.status, 200, 'restored');
    assert.match(await restored.text(), /Gone, in words\./);
    assert.equal((await get(cms, GONE_URL, ACTIVITY_STREAMS)).status, 200);
  });

  it('gives way to a new file at the same URL while the deleted one stays in the trash', async () => {
    const { cms, contentDir } = await site(GONE);
    assert.equal((await get(cms, GONE_URL)).status, 410);

    await writeTree(contentDir, {
      'posts/2026-09-05-again.md': post('Again', {
        date: '2026-09-05T09:00:00Z',
        permalink: GONE_URL,
      }),
    });
    await cms.sync();

    const response = await get(cms, GONE_URL);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Again, in words\./);
    assert.equal((await get(cms, GONE_URL, ACTIVITY_STREAMS)).status, 200);
  });

  it('gives its URL to a post the editor writes with the same slug, with no -2', async () => {
    const { cms } = await site(GONE);
    const agent = await signIn(cms, ADA);

    const response = await submit(agent, '/admin/posts/new', {
      title: 'Gone',
      date: '2026-09-10T09:00:00Z',
      body: 'Back again.',
      action: 'publish',
    });

    assert.equal(response.status, 303);
    const page = await get(cms, GONE_URL);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Back again\./);
    assert.equal((await get(cms, '/2026/09/gone-2/')).status, 404, 'no numbered slug');
  });

  it('keeps both deleted files when a same-day post at its URL is deleted too', async () => {
    const { cms, contentDir } = await site(GONE);
    const agent = await signIn(cms, ADA);

    await submit(agent, '/admin/posts/new', {
      title: 'Gone',
      date: '2026-09-02T18:00:00Z',
      body: 'Back again.',
      action: 'publish',
    });
    assert.equal((await get(cms, GONE_URL)).status, 200);
    assert.equal((await submit(agent, '/admin/posts/gone', { action: 'trash' })).status, 303);

    assert.equal((await get(cms, GONE_URL)).status, 410);
    const trash = path.join(contentDir, '_trash', 'posts');
    const files = await readdir(trash);
    assert.equal(files.length, 2, `both deleted posts are kept: ${files.join(', ')}`);
    const words = await Promise.all(
      files.map(async (file) => await readFile(path.join(trash, file), 'utf8')),
    );
    assert.ok(words.some((text) => text.includes('Gone, in words.')));
    assert.ok(words.some((text) => text.includes('Back again.')));
  });

  it('refuses to be restored over the live post that has taken its URL', async () => {
    const { cms, contentDir } = await site({
      '_trash/posts/2026-09-10-gone.md': post('Gone', {
        date: '2026-09-10T09:00:00Z',
        permalink: GONE_URL,
      }),
      'posts/2026-09-05-again.md': post('Again', {
        date: '2026-09-05T09:00:00Z',
        permalink: GONE_URL,
      }),
    });
    const agent = await signIn(cms, ADA);

    const response = await submit(
      agent,
      '/admin/posts/gone?path=_trash%2Fposts%2F2026-09-10-gone.md',
      { action: 'restore' },
    );

    assert.equal(response.status, 303);
    const editor = await (await agent.get(response.headers.get('location') ?? '')).text();
    assert.match(editor, /posts\/2026-09-05-again\.md now holds \/2026\/09\/gone\//);
    const served = await get(cms, GONE_URL);
    assert.equal(served.status, 200);
    assert.match(await served.text(), /Again, in words\./);
    assert.deepEqual(await readdir(path.join(contentDir, '_trash', 'posts')), [
      '2026-09-10-gone.md',
    ]);
    assert.equal(cms.store.getByPath('_trash/posts/2026-09-10-gone.md')?.title, 'Gone');
  });

  it('still answers 410 after the database is deleted', async () => {
    const first = await site(GONE);
    assert.equal((await get(first.cms, GONE_URL)).status, 410);

    await first.cms.close();
    started.splice(started.indexOf(first.cms), 1);
    await Promise.all(databaseFiles(first.dataDir).map((file) => rm(file, { force: true })));

    const cms = await boot(first.contentDir, first.dataDir);
    assert.equal((await get(cms, GONE_URL)).status, 410);
    assert.equal((await get(cms, GONE_URL, ACTIVITY_STREAMS)).status, 410);
  });
});

describe('a deleted post whose slug a live post also uses', () => {
  const LIVE_FILE = 'posts/2026-09-10-gone.md';
  const LIVE = post('Back again', { date: '2026-09-10T09:00:00Z', permalink: GONE_URL });

  async function trashLink(agent: Browser, title: string): Promise<string> {
    const list = await (await agent.get('/admin/posts?status=trash')).text();
    const link = new RegExp(`href="([^"]+)">${title}</a>`).exec(list)?.[1];
    assert.ok(link !== undefined, `the trash lists ${title}`);
    return link;
  }

  async function save(
    agent: Browser,
    url: string,
    changes: Record<string, string>,
  ): Promise<Response> {
    const html = await (await agent.get(url)).text();
    const token = csrfField(html);
    const hash = /name="hash" value="([^"]+)"/.exec(html)?.[1];
    assert.ok(token !== undefined && hash !== undefined, `the editor at ${url} carried its form`);
    return agent.post(url, { csrf_token: token, hash, ...changes });
  }

  it('opens in the editor from the trash list, not the live post', async () => {
    const { cms } = await site({ ...GONE, [LIVE_FILE]: LIVE });
    const agent = await signIn(cms, ADA);

    const editor = await agent.get(await trashLink(agent, 'Gone'));

    assert.equal(editor.status, 200);
    const html = await editor.text();
    assert.match(html, /This post is in the trash/);
    assert.match(html, /Gone, in words\./);
    assert.ok(!html.includes('Back again, in words.'), 'not the live post');
  });

  it('is restored from the trash list when its URL is free', async () => {
    const { cms, contentDir } = await site({
      '_trash/posts/2026-08-02-gone.md': post('Gone', {
        date: '2026-08-02T09:00:00Z',
        permalink: '/2026/08/gone/',
      }),
      [LIVE_FILE]: LIVE,
    });
    const agent = await signIn(cms, ADA);
    const link = await trashLink(agent, 'Gone');

    const response = await submit(agent, link, {
      action: 'restore',
      return: '/admin/posts?status=trash',
    });

    assert.equal(response.status, 303);
    assert.deepEqual(await readdir(path.join(contentDir, 'posts')), [
      '2026-08-02-gone.md',
      '2026-09-10-gone.md',
    ]);
    const restored = await get(cms, '/2026/08/gone/');
    assert.equal(restored.status, 200);
    assert.match(await restored.text(), /Gone, in words\./);
    assert.equal((await get(cms, GONE_URL)).status, 200, 'the live post still serves');
  });

  it('refuses a restore from the trash list while the live post holds its URL', async () => {
    const { cms, contentDir } = await site({ ...GONE, [LIVE_FILE]: LIVE });
    const agent = await signIn(cms, ADA);
    const link = await trashLink(agent, 'Gone');

    const response = await submit(agent, link, {
      action: 'restore',
      return: '/admin/posts?status=trash',
    });

    assert.equal(response.status, 303);
    const list = await (await agent.get(response.headers.get('location') ?? '')).text();
    assert.match(list, /posts\/2026-09-10-gone\.md now holds \/2026\/09\/gone\//);
    assert.deepEqual(await readdir(path.join(contentDir, '_trash', 'posts')), [
      '2026-09-02-gone.md',
    ]);
    const served = await get(cms, GONE_URL);
    assert.equal(served.status, 200);
    assert.match(await served.text(), /Back again, in words\./);
  });

  it('keeps the trashed copy where it is when edited from the trash', async () => {
    const { cms, contentDir } = await site({ ...GONE, [LIVE_FILE]: LIVE });
    const agent = await signIn(cms, ADA);

    const response = await save(agent, await trashLink(agent, 'Gone'), {
      title: 'Gone',
      date: '2026-09-02T09:00:00Z',
      body: 'Gone, rewritten.',
      action: 'save-draft',
    });

    assert.equal(response.status, 303);
    const editor = await (await agent.get(response.headers.get('location') ?? '')).text();
    assert.match(editor, /Gone, rewritten\./);
    assert.match(await readFile(path.join(contentDir, GONE_FILE), 'utf8'), /Gone, rewritten\./);
    assert.match(await readFile(path.join(contentDir, LIVE_FILE), 'utf8'), /Back again, in words/);
  });

  it('leaves the live post at its slug in the editor', async () => {
    const { cms } = await site({
      '_trash/posts/2026-09-12-gone.md': post('Gone', {
        date: '2026-09-12T09:00:00Z',
        permalink: '/2026/09/gone-later/',
      }),
      [LIVE_FILE]: LIVE,
    });
    const agent = await signIn(cms, ADA);

    const editor = await (await agent.get('/admin/posts/gone')).text();
    assert.match(editor, /Back again, in words\./);
    assert.ok(!editor.includes('This post is in the trash'));

    const response = await save(agent, '/admin/posts/gone', {
      title: 'Back again',
      slug: 'gone',
      date: '2026-09-10T09:00:00Z',
      body: 'Back again, edited.',
      action: 'publish',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/posts/gone');
    assert.match(await (await get(cms, GONE_URL)).text(), /Back again, edited\./);
  });
});
