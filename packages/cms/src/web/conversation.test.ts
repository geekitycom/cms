import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { openAdminStore } from '../admin/store.ts';
import type { AdminStore, CommentStatus } from '../admin/store.ts';
import { openContentStore } from '../content/store.ts';
import type { ContentStore } from '../content/store.ts';
import { parseDocument } from '../content/parser.ts';
import type { Document } from '../content/document.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { createConversation } from './conversation.ts';
import type { ConversationReader } from './conversation.ts';

const temporaryDirs: string[] = [];
const stores: (AdminStore | ContentStore)[] = [];
const started: Cms[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  for (const store of stores) store.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A directory of this test's own, swept when the file is done. */
async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** What one post's conversation is read out of: both indexes, over one database. */
async function reader(): Promise<{
  admin: AdminStore;
  posts: ContentStore;
  conversation: ConversationReader;
}> {
  const dataDir = await temporaryDir('geekity-conversation-');
  const admin = openAdminStore({ dataDir });
  const posts = openContentStore({ dataDir });
  stores.push(admin, posts);
  return {
    admin,
    posts,
    conversation: createConversation({ admin, store: posts, baseUrl: BASE_URL }),
  };
}

const BASE_URL = 'https://blog.example';

/** The post every test here is about, and the id the fediverse knows it by. */
const POST = 'https://blog.example/2026/09/hello/';

function hello(): Document {
  return parseDocument(
    [
      '---',
      'title: Hello',
      "date: '2026-09-02T09:00:00Z'",
      'permalink: /2026/09/hello/',
      '---',
      '',
    ].join('\n'),
    { path: 'posts/2026-09-02-hello.md' },
  );
}

/** What a reply looks like once the inbox has logged it. */
interface ReplyOptions {
  /** The object the note answers: the post, or another note. */
  inReplyTo: string;
  /** The note's own id. */
  id: string;
  /** Who wrote it. */
  actor?: string;
  /** The note's content, as the remote server rendered it. */
  content?: string;
  /** When the note says it was published. */
  published?: string;
  /** Where the note can be read on its own server. */
  url?: string;
  /** When the log stamped it. */
  receivedAt?: string;
}

/**
 * Log one reply the way the inbox logs one: a compacted `Create` of a `Note`,
 * the shape Fedify writes.
 */
function logReply(admin: AdminStore, options: ReplyOptions): void {
  const actor = options.actor ?? 'https://remote.example/users/ada';
  const activityId = `${options.id}/activity`;

  admin.logInboxActivity({
    activityId,
    activityType: 'Create',
    actorId: actor,
    objectId: options.id,
    ...(options.receivedAt === undefined ? {} : { receivedAt: options.receivedAt }),
    json: JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityId,
      type: 'Create',
      actor,
      object: {
        id: options.id,
        type: 'Note',
        attributedTo: actor,
        content: options.content ?? '<p>Good post.</p>',
        inReplyTo: options.inReplyTo,
        ...(options.published === undefined ? {} : { published: options.published }),
        ...(options.url === undefined ? {} : { url: options.url }),
      },
    }),
  });
}

/** Log a `Like` or an `Announce` of an object. */
function logReaction(
  admin: AdminStore,
  type: 'Like' | 'Announce',
  options: { id: string; actor: string; object?: string; receivedAt?: string },
): void {
  const object = options.object ?? POST;
  admin.logInboxActivity({
    activityId: options.id,
    activityType: type,
    actorId: options.actor,
    objectId: object,
    ...(options.receivedAt === undefined ? {} : { receivedAt: options.receivedAt }),
    json: JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: options.id,
      type,
      actor: options.actor,
      object,
    }),
  });
}

