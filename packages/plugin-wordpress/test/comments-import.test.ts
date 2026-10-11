import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  addComment,
  createCms,
  createUser,
  deleteComment,
  intakeComment,
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
  migrated?: true;
  origin?: string;
  user?: string;
  actor?: string;
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
const PERMALINK = '/2024/03/i-♥-rss/';
const hex = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const formerId = (n: number) => `${SITE}/?p=753#comment-${String(n)}`;
const ORIGINS: Readonly<Record<number, { source: 'activitypub' | 'webmention'; origin: string }>> =
  {
    1: { source: 'activitypub', origin: 'https://mstdn.example/users/One#likes/1' },
    2: { source: 'activitypub', origin: 'https://mstdn.example/users/Two#likes/2' },
    3: { source: 'webmention', origin: 'at://did:plc:abc/app.bsky.feed.like/1' },
    4: { source: 'activitypub', origin: 'https://mstdn.example/users/Four#reposts/4' },
    5: { source: 'activitypub', origin: 'https://mstdn.example/users/Five#reposts/5' },
    6: { source: 'webmention', origin: 'https://geoff.example/2024/03/i-rss/' },
    8: { source: 'activitypub', origin: 'https://mstdn.example/users/weldon/statuses/1' },
    9: { source: 'webmention', origin: 'https://ki48.example/i-rss/' },
    10: { source: 'webmention', origin: 'https://aneesh.example/bookmarked/' },
    11: { source: 'webmention', origin: 'https://comments.example/2024/03/237/' },
    15: { source: 'activitypub', origin: 'https://mstdn.example/users/Fifteen#likes/15' },
  };
