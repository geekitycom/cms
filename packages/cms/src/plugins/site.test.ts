import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { leakedSecrets, pngWithMetadata } from '../__testing__/metadata.ts';
import { openAdminStore } from '../admin/store.ts';
import type { AdminStore } from '../admin/store.ts';
import { addComment } from '../comments/records.ts';
import { resolveConfig } from '../config.ts';
import type { PluginComment, PluginSite } from '../plugin.ts';
import { pluginSite } from './site.ts';

const roots: string[] = [];
const stores: AdminStore[] = [];
after(async () => {
  for (const store of stores) store.close();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function site(
  limits: { uploadMaxBytes?: number; uploadTypes?: string[] } = {},
): Promise<{ site: PluginSite; contentDir: string; dataDir: string; admin: AdminStore }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'geekity-plugin-site-'));
  roots.push(root);
  const config = resolveConfig(
    { contentDir: path.join(root, 'content'), dataDir: path.join(root, 'data'), ...limits },
    { env: {} },
  );
  const admin = openAdminStore({ dataDir: config.dataDir });
  stores.push(admin);
  return {
    site: pluginSite({ admin, config }),
    contentDir: config.contentDir,
    dataDir: config.dataDir,
    admin,
  };
}

describe('PluginSite.checkUpload', () => {
  it('answers the bytes the editor would store, metadata stripped, and writes nothing', async () => {
    const { site: plugin, contentDir } = await site();
    const original = await pngWithMetadata();
    assert.notDeepEqual(leakedSecrets(original), []);

    const check = plugin.checkUpload('photo.png', original);

    assert.equal(check.accepted, true);
    assert.deepEqual(check.accepted && leakedSecrets(check.bytes), []);
    await assert.rejects(readdir(contentDir));
  });

  it('refuses a type the site does not accept, saying why', async () => {
    const { site: plugin } = await site();

    const check = plugin.checkUpload('drawing.svg', new TextEncoder().encode('<svg/>'));

    assert.equal(check.accepted, false);
    assert.match(check.accepted ? '' : check.why, /\.svg are not allowed here/);
  });

  it('refuses a file over the site’s limit for its kind', async () => {
    const { site: plugin } = await site({ uploadMaxBytes: 64 });

    const check = plugin.checkUpload('photo.png', await pngWithMetadata());

    assert.equal(check.accepted, false);
    assert.match(
      check.accepted ? '' : check.why,
      /too big\. This site accepts uploads up to 64 bytes/,
    );
  });

  it('refuses a file whose bytes are not the format its name says', async () => {
    const { site: plugin } = await site();

    const check = plugin.checkUpload('photo.png', new TextEncoder().encode('not a png at all'));

    assert.equal(check.accepted, false);
    assert.match(check.accepted ? '' : check.why, /does not look like a \.png/);
  });
});

function imported(overrides: Partial<PluginComment> = {}): PluginComment {
  return {
    id: 'https://old.example/?p=7#comment-3',
    source: 'activitypub',
    kind: 'reply',
    status: 'approved',
    author: {
      name: 'Weldon',
      url: 'https://mstdn.example/@weldon',
      email: null,
      avatar: null,
    },
    markdown: 'Nice *post*. <script>alert(1)</script>',
    submitted: '2026-03-06T10:00:00.000Z',
    inReplyTo: null,
    url: 'https://mstdn.example/@weldon/1',
    ...overrides,
  };
}

describe('PluginSite.putComments and PluginSite.comments', () => {
  it('writes comments onto the post a permalink names, rendered by the site, the email only in data/', async () => {
    const { site: plugin, contentDir, dataDir, admin } = await site();

    await plugin.putComments('/2026/07/i-♥-rss/', [
      imported(),
      imported({
        id: 'https://old.example/?p=7#comment-4',
        source: 'comment',
        author: { name: 'Ada', url: null, email: 'ada@example.com', avatar: null },
        url: null,
      }),
    ]);

    const file = path.join(contentDir, '_data', 'comments', 'i-%E2%99%A5-rss.json');
    const held = JSON.parse(await readFile(file, 'utf8')) as {
      post: string;
      comments: { id: string; source: string; content: { html: string } }[];
    };
    assert.equal(held.post, '/2026/07/i-♥-rss/');
    assert.deepEqual(
      held.comments.map((comment) => [comment.id, comment.source]),
      [
        ['https://old.example/?p=7#comment-3', 'activitypub'],
        ['https://old.example/?p=7#comment-4', 'comment'],
      ],
    );
    assert.equal(
      held.comments[0]?.content.html,
      '<p>Nice <em>post</em>. &lt;script&gt;alert(1)&lt;/script&gt;</p>\n',
    );
    assert.doesNotMatch(await readFile(file, 'utf8'), /ada@example\.com/);
    assert.match(
      await readFile(path.join(dataDir, 'comments', 'i-%E2%99%A5-rss.json'), 'utf8'),
      /ada@example\.com/,
    );
    assert.equal(admin.listCommentsFor('i-♥-rss').length, 2, 'the index holds them');

    const read = plugin.comments('/2026/07/i-♥-rss/');
    assert.equal(read.file, '_data/comments/i-%E2%99%A5-rss.json');
    assert.deepEqual(read.comments, [
      imported(),
      imported({
        id: 'https://old.example/?p=7#comment-4',
        source: 'comment',
        author: { name: 'Ada', url: null, email: 'ada@example.com', avatar: null },
        url: null,
      }),
    ]);
  });

  it('replaces a comment by id where it stands, appends a new one, and moves nothing else', async () => {
    const { site: plugin, contentDir, dataDir, admin } = await site();
    await plugin.putComments('/2026/09/hello/', [imported()]);
    const live = await addComment(
      { admin, contentDir, dataDir },
      {
        slug: 'hello',
        permalink: '/2026/09/hello/',
        source: 'comment',
        kind: 'reply',
        status: 'approved',
        author: { name: 'Live', url: null, email: null, avatar: null },
        content: { markdown: 'Here now.', html: '<p>Here now.</p>\n' },
        submitted: '2026-10-09T10:00:00.000Z',
        addressHash: 'hash',
        inReplyTo: null,
        url: null,
        notify: false,
      },
    );
    const file = path.join(contentDir, '_data', 'comments', 'hello.json');
    const liveEntry = (JSON.parse(await readFile(file, 'utf8')) as { comments: unknown[] })
      .comments[1];

    await plugin.putComments('/2026/09/hello/', [
      imported({ markdown: 'Edited at the source.' }),
      imported({ id: 'https://old.example/?p=7#comment-9', kind: 'like', markdown: '' }),
    ]);

    const held = JSON.parse(await readFile(file, 'utf8')) as {
      comments: { id: string; content: { markdown: string } }[];
    };
    assert.deepEqual(
      held.comments.map((comment) => comment.id),
      ['https://old.example/?p=7#comment-3', live.id, 'https://old.example/?p=7#comment-9'],
    );
    assert.equal(held.comments[0]?.content.markdown, 'Edited at the source.');
    assert.deepEqual(held.comments[1], liveEntry, 'the live comment is byte for byte as it was');
  });
});