describe('a post’s conversation', () => {
  it('reads the replies the inbox logged, oldest first', async () => {
    const { admin, conversation: read } = await reader();
    logReply(admin, {
      inReplyTo: POST,
      id: 'https://remote.example/notes/1',
      content: '<p>Good post.</p>',
      published: '2026-09-02T10:00:00Z',
      url: 'https://remote.example/@ada/1',
    });
    logReply(admin, {
      inReplyTo: POST,
      id: 'https://remote.example/notes/2',
      actor: 'https://remote.example/users/bob',
      content: '<p>Agreed.</p>',
      published: '2026-09-02T11:00:00Z',
    });

    const conversation = read.thread(hello());

    assert.equal(conversation.counts.replies, 2);
    assert.equal(conversation.counts.total, 2);
    const [first, second] = conversation.replies;

    assert.equal(first?.id, 'https://remote.example/notes/1');
    assert.equal(first?.source, 'activitypub');
    assert.equal(first?.kind, 'reply');
    assert.equal(first?.status, 'published');
    assert.equal(first?.content, '<p>Good post.</p>');
    assert.equal(first?.url, 'https://remote.example/@ada/1');
    assert.equal(first?.inReplyTo, POST);
    assert.deepEqual(first?.published, new Date('2026-09-02T10:00:00Z'));
    assert.deepEqual(first?.replies, []);
    // Nothing is known about the author beyond the actor URL, so the handle it
    // implies is the name, and the actor is the profile to link to.
    assert.deepEqual(first?.author, {
      name: '@ada@remote.example',
      handle: '@ada@remote.example',
      url: 'https://remote.example/users/ada',
      avatar: null,
      actorId: 'https://remote.example/users/ada',
    });

    // Newest last: the conversation reads down the page.
    assert.equal(second?.id, 'https://remote.example/notes/2');
    assert.equal(second?.author.handle, '@bob@remote.example');
  });

  it('names an author from the follower profile the site holds', async () => {
    const { admin, conversation: read } = await reader();
    admin.putFollower({
      username: 'ada',
      actorId: 'https://remote.example/users/ada',
      inboxId: 'https://remote.example/users/ada/inbox',
      sharedInboxId: null,
      handle: '@ada@remote.example',
      name: 'Ada Lovelace',
      iconUrl: 'https://remote.example/avatars/ada.png',
      url: 'https://remote.example/@ada',
    });
    logReply(admin, { inReplyTo: POST, id: 'https://remote.example/notes/1' });

    const conversation = read.thread(hello());

    assert.deepEqual(conversation.replies[0]?.author, {
      name: 'Ada Lovelace',
      handle: '@ada@remote.example',
      url: 'https://remote.example/@ada',
      avatar: 'https://remote.example/avatars/ada.png',
      actorId: 'https://remote.example/users/ada',
    });
  });

  it('nests a reply under the reply it answers', async () => {
    const { admin, conversation: read } = await reader();
    logReply(admin, {
      inReplyTo: POST,
      id: 'https://remote.example/notes/1',
      published: '2026-09-02T10:00:00Z',
    });
    logReply(admin, {
      inReplyTo: 'https://remote.example/notes/1',
      id: 'https://remote.example/notes/2',
      actor: 'https://remote.example/users/bob',
      published: '2026-09-02T11:00:00Z',
    });
    logReply(admin, {
      inReplyTo: 'https://remote.example/notes/2',
      id: 'https://remote.example/notes/3',
      published: '2026-09-02T12:00:00Z',
    });
    logReply(admin, {
      inReplyTo: POST,
      id: 'https://remote.example/notes/4',
      actor: 'https://remote.example/users/cal',
      published: '2026-09-02T13:00:00Z',
    });

    const conversation = read.thread(hello());

    // Four replies in the thread, two of them at the top of it.
    assert.equal(conversation.counts.replies, 4);
    assert.deepEqual(
      conversation.replies.map((reply) => reply.id),
      ['https://remote.example/notes/1', 'https://remote.example/notes/4'],
    );
    assert.deepEqual(
      conversation.replies[0]?.replies.map((reply) => reply.id),
      ['https://remote.example/notes/2'],
    );
    assert.deepEqual(
      conversation.replies[0]?.replies[0]?.replies.map((reply) => reply.id),
      ['https://remote.example/notes/3'],
    );
  });

  it('leaves out a note that answers something this post has nothing to do with', async () => {
    const { admin, conversation: read } = await reader();
    logReaction(admin, 'Like', {
      id: 'https://remote.example/likes/1',
      actor: 'https://remote.example/users/ada',
    });
    // A note answering the like activity rather than the post or any reply to
    // it. The log holds it because it names something this conversation knows;
    // it is still no part of the conversation.
    logReply(admin, {
      inReplyTo: 'https://remote.example/likes/1',
      id: 'https://remote.example/notes/1',
    });

    const conversation = read.thread(hello());

    assert.deepEqual(conversation.replies, []);
    assert.equal(conversation.counts.likes, 1);
  });

  it('drops a reply its author deleted, and keeps one a stranger claimed to delete', async () => {
    const { admin, conversation: read } = await reader();
    logReply(admin, { inReplyTo: POST, id: 'https://remote.example/notes/1' });
    logReply(admin, {
      inReplyTo: POST,
      id: 'https://remote.example/notes/2',
      actor: 'https://remote.example/users/bob',
    });
    admin.logInboxActivity({
      activityId: 'https://remote.example/deletes/1',
      activityType: 'Delete',
      actorId: 'https://remote.example/users/ada',
      objectId: 'https://remote.example/notes/1',
      json: JSON.stringify({
        type: 'Delete',
        actor: 'https://remote.example/users/ada',
        object: { id: 'https://remote.example/notes/1', type: 'Tombstone' },
      }),
    });
    admin.logInboxActivity({
      activityId: 'https://remote.example/deletes/2',
      activityType: 'Delete',
      actorId: 'https://remote.example/users/mallory',
      objectId: 'https://remote.example/notes/2',
      json: JSON.stringify({
        type: 'Delete',
        actor: 'https://remote.example/users/mallory',
        object: { id: 'https://remote.example/notes/2', type: 'Tombstone' },
      }),
    });

    const conversation = read.thread(hello());

    assert.deepEqual(
      conversation.replies.map((reply) => reply.id),
      ['https://remote.example/notes/2'],
    );
    assert.equal(conversation.counts.replies, 1);
  });

  it('keeps the answers to a deleted reply, under whatever it was answering', async () => {
    const { admin, conversation: read } = await reader();
    logReply(admin, { inReplyTo: POST, id: 'https://remote.example/notes/1' });
    logReply(admin, {
      inReplyTo: 'https://remote.example/notes/1',
      id: 'https://remote.example/notes/2',
      actor: 'https://remote.example/users/bob',
    });
    admin.logInboxActivity({
      activityId: 'https://remote.example/deletes/1',
      activityType: 'Delete',
      actorId: 'https://remote.example/users/ada',
      objectId: 'https://remote.example/notes/1',
      json: JSON.stringify({
        type: 'Delete',
        actor: 'https://remote.example/users/ada',
        object: { id: 'https://remote.example/notes/1', type: 'Tombstone' },
      }),
    });

    const conversation = read.thread(hello());

    assert.deepEqual(
      conversation.replies.map((reply) => reply.id),
      ['https://remote.example/notes/2'],
    );
  });

  it('sanitises what a remote server sent', async () => {
    const { admin, conversation: read } = await reader();
    logReply(admin, {
      inReplyTo: POST,
      id: 'https://remote.example/notes/1',
      content:
        '<p>Nice<script>alert(1)</script> <a href="javascript:alert(2)">post</a> ' +
        '<a href="https://elsewhere.example/">link</a></p>',
    });

    const conversation = read.thread(hello());

    assert.equal(
      conversation.replies[0]?.content,
      '<p>Nice post <a href="https://elsewhere.example/" rel="nofollow noopener noreferrer">link</a></p>',
    );
  });

  it('counts the likes and the boosts, and keeps the actors behind them', async () => {
    const { admin, conversation: read } = await reader();
    logReaction(admin, 'Like', {
      id: 'https://remote.example/likes/1',
      actor: 'https://remote.example/users/ada',
      receivedAt: '2026-09-02T10:00:00.000Z',
    });
    logReaction(admin, 'Announce', {
      id: 'https://remote.example/boosts/1',
      actor: 'https://remote.example/users/bob',
      receivedAt: '2026-09-02T11:00:00.000Z',
    });
    logReaction(admin, 'Like', {
      id: 'https://remote.example/likes/2',
      actor: 'https://remote.example/users/cal',
      receivedAt: '2026-09-02T12:00:00.000Z',
    });
    // Somebody else's post, which this conversation knows nothing about.
    logReaction(admin, 'Like', {
      id: 'https://remote.example/likes/3',
      actor: 'https://remote.example/users/dee',
      object: 'https://blog.example/2026/09/other/',
    });

    const conversation = read.thread(hello());

    assert.equal(conversation.counts.likes, 2);
    assert.equal(conversation.counts.boosts, 1);
    assert.equal(conversation.counts.total, 3);
    assert.deepEqual(
      conversation.likes.map((like) => like.author.handle),
      ['@ada@remote.example', '@cal@remote.example'],
    );
    assert.deepEqual(
      conversation.boosts.map((boost) => boost.author.handle),
      ['@bob@remote.example'],
    );

    const [like] = conversation.likes;
    assert.equal(like?.kind, 'like');
    assert.equal(like?.source, 'activitypub');
    assert.equal(like?.content, '');
    assert.equal(like?.inReplyTo, null);
    assert.equal(like?.url, 'https://remote.example/users/ada');
    assert.deepEqual(like?.published, new Date('2026-09-02T10:00:00.000Z'));
  });

  it('counts one like per actor, however many times it was delivered', async () => {
    const { admin, conversation: read } = await reader();
    logReaction(admin, 'Like', {
      id: 'https://remote.example/likes/1',
      actor: 'https://remote.example/users/ada',
    });
    logReaction(admin, 'Like', {
      id: 'https://remote.example/likes/2',
      actor: 'https://remote.example/users/ada',
    });

    const conversation = read.thread(hello());

    assert.equal(conversation.counts.likes, 1);
  });

  it('takes a like back when the actor undoes it', async () => {
    const { admin, conversation: read } = await reader();
    logReaction(admin, 'Like', {
      id: 'https://remote.example/likes/1',
      actor: 'https://remote.example/users/ada',
    });
    logReaction(admin, 'Announce', {
      id: 'https://remote.example/boosts/1',
      actor: 'https://remote.example/users/bob',
    });
    admin.logInboxActivity({
      activityId: 'https://remote.example/undos/1',
      activityType: 'Undo',
      actorId: 'https://remote.example/users/ada',
      objectId: 'https://remote.example/likes/1',
      json: JSON.stringify({
        type: 'Undo',
        actor: 'https://remote.example/users/ada',
        object: 'https://remote.example/likes/1',
      }),
    });
    // An undo by anybody but the actor who liked is not an undo at all.
    admin.logInboxActivity({
      activityId: 'https://remote.example/undos/2',
      activityType: 'Undo',
      actorId: 'https://remote.example/users/mallory',
      objectId: 'https://remote.example/boosts/1',
      json: JSON.stringify({
        type: 'Undo',
        actor: 'https://remote.example/users/mallory',
        object: 'https://remote.example/boosts/1',
      }),
    });

    const conversation = read.thread(hello());

    assert.equal(conversation.counts.likes, 0);
    assert.equal(conversation.counts.boosts, 1);
  });

  it('is empty for a post nobody has answered', async () => {
    const { conversation: read } = await reader();

    const conversation = read.thread(hello());

    assert.deepEqual(conversation.replies, []);
    assert.deepEqual(conversation.likes, []);
    assert.deepEqual(conversation.boosts, []);
    assert.equal(conversation.counts.total, 0);
  });
});