/** The key decision-51 gives comment N on THE_POST, worked out here rather than by the code under test. */
const id = (n: number) => {
  const known = ORIGINS[n];
  if (known === undefined) return hex(formerId(n));
  return known.source === 'webmention' ? hex(`${known.origin} ${PERMALINK}`) : hex(known.origin);
};
const numbered = new Map(Array.from({ length: 20 }, (_, n) => [id(n), String(n)]));

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
      migrated: true,
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
      numbered.get(comment.id),
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

  it('prints a lowercase-escaped WordPress permalink with uppercase escapes, as the README says', async () => {
    const wp = await site();
    await createUser({ dataDir: wp.dataDir, username: 'ada', password: 'correct horse battery' });
    await wp.run([THE_POST]);
    const cms = await wp.serve();
    const upper = `${SITE}/2024/03/i-%E2%99%A5-rss/`;
    const lower = `${SITE}/2024/03/i-%e2%99%a5-rss/`;
    const body = async (url: string, accept = 'text/html') => {
      const response = await cms.app.request(url, { headers: { accept } });
      assert.equal(response.status, 200, url);
      return response.text();
    };
    const page = await body('/2024/03/i-%E2%99%A5-rss/');
    const activity = JSON.parse(
      await body('/2024/03/i-%E2%99%A5-rss/', 'application/activity+json'),
    ) as { url?: unknown };
    const surfaces = {
      rss: await body('/feed/'),
      atom: await body('/feed/atom/'),
      json: await body('/feed/json/'),
      sitemap: await body('/sitemap.xml'),
      canonical: /<link rel="canonical" href="([^"]*)">/.exec(page)?.[1] ?? '',
      ogUrl: /<meta property="og:url" content="([^"]*)">/.exec(page)?.[1] ?? '',
      activityUrl: String(activity.url),
    };

    for (const [surface, text] of Object.entries(surfaces)) {
      assert.ok(text.includes(upper), `${surface} names ${upper}`);
      assert.ok(!text.includes(lower), `${surface} never names ${lower}`);
    }
    for (const spelling of ['/2024/03/i-%E2%99%A5-rss/', '/2024/03/i-%e2%99%a5-rss/']) {
      const response = await cms.app.request(spelling);
      assert.equal(response.status, 200, `${spelling} answers without a redirect`);
    }
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

  it('marks every comment migrated, keeps its origin, and keys it as the site would key it arriving here', async () => {
    const wp = await site();
    await wp.run([THE_POST]);
    const cms = await wp.serve();

    const stored = (await wp.comments(FILE)).map((comment) => [
      numbered.get(comment.id),
      comment.migrated,
      comment.origin,
    ]);
    assert.deepEqual(
      stored,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14].map((n) => [String(n), true, ORIGINS[n]?.origin]),
    );
    const permalink = cms.store.getBySlug('i-♥-rss')?.permalink;
    assert.equal(permalink, PERMALINK, 'a webmention is keyed by the permalink the site serves');
  });

  describe('a fediverse comment’s actor (TASK-338)', () => {
    const PICTURE = 'https://files.mstdn.example/avatars/one.png';
    const LINKED = 'https://tags.example/user/news/icon';

    function actorItem(id: number, actor: Record<string, unknown>): TestItem {
      return {
        id,
        type: 'ap_actor',
        status: 'publish',
        guid: String(actor['id']),
        content: JSON.stringify({ '@context': 'https://www.w3.org/ns/activitystreams', ...actor }),
      };
    }

    function byActor(comment: TestComment, actorPost: number): TestComment {
      return {
        ...comment,
        meta: [
          ...(comment.meta ?? []),
          { key: '_activitypub_remote_actor_id', value: String(actorPost) },
        ],
      };
    }

    const ACTORS: readonly TestItem[] = [
      actorItem(900, {
        id: 'https://mstdn.example/users/One',
        type: 'Person',
        icon: { type: 'Image', mediaType: 'image/png', url: PICTURE },
      }),
      actorItem(901, {
        id: 'https://tags.example/user/news',
        type: 'Service',
        icon: { type: 'Link', href: LINKED },
      }),
      actorItem(902, { id: 'https://mstdn.example/users/Two', type: 'Person' }),
      { id: 903, type: 'ap_actor', status: 'publish', content: 'not json' },
    ];

    const POST: TestItem = {
      ...THE_POST,
      comments: [
        byActor(apReaction(1, 'like', 'One'), 900),
        byActor(apReaction(4, 'repost', 'Four'), 901),
        byActor(apReaction(2, 'like', 'Two'), 902),
        byActor(apReaction(5, 'repost', 'Five'), 999),
        byActor(apReaction(15, 'like', 'Fifteen'), 903),
      ],
    };

    async function imported(): Promise<{ wp: Site; byNumber: Map<string, CommentEntry> }> {
      const wp = await site();
      await wp.run([...ACTORS, POST]);
      const comments = await wp.comments(FILE);
      return {
        wp,
        byNumber: new Map(comments.map((comment) => [numbered.get(comment.id) ?? '', comment])),
      };
    }

    it('writes the avatar and the id of the actor its _activitypub_remote_actor_id names', async () => {
      const { byNumber } = await imported();
      const one = byNumber.get('1');
      const four = byNumber.get('4');
      assert.equal(one?.author.avatar, PICTURE, 'an Image icon by its url');
      assert.equal(one?.actor, 'https://mstdn.example/users/One');
      assert.equal(four?.author.avatar, LINKED, 'a Link icon by its href');
      assert.equal(four?.actor, 'https://tags.example/user/news');
      assert.equal(byNumber.get('2')?.author.avatar, null, 'an actor with no icon gives none');
      assert.equal(byNumber.get('2')?.actor, 'https://mstdn.example/users/Two');
    });

    it('imports a comment whose actor is missing or unreadable as before, with no avatar', async () => {
      const { byNumber } = await imported();
      for (const n of ['5', '15']) {
        const comment = byNumber.get(n);
        assert.ok(comment, `comment ${n} is imported`);
        assert.equal(comment.author.avatar, null);
        assert.equal(comment.actor, undefined);
        assert.equal(comment.author.name, n === '5' ? 'Five' : 'Fifteen');
      }
    });

    it('gives a comment the site has since moderated its actor and leaves the rest', async () => {
      const wp = await site();
      await wp.run([POST]);
      const records = { admin: wp.admin, contentDir: wp.contentDir, dataDir: wp.dataDir };
      await updateComment(records, id(1), { status: 'spam' });

      await wp.run([...ACTORS, POST]);

      const one = (await wp.comments(FILE)).find((comment) => comment.id === id(1));
      assert.equal(one?.status, 'spam');
      assert.equal(one?.actor, 'https://mstdn.example/users/One');
    });

    it('shows the actors’ avatars on the post through the avatar cache', async () => {
      const { wp } = await imported();
      const cms = await wp.serve();
      const page = await (await cms.app.request('/2024/03/i-%E2%99%A5-rss/')).text();
      const cached = (source: string) =>
        `/_geekity/avatars/${Buffer.from(source, 'utf8').toString('base64url')}`;

      assert.ok(page.includes(`src="${cached(PICTURE)}"`), 'the like’s face is the cached picture');
      assert.ok(page.includes(`src="${cached(LINKED)}"`), 'and so is the boost’s');
      assert.ok(!page.includes(PICTURE), 'the remote URL is never printed');
      assert.ok(cms.admin.isAvatarSource(PICTURE), 'the cache will fetch it');
    });
  });

  it('names the site user a comment was written by when signed in to WordPress', async () => {
    const signedIn = (id: number, userId: number): TestComment => ({
      id,
      type: 'comment',
      author: 'ada',
      authorUrl: 'https://ada.example/',
      authorEmail: 'ada@blog.example',
      content: 'Thanks.',
      userId,
    });
    const post: TestItem = {
      ...THE_POST,
      comments: [signedIn(16, 2), signedIn(17, 3), { ...signedIn(18, 0), author: 'Visitor' }],
    };

    const without = await site();
    await without.run([post]);
    assert.deepEqual(
      (await without.comments(FILE)).map((comment) => comment.user),
      [undefined, undefined, undefined],
      'no site user ada, so nobody is named',
    );

    const wp = await site();
    await createUser({ dataDir: wp.dataDir, username: 'ada', password: 'correct horse battery' });
    await wp.run([post]);
    assert.deepEqual(
      (await wp.comments(FILE)).map((comment) => [numbered.get(comment.id), comment.user]),
      [
        ['16', 'ada'],
        ['17', undefined],
        ['18', undefined],
      ],
      'WordPress user 2 is ada; user 3 is no author in the export; 0 is a visitor',
    );

    await createUser({
      dataDir: without.dataDir,
      username: 'ada',
      password: 'correct horse battery',
    });
    const records = {
      admin: without.admin,
      contentDir: without.contentDir,
      dataDir: without.dataDir,
    };
    await updateComment(records, id(16), { status: 'spam' });
    await without.run([post]);
    const rerun = await without.comments(FILE);
    assert.deepEqual(
      rerun.map((comment) => [numbered.get(comment.id), comment.user, comment.status]),
      [
        ['16', 'ada', 'spam'],
        ['17', undefined, 'approved'],
        ['18', undefined, 'approved'],
      ],
      'a rerun once the user exists names them, even on a comment a moderator changed',
    );
  });

  it('takes a webmention sent again for an imported one as the comment it holds', async () => {
    const wp = await site();
    await wp.run([THE_POST]);
    const cms = await wp.serve();
    const before = await wp.comments(FILE);

    const outcome = await intakeComment({
      records: { admin: cms.admin, contentDir: wp.contentDir, dataDir: wp.dataDir },
      origin: 'webmention',
      comment: {
        slug: 'i-♥-rss',
        permalink: PERMALINK,
        source: 'webmention',
        kind: 'mention',
        author: { name: 'Author of 9', url: 'https://ki48.example', email: null, avatar: null },
        content: { markdown: 'I ♥ RSS, a directory', html: '<p>I ♥ RSS, a directory</p>\n' },
        submitted: '2024-03-07T10:00:00.000Z',
        inReplyTo: null,
        url: 'https://ki48.example/i-rss/',
        notify: false,
      },
      dataDir: wp.dataDir,
      baseUrl: SITE,
    });

    assert.equal(outcome.kind, 'stored');
    assert.ok(outcome.kind === 'stored' && !outcome.created, 'no second record');
    assert.equal(outcome.kind === 'stored' && outcome.comment.id, id(9));
    const after = await wp.comments(FILE);
    assert.deepEqual(
      after.map((comment) => comment.id),
      before.map((comment) => comment.id),
    );
    assert.equal(after.find((comment) => comment.id === id(9))?.migrated, true);
  });

  it('puts no imported comment in the comments feeds, though the post still shows them', async () => {
    const wp = await site();
    await wp.run([THE_POST]);
    const cms = await wp.serve();

    const page = await (await cms.app.request('/2024/03/i-%E2%99%A5-rss/')).text();
    assert.match(page, new RegExp(`id="comment-${id(7)}"`));
    assert.match(page, new RegExp(`id="comment-${id(8)}"`));
    for (const feed of ['/comments/feed/', '/2024/03/i-%E2%99%A5-rss/feed/']) {
      const response = await cms.app.request(feed);
      assert.equal(response.status, 200, feed);
      const text = await response.text();
      assert.doesNotMatch(text, /<item>/, `${feed} holds no item`);
      assert.doesNotMatch(
        text,
        /Lovely|Agreed|Held for moderation/,
        `${feed} says nothing imported`,
      );
    }
  });

  it('carries a 0.2.0 import across a boot and a re-import with one record per comment', async () => {
    const wp = await site();
    await wp.run([THE_POST]);
    await asImportedBy020(wp);
    const booted = await wp.serve();
    const records = { admin: booted.admin, contentDir: wp.contentDir, dataDir: wp.dataDir };
    const native = await addComment(records, {
      slug: 'i-♥-rss',
      permalink: PERMALINK,
      source: 'comment',
      kind: 'reply',
      status: 'approved',
      author: { name: 'Live', url: null, email: 'live@example.com', avatar: null },
      content: { markdown: 'Said here.', html: '<p>Said here.</p>\n' },
      submitted: '2024-04-01T10:00:00.000Z',
      addressHash: null,
      inReplyTo: hex(formerId(8)),
      url: null,
      notify: true,
    });
    await updateComment(records, hex(formerId(9)), { status: 'spam' });

    const rows = await wp.run([THE_POST]);

    const imported = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14];
    const after = await wp.comments(FILE);
    assert.deepEqual(
      after.map((comment) => comment.id),
      [...imported.map(id), native.id],
      'each comment once, in its place, under its key',
    );
    assert.ok(after.slice(0, -1).every((comment) => comment.migrated === true));
    assert.deepEqual(
      after.map((comment) => comment.origin),
      [...imported.map((n) => ORIGINS[n]?.origin), undefined],
    );
    assert.equal(after.find((comment) => comment.id === id(8))?.inReplyTo, id(7));
    assert.equal(after.at(-1)?.inReplyTo, id(8), 'a reply here follows the comment it answers');
    assert.equal(after.find((comment) => comment.id === id(9))?.status, 'spam');
    const emails = JSON.parse(
      await fs.readFile(path.join(wp.dataDir, 'comments', FILE), 'utf8'),
    ) as { comments: Record<string, { email: string }> };
    assert.deepEqual(Object.keys(emails.comments).sort(), [id(7), id(14), native.id].sort());

    const outcomes = Object.fromEntries(
      rows
        .filter((row) => row.path?.startsWith('_data/comments/'))
        .map((row) => [/comment (\d+)/.exec(row.why)?.[1], row.outcome]),
    );
    assert.deepEqual(
      outcomes,
      Object.fromEntries(imported.map((n) => [String(n), n === 9 ? 'conflict' : 'written'])),
    );
    const record = JSON.parse(
      await fs.readFile(
        path.join(wp.dataDir, 'plugins', '@geekity', 'plugin-wordpress', 'import.json'),
        'utf8',
      ),
    ) as { comments: Record<string, Record<string, string>> };
    assert.deepEqual(
      Object.keys(record.comments[`_data/comments/${FILE}`] ?? {}).sort(),
      imported.map(id).sort(),
    );

    const again = await wp.run([THE_POST]);
    assert.deepEqual(await wp.comments(FILE), after, 'a third run changes nothing');
    assert.ok(
      again
        .filter((row) => row.path?.startsWith('_data/comments/'))
        .every((row) => row.outcome === (/comment 9\b/.test(row.why) ? 'conflict' : 'unchanged')),
    );
    const cms = await wp.serve();
    assert.equal(cms.admin.listCommentsFor('i-♥-rss').length, imported.length + 1);
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

/**
 * Turn what this version's import wrote into what plugin-wordpress 0.2.0
 * wrote: each comment's id its WordPress URL, a reply naming its parent's,
 * no migrated flag or origin, and the record keyed by those ids with the hash
 * of each comment as written.
 */
async function asImportedBy020(wp: Site): Promise<void> {
  const formerOf = (key: string | null) =>
    key === null ? null : formerId(Number(numbered.get(key)));
  const published = path.join(wp.contentDir, '_data', 'comments', FILE);
  const file = JSON.parse(await fs.readFile(published, 'utf8')) as {
    post: string;
    comments: Record<string, unknown>[];
  };
  const old = file.comments.map(({ migrated: _migrated, origin: _origin, ...comment }) => ({
    ...comment,
    id: formerOf(comment['id'] as string),
    inReplyTo: formerOf(comment['inReplyTo'] as string | null),
  }));
  await fs.writeFile(published, `${JSON.stringify({ ...file, comments: old }, null, 2)}\n`);

  const privateFile = path.join(wp.dataDir, 'comments', FILE);
  const emails = JSON.parse(await fs.readFile(privateFile, 'utf8')) as {
    comments: Record<string, unknown>;
  };
  await fs.writeFile(
    privateFile,
    `${JSON.stringify({ comments: Object.fromEntries(Object.entries(emails.comments).map(([key, value]) => [formerOf(key), value])) }, null, 2)}\n`,
  );

  const plugin = pluginSite({
    admin: wp.admin,
    config: resolveConfig(
      { contentDir: wp.contentDir, dataDir: wp.dataDir, baseUrl: SITE },
      { env: {} },
    ),
  });
  const recordFile = path.join(
    wp.dataDir,
    'plugins',
    '@geekity',
    'plugin-wordpress',
    'import.json',
  );
  const record = JSON.parse(await fs.readFile(recordFile, 'utf8')) as Record<string, unknown>;
  const written = plugin.comments(PERMALINK).comments;
  record['comments'] = {
    [`_data/comments/${FILE}`]: Object.fromEntries(
      written.map((comment) => [
        comment.id,
        createHash('sha256').update(sorted(comment)).digest('hex'),
      ]),
    ),
  };
  await fs.writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`);
}

function sorted(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : inner,
  );
}
