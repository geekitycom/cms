import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { openAdminStore } from '../admin/store.ts';
import type { AdminStore } from '../admin/store.ts';
import {
  addComment,
  commentsFile,
  deleteComment,
  readComments,
  rebuildCommentIndexes,
  updateComment,
} from './records.ts';
import type { CommentRecords, NewComment } from './records.ts';

const temporaryDirs: string[] = [];
const openStores: AdminStore[] = [];

after(async () => {
  for (const opened of openStores) opened.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A directory that goes away when the file finishes. */
async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-comments-'));
  temporaryDirs.push(dir);
  return dir;
}

/** A content directory and the index over it, both of this test's own. */
async function records(): Promise<CommentRecords> {
  const admin = openAdminStore({ dataDir: await temporaryDir() });
  openStores.push(admin);
  return { admin, contentDir: await temporaryDir() };
}

/** One comment on `hello-world`, as the form would submit it. */
function ada(overrides: Partial<NewComment> = {}): NewComment {
  return {
    slug: 'hello-world',
    permalink: '/2026/09/hello-world/',
    source: 'comment',
    kind: 'reply',
    status: 'pending',
    author: {
      name: 'Ada Lovelace',
      url: 'https://ada.example/',
      email: 'ada@example.com',
      avatar: null,
    },
    content: { markdown: 'Good post.', html: '<p>Good post.</p>\n' },
    submitted: '2026-09-04T10:00:00.000Z',
    addressHash: 'abc123',
    inReplyTo: null,
    url: null,
    notify: false,
    ...overrides,
  };
}

describe('a comment file', () => {
  it('is one JSON file per post, naming the post and holding its comments', async () => {
    const site = await records();

    const stored = await addComment(site, ada());

    assert.deepEqual(
      JSON.parse(await readFile(commentsFile(site.contentDir, 'hello-world'), 'utf8')),
      {
        post: '/2026/09/hello-world/',
        comments: [
          {
            id: stored.id,
            source: 'comment',
            kind: 'reply',
            status: 'pending',
            author: {
              name: 'Ada Lovelace',
              url: 'https://ada.example/',
              email: 'ada@example.com',
              avatar: null,
            },
            content: { markdown: 'Good post.', html: '<p>Good post.</p>\n' },
            submitted: '2026-09-04T10:00:00.000Z',
            addressHash: 'abc123',
            inReplyTo: null,
            url: null,
            notify: false,
          },
        ],
      },
    );
  });

  it('records whether the commenter asked to hear about replies', async () => {
    const site = await records();

    const stored = await addComment(site, ada({ notify: true }));

    assert.equal(readComments(site.contentDir, 'hello-world')[0]?.notify, true);
    assert.equal(site.admin.getComment(stored.id)?.notify, true);
  });

  it('reads an entry that predates the flag as one that asked for nothing', async () => {
    const site = await records();
    await mkdir(path.dirname(commentsFile(site.contentDir, 'hello-world')), { recursive: true });
    await writeFile(
      commentsFile(site.contentDir, 'hello-world'),
      JSON.stringify({
        post: '/2026/09/hello-world/',
        comments: [{ id: 'old', author: { name: 'Ada' } }],
      }),
    );

    assert.equal(readComments(site.contentDir, 'hello-world')[0]?.notify, false);
  });

  it('is appended to, oldest first, by the next comment on the same post', async () => {
    const site = await records();

    await addComment(site, ada());
    await addComment(
      site,
      ada({ author: { name: 'Grace', url: null, email: null, avatar: null } }),
    );

    const held = readComments(site.contentDir, 'hello-world');
    assert.deepEqual(
      held.map((comment) => comment.author.name),
      ['Ada Lovelace', 'Grace'],
    );
  });

  it('gives every comment an id of its own, which is what a reply names', async () => {
    const site = await records();

    const first = await addComment(site, ada());
    const second = await addComment(site, ada({ inReplyTo: first.id }));

    assert.notEqual(first.id, second.id);
    assert.equal(second.inReplyTo, first.id);
  });

  it('keeps each post in a file of its own', async () => {
    const site = await records();

    await addComment(site, ada());
    await addComment(site, ada({ slug: 'second-post', permalink: '/2026/09/second-post/' }));

    assert.equal(readComments(site.contentDir, 'hello-world').length, 1);
    assert.equal(readComments(site.contentDir, 'second-post').length, 1);
  });
});

describe('the comment index', () => {
  it('holds what the file holds, as soon as the comment is written', async () => {
    const site = await records();

    const stored = await addComment(site, ada());

    assert.deepEqual(site.admin.listCommentsFor('hello-world'), [stored]);
    assert.deepEqual(site.admin.getComment(stored.id), stored);
  });

  it('is rebuilt from the files, so deleting the database costs nothing', async () => {
    const site = await records();
    await addComment(site, ada());
    await addComment(site, ada({ slug: 'second-post', permalink: '/2026/09/second-post/' }));

    const before = site.admin.listComments({});
    // What a deleted database looks like from here: an index with nothing in it.
    site.admin.replaceComments([]);
    assert.deepEqual(site.admin.listComments({}), []);

    const report = rebuildCommentIndexes(site);

    assert.equal(report.comments, 2);
    assert.deepEqual(site.admin.listComments({}), before);
  });

  it('counts what is waiting for a moderator', async () => {
    const site = await records();
    await addComment(site, ada());
    await addComment(site, ada({ status: 'approved' }));
    await addComment(site, ada({ status: 'spam' }));

    assert.deepEqual(site.admin.countCommentsByStatus(), { pending: 1, approved: 1, spam: 1 });
  });

  it('lists one status at a time, newest first', async () => {
    const site = await records();
    await addComment(site, ada({ submitted: '2026-09-01T10:00:00.000Z', status: 'approved' }));
    await addComment(site, ada({ submitted: '2026-09-03T10:00:00.000Z', status: 'approved' }));
    await addComment(site, ada({ submitted: '2026-09-02T10:00:00.000Z', status: 'pending' }));

    assert.deepEqual(
      site.admin.listComments({ status: 'approved' }).map((comment) => comment.submitted),
      ['2026-09-03T10:00:00.000Z', '2026-09-01T10:00:00.000Z'],
    );
  });

  it('knows an author it has approved before, by name and email together', async () => {
    const site = await records();
    await addComment(site, ada({ status: 'approved' }));

    assert.equal(site.admin.hasApprovedAuthor('Ada Lovelace', 'ada@example.com'), true);
    // A different email under the same name is a different person.
    assert.equal(site.admin.hasApprovedAuthor('Ada Lovelace', 'someone@example.com'), false);
    assert.equal(site.admin.hasApprovedAuthor('Grace Hopper', 'ada@example.com'), false);
    // And an author whose only comment is still waiting is not approved.
    await addComment(
      site,
      ada({ author: { name: 'Grace', url: null, email: 'g@example.com', avatar: null } }),
    );
    assert.equal(site.admin.hasApprovedAuthor('Grace', 'g@example.com'), false);
  });
});

describe('moderating a stored comment', () => {
  it('rewrites the file where the comment stands, and the index with it', async () => {
    const site = await records();
    const stored = await addComment(site, ada());

    const moved = await updateComment(site, stored.id, { status: 'approved' });

    assert.equal(moved?.status, 'approved');
    assert.equal(readComments(site.contentDir, 'hello-world')[0]?.status, 'approved');
    assert.equal(site.admin.getComment(stored.id)?.status, 'approved');
  });

  it('takes a deleted comment out of both', async () => {
    const site = await records();
    const stored = await addComment(site, ada());

    assert.equal(await deleteComment(site, stored.id), true);

    assert.deepEqual(readComments(site.contentDir, 'hello-world'), []);
    assert.equal(site.admin.getComment(stored.id), undefined);
    // And says so when there is nothing to delete.
    assert.equal(await deleteComment(site, stored.id), false);
  });
});

describe('a comment file somebody edited by hand', () => {
  it('is read as far as it makes sense, so one bad entry loses only itself', async () => {
    const site = await records();
    const file = commentsFile(site.contentDir, 'hello-world');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({
        post: '/2026/09/hello-world/',
        comments: [
          { id: 'c1', author: { name: 'Ada' }, content: { markdown: 'Hi' }, status: 'approved' },
          { author: { name: 'Nameless' } },
        ],
      })}\n`,
    );

    const held = readComments(site.contentDir, 'hello-world');

    assert.equal(held.length, 1);
    assert.equal(held[0]?.id, 'c1');
    // Everything the entry did not say falls back to something a template can
    // print rather than to `undefined`.
    assert.equal(held[0]?.source, 'comment');
    assert.equal(held[0]?.kind, 'reply');
    assert.equal(held[0]?.author.email, null);
    assert.equal(held[0]?.content.html, '');
  });
});