/**
 * The whole read side through the app: one post with an answer from every
 * door, read once as a page and once as a feed.
 *
 * It is here rather than in a feed test because the point is that the two are
 * the same reading. A reader who subscribes to a post's comments and a reader
 * who scrolls to the bottom of it are looking at one conversation, and the
 * only way to prove that is to ask for both and compare them.
 */
/** A second post, for the readings that are about more than one. */
function second(): Document {
  return parseDocument(
    [
      '---',
      'title: Second',
      "date: '2026-09-01T09:00:00Z'",
      'permalink: /2026/09/second/',
      '---',
      '',
    ].join('\n'),
    { path: 'posts/2026-09-01-second.md' },
  );
}

/** One approved native comment in the index, as the file layer would leave it. */
function indexComment(
  admin: AdminStore,
  document: Document,
  values: { id: string; name: string; html: string; submitted: string; status?: CommentStatus },
): void {
  admin.putComment({
    id: values.id,
    slug: document.slug,
    permalink: document.permalink,
    source: 'comment',
    kind: 'reply',
    status: values.status ?? 'approved',
    author: { name: values.name, url: null, email: null, avatar: null },
    content: { markdown: values.html, html: values.html },
    submitted: values.submitted,
    addressHash: null,
    inReplyTo: null,
    url: null,
    notify: false,
  });
}

