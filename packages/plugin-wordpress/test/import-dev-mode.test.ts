import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  createCms,
  createMemoryMailProvider,
  pluginDataFolder,
  pluginSite,
  resolveConfig,
} from '@geekity/cms';
import type { Cms } from '@geekity/cms';

import { commentsAndReactions } from '../src/comments-import.ts';
import { importWordPressContent } from '../src/content-import.ts';
import { postsAndPages } from '../src/posts-import.ts';
import { parseWordPressExport } from '../src/wxr.ts';
import { seedActorKeys, writeUsers } from './site.ts';
import { SITE, wxr } from './wxr.ts';

const USER = 'ada';
const outbound: string[] = [];
const roots: string[] = [];
const started: Cms[] = [];
let restoreFetch: () => void;

before(() => {
  const passOn = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return passOn(input, init);
    outbound.push(`${init?.method ?? 'GET'} ${url.href}`);
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  restoreFetch = () => {
    globalThis.fetch = passOn;
  };
});

after(async () => {
  for (const cms of started) await cms.close();
  restoreFetch();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

interface DevSite {
  readonly cms: Cms;
  readonly root: string;
  readonly contentDir: string;
  readonly dataDir: string;
}

async function devSite(): Promise<DevSite> {
  const root = await mkdtemp(path.join(tmpdir(), 'geekity-wp-dev-mode-'));
  roots.push(root);
  const contentDir = path.join(root, 'content');
  const dataDir = path.join(root, 'data');
  mkdirSync(path.join(contentDir, '_data', 'federation', USER), { recursive: true });
  writeFileSync(
    path.join(contentDir, '_data', 'site.json'),
    `${JSON.stringify(
      {
        title: 'Blog',
        timezone: 'UTC',
        author: USER,
        webmentionsSend: true,
        notifyServer: 'https://rpc.example',
        indexNow: true,
        indexNowKey: '0123456789abcdef0123456789abcdef',
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(contentDir, '_data', 'federation', USER, 'followers.json'),
    `${JSON.stringify(
      [
        {
          actorId: 'https://remote.example/users/bob',
          inboxId: 'https://remote.example/users/bob/inbox',
          sharedInboxId: 'https://remote.example/inbox',
          handle: '@bob@remote.example',
          name: 'Bob',
          iconUrl: null,
          url: null,
          followedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      null,
      2,
    )}\n`,
  );
  writeUsers(dataDir, [{ username: USER, email: 'ada@blog.example' }]);
  seedActorKeys(dataDir, USER);

  const cms = createCms({
    dataDir,
    contentDir,
    baseUrl: SITE,
    port: 0,
    watch: true,
    devMode: true,
    federation: { queue: null, allowPrivateAddress: true },
    indexNow: { batchMs: 0, backoffMs: () => 0 },
    mail: { provider: createMemoryMailProvider(), backoffMs: () => 0 },
  });
  started.push(cms);
  await cms.serve();
  await cms.scheduler.start();
  await settle(cms);
  return { cms, root, contentDir, dataDir };
}

async function settle(cms: Cms): Promise<void> {
  await cms.scheduler.settled();
  await cms.delivery.settled();
  await cms.relays.settled();
  await cms.webmentions.settled();
  await cms.notifier.settled();
  await cms.indexNow.settled();
}

async function indexed(cms: Cms, slugs: readonly string[]): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!slugs.every((slug) => cms.store.getBySlug(slug) !== undefined)) {
    assert.ok(Date.now() < deadline, `the watcher indexed ${slugs.join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  await settle(cms);
}

async function held(dataDir: string): Promise<string[]> {
  const record = await readFile(path.join(dataDir, 'dev-mode.jsonl'), 'utf8');
  return record
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { type: string; kind?: string; what?: string })
    .filter((entry) => entry.type === 'held')
    .map((entry) => `${entry.kind ?? ''} ${entry.what ?? ''}`);
}

describe('the WordPress import into a running site in dev mode (TASK-291 #8)', () => {
  it('makes no outbound request and holds nothing, its comments included, while a new post would have been sent', async () => {
    const { cms, contentDir, dataDir } = await devSite();
    const site = pluginSite({
      admin: cms.admin,
      config: resolveConfig({ contentDir, dataDir, baseUrl: SITE }, { env: {} }),
    });

    await importWordPressContent({
      exported: parseWordPressExport(
        wxr([
          {
            id: 813,
            slug: 'announced',
            creator: USER,
            meta: [{ key: 'activitypub_status', value: 'federated' }],
            content: '<p>See <a href="https://linked.example/a-page/">a page</a>.</p>',
            comments: [
              { id: 1, type: 'like', meta: [{ key: 'protocol', value: 'activitypub' }] },
              {
                id: 2,
                content: 'A reply from the fediverse.',
                meta: [{ key: 'protocol', value: 'activitypub' }],
              },
              { id: 3, content: 'A comment left on WordPress.', authorEmail: 'ada@example.com' },
              { id: 4, parent: 3, content: 'An answer to it.', authorEmail: 'ada@example.com' },
              { id: 6, approved: '0', content: 'Held for moderation on WordPress.' },
              {
                id: 5,
                type: 'mention',
                content: 'A page that linked here.',
                meta: [
                  { key: 'protocol', value: 'webmention' },
                  { key: 'webmention_source_url', value: 'https://linker.example/post/' },
                ],
              },
            ],
          },
          { id: 609, slug: 'never-sent', creator: USER },
          { id: 20, type: 'page', slug: 'about', creator: USER, link: `${SITE}/about/` },
        ]),
      ),
      context: { args: [], options: {}, cwd: contentDir, site, write: () => undefined },
      data: pluginDataFolder(dataDir, '@geekity/plugin-wordpress'),
      importers: [postsAndPages, commentsAndReactions],
    });
    await indexed(cms, ['announced', 'never-sent', 'about']);

    assert.equal(cms.admin.listCommentsFor('announced').length, 6, 'the comments are on the post');
    assert.deepEqual(outbound, [], 'no request left the site');
    assert.deepEqual(await held(dataDir), [], 'nothing was held, since nothing was due');

    await writeFile(
      path.join(contentDir, 'posts', '2024-03-06-new.md'),
      `---\ntitle: New\ndate: '2024-03-06T10:00:00Z'\npermalink: /2024/03/new/\nauthor: ${USER}\n---\n\nNews.\n`,
    );
    await indexed(cms, ['new']);

    assert.deepEqual(outbound, []);
    assert.ok(
      (await held(dataDir)).includes(`activitypub Create ${SITE}/2024/03/new/`),
      'a post first published here was due to its followers, and dev mode held it',
    );
  });
});
