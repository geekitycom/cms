import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  atomFeed,
  commentsRssFeed,
  createCms,
  createConversation,
  createRenderer,
  defineConfig,
  feedComments,
  jsonFeed,
  listUsers,
  resolveConfig,
  rssFeed,
  siteIcons,
  siteImageMarkup,
  spokenIn,
} from './index.ts';
import type { Cms } from './index.ts';
import { addComment } from './testing.ts';
import { SITE } from './site/namespace.ts';

const BASE_URL = 'https://geekity.example';
const PERMALINK = '/2026/01/release-one/';

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

async function releaseSite(): Promise<Cms> {
  const contentDir = await temporaryDir('geekity-uses-content-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, 'posts', '2026-01-01-release-one.md'),
    `---\ntitle: Release one\ndate: '2026-01-01T09:00:00Z'\npermalink: ${PERMALINK}\ntags: [releases]\n---\n\nIt shipped.\n`,
  );
  const cms = createCms(
    defineConfig({
      baseUrl: BASE_URL,
      contentDir,
      dataDir: await temporaryDir('geekity-uses-data-'),
      watch: false,
    }),
  );
  started.push(cms);
  await cms.sync();
  await addComment(
    { admin: cms.admin, contentDir, dataDir: cms.config.dataDir },
    {
      slug: 'release-one',
      permalink: PERMALINK,
      source: 'comment',
      kind: 'reply',
      status: 'approved',
      author: { name: 'Ada', url: null, email: 'ada@example.com', avatar: null },
      content: { markdown: 'Congratulations.', html: '<p>Congratulations.</p>\n' },
      submitted: '2026-01-02T10:00:00.000Z',
      addressHash: 'deadbeefcafe',
      notify: false,
      inReplyTo: null,
      url: null,
    },
  );
  return cms;
}

describe('the feed builders, as docs/feeds.md uses them', () => {
  it('writes a feed of one tag in all three formats', async () => {
    const cms = await releaseSite();
    const site = createRenderer({ config: cms.config }).site();

    const source = {
      site,
      users: listUsers(cms.config.dataDir),
      documents: cms.store.listByTag('releases', { limit: 20 }),
      title: `${site.title}: releases`,
      href: '/tag/releases/',
      feedHref: '/tag/releases/feed/',
      baseUrl: cms.config.baseUrl,
    };

    assert.match(rssFeed(source), /<title>Release one<\/title>/);
    assert.match(atomFeed(source), /<title[^>]*>Release one<\/title>/);
    assert.deepEqual(
      jsonFeed(source).items.map((item) => item.url),
      [`${BASE_URL}${PERMALINK}`],
    );
  });

  it('writes a comments feed from the conversation reader', async () => {
    const cms = await releaseSite();
    const site = createRenderer({ config: cms.config }).site();
    const conversation = createConversation({
      admin: cms.admin,
      store: cms.store,
      contentDir: cms.config.contentDir,
      baseUrl: cms.config.baseUrl,
      users: () => listUsers(cms.config.dataDir),
    });
    const settings = await cms.settings.values(SITE);
    const options = {
      baseUrl: cms.config.baseUrl,
      limit: 20,
      cited: (url: string) => cms.replyContexts.read(url, settings),
    };

    const siteWide = commentsRssFeed({
      site,
      comments: feedComments(conversation.latest(20, settings), options),
      title: `${site.title}: comments`,
      href: '/',
      feedHref: '/comments/feed/',
      baseUrl: cms.config.baseUrl,
    });
    const post = cms.store.getByPermalink(PERMALINK);
    assert.ok(post);
    const onePost = feedComments(spokenIn(conversation.thread(post, settings)), {
      ...options,
      post,
    });

    assert.match(siteWide, /Congratulations\./);
    assert.deepEqual(
      onePost.map((comment) => comment.author),
      ['Ada'],
    );
  });
});

describe('the image helpers, as docs/media.md lists them', () => {
  it('links no icon and leaves markup alone when the site has neither', () => {
    const config = resolveConfig({ baseUrl: BASE_URL });
    const html = '<p><img src="https://elsewhere.example/a.png" alt="A"></p>';

    assert.deepEqual(siteIcons(config, undefined), []);
    assert.equal(siteImageMarkup(config, html), html);
  });
});