describe('how many answers a post has', () => {
  it('counts the fediverse replies and the approved comments together, by permalink', async () => {
    const { admin, conversation: read } = await reader();
    logReply(admin, { inReplyTo: POST, id: 'https://remote.example/notes/1' });
    logReply(admin, { inReplyTo: POST, id: 'https://remote.example/notes/2' });
    indexComment(admin, hello(), {
      id: 'comment-1',
      name: 'Ada Lovelace',
      html: '<p>Approved.</p>',
      submitted: '2026-09-02T12:00:00.000Z',
    });
    // Neither of these is anything a reader would find on the page, so neither
    // is anything to promise one in a feed.
    indexComment(admin, hello(), {
      id: 'comment-2',
      name: 'Nobody Yet',
      html: '<p>Waiting.</p>',
      submitted: '2026-09-02T13:00:00.000Z',
      status: 'pending',
    });
    indexComment(admin, second(), {
      id: 'comment-3',
      name: 'Grace Hopper',
      html: '<p>Elsewhere.</p>',
      submitted: '2026-09-02T14:00:00.000Z',
    });

    const counts = read.counts([hello(), second()]);

    assert.equal(counts.get('/2026/09/hello/'), 3);
    assert.equal(counts.get('/2026/09/second/'), 1);
  });

  it('says zero for a post nobody has answered', async () => {
    const { conversation: read } = await reader();

    assert.equal(read.counts([hello()]).get('/2026/09/hello/'), 0);
  });
});

