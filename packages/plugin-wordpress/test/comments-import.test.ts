import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  addComment,
  createCms,
  deleteComment,
  openAdminStore,
  pluginDataFolder,
  pluginSite,
  resolveConfig,
  updateComment,
} from '@geekity/cms';
import type { Cms } from '@geekity/cms';
import type { PluginCommandContext } from '@geekity/cms/plugin';

import { commentsAndReactions } from '../src/comments-import.ts';
import { importWordPressContent } from '../src/content-import.ts';
import type { ReportRow } from '../src/content-import.ts';
import { postsAndPages } from '../src/posts-import.ts';
import { parseWordPressExport } from '../src/wxr.ts';
import { SITE, wxr } from './wxr.ts';
import type { TestComment, TestItem } from './wxr.ts';

type AdminStore = ReturnType<typeof openAdminStore>;

const roots: string[] = [];
const stores: AdminStore[] = [];
const started: Cms[] = [];

after(async () => {
  for (const cms of started) await cms.close();
  for (const store of stores) store.close();
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

interface Site {
  readonly root: string;
  readonly contentDir: string;
  readonly dataDir: string;
  readonly admin: AdminStore;
  run(items: readonly TestItem[]): Promise<readonly ReportRow[]>;
  comments(slugFile: string): Promise<CommentEntry[]>;
  serve(): Promise<Cms>;
}

interface CommentEntry {
  id: string;
  source: string;
  kind: string;
  status: string;
  author: { name: string; url: string | null; avatar: string | null; email?: string };
  content: { markdown: string; html: string };
  submitted: string;
  addressHash: string | null;
  inReplyTo: string | null;
  url: string | null;
}

async function site(): Promise<Site> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geekity-wp-comments-'));
  roots.push(root);
  const contentDir = path.join(root, 'content');
  const dataDir = path.join(root, 'data');
  await fs.mkdir(path.join(contentDir, '_data'), { recursive: true });
  await fs.writeFile(
    path.join(contentDir, '_data', 'site.json'),
    `${JSON.stringify({ title: 'Blog', timezone: 'UTC' }, null, 2)}\n`,
  );
  const config = resolveConfig({ contentDir, dataDir, baseUrl: SITE }, { env: {} });
  const admin = openAdminStore({ dataDir });
  stores.push(admin);
  const context: PluginCommandContext = {
    args: [],
    options: {},
    cwd: root,
    site: pluginSite({ admin, config }),
    write: () => undefined,
  };
  const data = pluginDataFolder(dataDir, '@geekity/plugin-wordpress');

  return {
    root,
    contentDir,
    dataDir,
    admin,
    run: async (items) =>
      (
        await importWordPressContent({
          exported: parseWordPressExport(wxr(items)),
          context,
          data,
          importers: [postsAndPages, commentsAndReactions],
        })
      ).rows,
    comments: async (slugFile) =>
      (
        JSON.parse(
          await fs.readFile(path.join(contentDir, '_data', 'comments', slugFile), 'utf8'),
        ) as { comments: CommentEntry[] }
      ).comments,
    serve: async () => {
      const cms = createCms({ contentDir, dataDir, baseUrl: SITE, watch: false });
      started.push(cms);
      await cms.sync();
      return cms;
    },
  };
}

const AP = { key: 'protocol', value: 'activitypub' };
const WEBMENTION = { key: 'protocol', value: 'webmention' };

function apReaction(id: number, type: string, name: string): TestComment {
  return {
    id,
    type,
    author: name,
    authorUrl: `https://mstdn.example/@${name.toLowerCase()}`,
    authorEmail: `${name.toLowerCase()}@mstdn.example`,
    content: type === 'like' ? '… liked this!' : '… reposted this!',
    meta: [
      { key: 'source_id', value: `https://mstdn.example/users/${name}#${type}s/${String(id)}` },
      AP,
    ],
  };
}

function webmention(id: number, type: string, source: string, content: string): TestComment {
  return {
    id,
    type,
    author: `Author of ${String(id)}`,
    authorUrl: new URL(source).origin,
    authorEmail: '',
    content,
    meta: [
      WEBMENTION,
      { key: 'webmention_source_url', value: source },
      { key: 'webmention_target_url', value: `${SITE}/2024/03/i-%e2%99%a5-rss/` },
    ],
  };
}

const THE_POST: TestItem = {
  id: 753,
  slug: 'i-%e2%99%a5-rss',
  title: 'I ♥ RSS',
  meta: [{ key: 'activitypub_status', value: 'federated' }],
  comments: [
    apReaction(1, 'like', 'One'),
    apReaction(2, 'like', 'Two'),
    {
      id: 3,
      type: 'like',
      author: 'feedle',
      authorUrl: 'https://bsky.app/profile/feedle.world',
      authorEmail: '',
      content: '… liked this!',
      meta: [
        { key: 'source_id', value: 'at://did:plc:abc/app.bsky.feed.like/1' },
        { key: 'source_url', value: '' },
      ],
    },
    apReaction(4, 'repost', 'Four'),
    apReaction(5, 'repost', 'Five'),
    webmention(6, 'repost', 'https://geoff.example/2024/03/i-rss/', 'Just another nerd.'),
    {
      id: 7,
      type: 'comment',
      author: 'Ada',
      authorUrl: 'https://ada.example/',
      authorEmail: 'ada@example.com',
      content: `Lovely.\n\nSee <a href="${SITE}/wp-content/uploads/2024/03/pic-1024x575.jpg">my picture</a>.`,
      dateGmt: '2024-03-06 10:00:00',
    },
    {
      id: 8,
      parent: 7,
      type: 'comment',
      author: 'Weldon',
      content: '<p><a href="https://ada.example/">@ada</a> Agreed.</p>',
      dateGmt: '2024-03-06 11:00:00',
      meta: [
        AP,
        { key: 'source_id', value: 'https://mstdn.example/users/weldon/statuses/1' },
        { key: 'source_url', value: 'https://mstdn.example/@weldon/1' },
      ],
    },
    webmention(9, 'mention', 'https://ki48.example/i-rss/', 'I ♥ RSS, a directory'),
    webmention(10, 'bookmark', 'https://aneesh.example/bookmarked/', 'Bookmarked: I ♥ RSS'),
    {
      id: 11,
      type: 'pingback',
      author: 'My comments',
      authorUrl: 'https://comments.example/2024/03/237/',
      authorEmail: '',
      content: '[&#8230;] to Andrew Shell, I can post [&#8230;]',
    },
    { id: 12, type: 'comment', approved: 'spam', author: 'Spammer', content: 'Buy things.' },
    { id: 13, type: 'comment', approved: 'trash', author: 'Binned', content: 'Gone.' },
    { id: 14, type: 'comment', approved: '0', author: 'Waiting', content: 'Held for moderation.' },
  ],
};

const FILE = 'i-%E2%99%A5-rss.json';
const id = (n: number) => `${SITE}/?p=753#comment-${String(n)}`;

function rowsWhy(rows: readonly ReportRow[]): string[] {
  return rows.filter((row) => row.item.id === 753 && row.path !== undefined).map((row) => row.why);
}

describe('the comments and reactions import', () => {
  it('writes each comment to the post’s comment file in the site’s shape, an email only to data/', async () => {
    const wp = await site();
    await wp.run([THE_POST]);

    const comments = await wp.comments(FILE);
    const ada = comments.find((comment) => comment.id === id(7));
    assert.deepEqual(ada, {
      id: id(7),
      source: 'comment',
      kind: 'reply',
      status: 'approved',
      author: { name: 'Ada', url: 'https://ada.example/', avatar: null },
      content: {
        markdown: `Lovely.\n\nSee [my picture](${SITE}/uploads/2024/03/pic-1024x575.jpg).`,
        html: `<p>Lovely.</p>\n<p>See <a href="${SITE}/uploads/2024/03/pic-1024x575.jpg" rel="nofollow ugc">my picture</a>.</p>\n`,
      },
      submitted: '2024-03-06T10:00:00.000Z',
      addressHash: null,
      inReplyTo: null,
      url: null,
    });

    const published = await fs.readFile(
      path.join(wp.contentDir, '_data', 'comments', FILE),
      'utf8',
    );
    assert.doesNotMatch(published, /@example\.com|@mstdn\.example"/, 'no email under content/');
    const emails = JSON.parse(
      await fs.readFile(path.join(wp.dataDir, 'comments', FILE), 'utf8'),
    ) as { comments: Record<string, { email: string }> };
    assert.deepEqual(Object.keys(emails.comments), [id(7), id(14)]);
    assert.equal(emails.comments[id(7)]?.email, 'ada@example.com');
  });

  it('maps each comment type to the kind and source the site shows, keeping the remote URL and author', async () => {
    const wp = await site();
    await wp.run([THE_POST]);

    const mapped = (await wp.comments(FILE)).map((comment) => [
      comment.id.replace(`${SITE}/?p=753#comment-`, ''),
      comment.source,
      comment.kind,
      comment.author.name,
      comment.author.url,
      comment.url,
    ]);
    assert.deepEqual(mapped, [
      ['1', 'activitypub', 'like', 'One', 'https://mstdn.example/@one', null],
      ['2', 'activitypub', 'like', 'Two', 'https://mstdn.example/@two', null],
      ['3', 'webmention', 'like', 'feedle', 'https://bsky.app/profile/feedle.world', null],
      ['4', 'activitypub', 'boost', 'Four', 'https://mstdn.example/@four', null],
      ['5', 'activitypub', 'boost', 'Five', 'https://mstdn.example/@five', null],
      [
        '6',
        'webmention',
        'repost',
        'Author of 6',
        'https://geoff.example',
        'https://geoff.example/2024/03/i-rss/',
      ],
      ['7', 'comment', 'reply', 'Ada', 'https://ada.example/', null],
      [
        '8',
        'activitypub',
        'reply',
        'Weldon',
        'https://mstdn.example/@weldon',
        'https://mstdn.example/@weldon/1',
      ],
      [
        '9',
        'webmention',
        'mention',
        'Author of 9',
        'https://ki48.example',
        'https://ki48.example/i-rss/',
      ],
      [
        '10',
        'webmention',
        'mention',
        'Author of 10',
        'https://aneesh.example',
        'https://aneesh.example/bookmarked/',
      ],
      [
        '11',
        'webmention',
        'mention',
        'My comments',
        'https://comments.example/2024/03/237/',
        'https://comments.example/2024/03/237/',
      ],
      ['14', 'comment', 'reply', 'Waiting', 'https://mstdn.example/@weldon', null],
    ]);
    const like = (await wp.comments(FILE))[0];
    assert.equal(like?.content.markdown, '', 'a like says nothing, as one the site receives');
  });

  it('keeps a threaded reply under the comment it answers', async () => {
    const wp = await site();
    await wp.run([THE_POST]);

    const reply = (await wp.comments(FILE)).find((comment) => comment.id === id(8));
    assert.equal(reply?.inReplyTo, id(7));
  });

  it('leaves out spam and trash, and imports a held comment as pending', async () => {
    const wp = await site();
    const rows = await wp.run([THE_POST]);

    const comments = await wp.comments(FILE);
    assert.ok(!comments.some((comment) => comment.id === id(12) || comment.id === id(13)));
    assert.equal(comments.find((comment) => comment.id === id(14))?.status, 'pending');
    assert.ok(
      rows.some(
        (row) => row.outcome === 'skipped' && /comment 12: spam on WordPress/.test(row.why),
      ),
      `the spam is in the report: ${rowsWhy(rows).join('\n')}`,
    );
    assert.ok(
      rows.some(
        (row) => row.outcome === 'skipped' && /comment 13: in the WordPress trash/.test(row.why),
      ),
    );
  });

  it('shows the post with the reaction counts WordPress showed', async () => {
    const wp = await site();
    await wp.run([THE_POST]);
    const cms = await wp.serve();

    const response = await cms.app.request('/2024/03/i-%E2%99%A5-rss/');
    assert.equal(response.status, 200);
    const page = await response.text();
    const count = (label: string) =>
      new RegExp(`${label} <span class="reaction-count">(\\d+)</span>`).exec(page)?.[1];

    assert.deepEqual(
      {
        likes: count('Likes'),
        reposts: count('Boosts'),
        mentions: count('Mentions'),
        comments: /<h2 class="comments-title">([^<]*)<\/h2>/.exec(page)?.[1],
      },
      { likes: '3', reposts: '3', mentions: '3', comments: '2 replies' },
    );
  });

  it('keeps the id WordPress’s comments feed published, so a feed reader sees nothing new', async () => {
    const wp = await site();
    await wp.run([THE_POST]);
    const cms = await wp.serve();

    const guids = async (feed: string) =>
      new Set(
        [
          ...(await (await cms.app.request(feed)).text()).matchAll(
            /<guid isPermaLink="false">([^<]*)<\/guid>/g,
          ),
        ].map((match) => match[1]),
      );
    assert.deepEqual(
      await guids('/2024/03/i-%E2%99%A5-rss/feed/'),
      new Set([7, 8, 9, 10, 11].map(id)),
    );
    assert.deepEqual(
      await guids('/comments/feed/'),
      new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(id)),
    );
  });

  it('leaves no approved comment pending, so the moderation queue holds only what WordPress held', async () => {
    const wp = await site();
    await wp.run([{ ...THE_POST, comments: THE_POST.comments?.filter((c) => c.id !== 14) ?? [] }]);
    const cms = await wp.serve();

    assert.deepEqual(cms.admin.listComments({ status: 'pending' }), []);
    assert.equal(cms.admin.listComments({ status: 'approved' }).length, 11);
  });

  it('writes the same bytes on a second run over the same export', async () => {
    const wp = await site();
    await wp.run([THE_POST]);
    const snapshot = async () => {
      const files: Record<string, string> = {};
      for (const dir of [wp.contentDir, wp.dataDir]) {
        for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile() || entry.name.endsWith('.db') || entry.name.includes('.db-'))
            continue;
          const file = path.join(entry.parentPath, entry.name);
          files[path.relative(wp.root, file)] = await fs.readFile(file, 'utf8');
        }
      }
      return files;
    };
    const first = await snapshot();

    const rows = await wp.run([THE_POST]);

    assert.deepEqual(await snapshot(), first);
    assert.ok(
      rows
        .filter((row) => row.path?.startsWith('_data/comments/'))
        .every((row) => row.outcome === 'unchanged'),
    );
  });

  it('merges a newer export by comment id, leaving the site’s own comments and edits alone (TASK-291 #10)', async () => {
    const wp = await site();
    await wp.run([THE_POST]);
    const records = { admin: wp.admin, contentDir: wp.contentDir, dataDir: wp.dataDir };
    const live = await addComment(records, {
      slug: 'i-♥-rss',
      permalink: '/2024/03/i-♥-rss/',
      source: 'comment',
      kind: 'reply',
      status: 'approved',
      author: { name: 'Live', url: null, email: null, avatar: null },
      content: { markdown: 'Said here.', html: '<p>Said here.</p>\n' },
      submitted: '2024-04-01T10:00:00.000Z',
      addressHash: 'hash',
      inReplyTo: null,
      url: null,
      notify: false,
    });
    await updateComment(records, id(9), { status: 'spam' });
    const before = await wp.comments(FILE);

    const comments = THE_POST.comments ?? [];
    const rows = await wp.run([
      {
        ...THE_POST,
        comments: [
          ...comments.map((comment) =>
            comment.id === 9 || comment.id === 8
              ? { ...comment, content: 'Edited on WordPress.' }
              : comment,
          ),
          apReaction(15, 'like', 'Fifteen'),
        ],
      },
    ]);

    const after = await wp.comments(FILE);
    assert.deepEqual(
      after.map((comment) => comment.id),
      [...before.map((comment) => comment.id), id(15)],
      'the new like is added after everything, and nothing moved',
    );
    assert.deepEqual(
      after.find((comment) => comment.id === live.id),
      before.find((comment) => comment.id === live.id),
    );
    assert.equal(
      after.find((comment) => comment.id === id(9))?.status,
      'spam',
      'the moderator’s call stands',
    );
    assert.equal(
      after.find((comment) => comment.id === id(8))?.content.markdown,
      'Edited on WordPress.',
      'an edit made on WordPress to a comment this site left alone is picked up',
    );
    const outcomes = Object.fromEntries(
      rows
        .filter((row) => row.path?.startsWith('_data/comments/'))
        .map((row) => [/comment (\d+)/.exec(row.why)?.[1], row.outcome]),
    );
    assert.equal(outcomes['15'], 'written');
    assert.equal(outcomes['8'], 'written');
    assert.equal(outcomes['9'], 'conflict');
    assert.equal(outcomes['7'], 'unchanged');
  });

  it('does not bring back an imported comment a moderator deleted', async () => {
    const wp = await site();
    await wp.run([THE_POST]);
    const records = { admin: wp.admin, contentDir: wp.contentDir, dataDir: wp.dataDir };
    await deleteComment(records, id(11));

    const rows = await wp.run([THE_POST]);

    assert.ok(!(await wp.comments(FILE)).some((comment) => comment.id === id(11)));
    assert.equal(rows.find((row) => /comment 11\b/.test(row.why))?.outcome, 'kept');
  });

  it('skips a comment on a post the import leaves out, naming it', async () => {
    const wp = await site();
    const rows = await wp.run([
      {
        id: 5,
        status: 'trash',
        slug: 'binned',
        comments: [{ id: 50, content: 'On a binned post.' }],
      },
    ]);

    await assert.rejects(fs.readdir(path.join(wp.contentDir, '_data', 'comments')));
    assert.ok(rows.some((row) => row.outcome === 'skipped' && /comment 50/.test(row.why)));
  });
});