describe('the site’s latest answers', () => {
  it('merges both sources newest first, each naming the post it answers', async () => {
    const { admin, posts, conversation: read } = await reader();
    posts.upsertAll([hello(), second()]);
    logReply(admin, {
      inReplyTo: POST,
      id: 'https://remote.example/notes/1',
      published: '2026-09-02T10:00:00Z',
    });
    logReply(admin, {
      inReplyTo: 'https://blog.example/2026/09/second/',
      id: 'https://remote.example/notes/2',
      published: '2026-09-02T08:00:00Z',
    });
    indexComment(admin, hello(), {
      id: 'comment-1',
      name: 'Ada Lovelace',
      html: '<p>Approved.</p>',
      submitted: '2026-09-02T09:00:00.000Z',
    });
    indexComment(admin, hello(), {
      id: 'comment-2',
      name: 'Nobody Yet',
      html: '<p>Waiting.</p>',
      submitted: '2026-09-02T11:00:00.000Z',
      status: 'pending',
    });

    const latest = read.latest(10);

    assert.deepEqual(
      latest.map((said) => said.id),
      ['https://remote.example/notes/1', 'comment-1', 'https://remote.example/notes/2'],
    );
    assert.deepEqual(
      latest.map((said) => said.post.permalink),
      ['/2026/09/hello/', '/2026/09/hello/', '/2026/09/second/'],
    );
    assert.equal(latest[1]?.source, 'comment');
    assert.equal(latest[1]?.url, '/2026/09/hello/#comment-comment-1');
  });

  it('forgets an answer whose post is not there to read', async () => {
    const { admin, posts, conversation: read } = await reader();
    const draft = parseDocument(
      [
        '---',
        'title: Hidden',
        "date: '2026-09-01T09:00:00Z'",
        'permalink: /2026/09/hidden/',
        'draft: true',
        '---',
        '',
      ].join('\n'),
      { path: 'posts/2026-09-01-hidden.md' },
    );
    posts.upsertAll([hello(), draft]);
    logReply(admin, {
      inReplyTo: 'https://blog.example/2026/09/hidden/',
      id: 'https://remote.example/notes/1',
    });
    indexComment(admin, draft, {
      id: 'comment-1',
      name: 'Ada Lovelace',
      html: '<p>Approved.</p>',
      submitted: '2026-09-02T09:00:00.000Z',
    });

    assert.deepEqual(read.latest(10), []);
  });

  it('cuts the merged list to the limit', async () => {
    const { admin, posts, conversation: read } = await reader();
    posts.upsert(hello());
    for (const hour of ['08', '09', '10']) {
      logReply(admin, {
        inReplyTo: POST,
        id: `https://remote.example/notes/${hour}`,
        published: `2026-09-02T${hour}:00:00Z`,
      });
    }
    indexComment(admin, hello(), {
      id: 'comment-1',
      name: 'Ada Lovelace',
      html: '<p>Approved.</p>',
      submitted: '2026-09-02T11:00:00.000Z',
    });

    assert.deepEqual(
      read.latest(2).map((said) => said.id),
      ['comment-1', 'https://remote.example/notes/10'],
    );
  });
});

describe('the conversation a reader meets', () => {
  /** The post everything below answers. */
  const HELLO = `---
title: Hello world
date: '2026-09-01T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

  /** The moment the site's clock is stopped at. */
  const NOW = new Date('2026-09-05T12:00:00.000Z');

  /** One entry of a comment file, with the fields a reader never sees left out. */
  function entry(values: Record<string, unknown>): Record<string, unknown> {
    return {
      source: 'comment',
      kind: 'reply',
      status: 'approved',
      author: { name: 'Somebody', url: null, email: null, avatar: null },
      content: { markdown: '', html: '' },
      submitted: '2026-09-02T10:00:00.000Z',
      addressHash: null,
      inReplyTo: null,
      url: null,
      notify: false,
      ...values,
    };
  }

  /** A site with one post, a comment file beside it and one logged reply. */
  async function site(): Promise<Cms> {
    const contentDir = await temporaryDir('geekity-conversation-content-');
    const dataDir = await temporaryDir('geekity-conversation-data-');

    await mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await writeFile(path.join(contentDir, 'posts', '2026-09-01-hello-world.md'), HELLO, 'utf8');
    await mkdir(path.join(contentDir, '_data', 'comments'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'comments', 'hello-world.json'),
      JSON.stringify({
        post: '/2026/09/hello-world/',
        comments: [
          entry({
            id: APPROVED,
            author: { name: 'Ada Lovelace', url: null, email: null, avatar: null },
            content: { markdown: 'Approved words.', html: '<p>Approved words.</p>' },
            submitted: '2026-09-02T10:00:00.000Z',
          }),
          entry({
            id: PENDING,
            status: 'pending',
            author: { name: 'Nobody Yet', url: null, email: null, avatar: null },
            content: { markdown: 'Pending words.', html: '<p>Pending words.</p>' },
            submitted: '2026-09-02T10:30:00.000Z',
          }),
          entry({
            id: MENTIONED,
            source: 'webmention',
            kind: 'mention',
            author: {
              name: 'Grace Hopper',
              url: 'https://grace.example/',
              email: null,
              avatar: null,
            },
            content: {
              markdown: 'Somebody wrote about this',
              html: '<p>Somebody wrote about this</p>',
            },
            submitted: '2026-09-02T11:00:00.000Z',
            url: SOURCE_PAGE,
          }),
        ],
      }),
      'utf8',
    );

    const cms = createCms({
      contentDir,
      dataDir,
      baseUrl: BASE_URL,
      watch: false,
      now: () => NOW,
    });
    started.push(cms);
    await cms.sync();

    logReply(cms.admin, {
      inReplyTo: 'https://blog.example/2026/09/hello-world/',
      id: NOTE,
      content: '<p>Federated words.</p>',
      published: '2026-09-02T09:00:00Z',
      url: 'https://remote.example/@ada/1',
    });

    return cms;
  }

  const APPROVED = '00000000-0000-4000-8000-000000000001';
  const PENDING = '00000000-0000-4000-8000-000000000002';
  const MENTIONED = '00000000-0000-4000-8000-000000000003';
  const NOTE = 'https://remote.example/notes/1';
  const SOURCE_PAGE = 'https://grace.example/2026/09/about-that/';

  it('shows the page and the post’s feed the same entries', async () => {
    const cms = await site();

    const page = await (await cms.app.request('/2026/09/hello-world/')).text();
    const feed = await (await cms.app.request('/2026/09/hello-world/feed/')).text();

    // Every entry a reader may see, and only those: the moderated one that was
    // never approved is in neither.
    const guids = [...feed.matchAll(/<guid isPermaLink="false">([^<]+)<\/guid>/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(guids.sort(), [APPROVED, MENTIONED, NOTE].sort());

    assert.ok(page.includes(`id="comment-${APPROVED}"`), 'the page shows the approved comment');
    assert.ok(page.includes(`id="comment-${NOTE}"`), 'the page shows the fediverse reply');
    assert.ok(page.includes(SOURCE_PAGE), 'the page shows the webmention');
    assert.ok(!page.includes('Pending words'), 'the page shows nothing nobody approved');
    assert.ok(!feed.includes('Pending words'), 'the feed shows nothing nobody approved');

    // And it points them at the same places. A webmention lives on the page
    // that sent it, wherever it is read.
    assert.ok(feed.includes(`<link>${SOURCE_PAGE}</link>`), 'the feed points at the source page');
    assert.ok(
      feed.includes('<link>https://blog.example/2026/09/hello-world/#comment-' + APPROVED),
      'the feed points at the comment on the page',
    );
    assert.ok(feed.includes('<link>https://remote.example/@ada/1</link>'), 'and at the note');
  });
});
