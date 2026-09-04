import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { openAdminStore } from '../admin/store.ts';
import type { AdminStore } from '../admin/store.ts';
import { parseDocument } from '../content/parser.ts';
import type { Document } from '../content/document.ts';
import { postConversation } from './conversation.ts';

const temporaryDirs: string[] = [];
const stores: AdminStore[] = [];

after(async () => {
  for (const store of stores) store.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** An admin store over a database of its own. */
async function store(): Promise<AdminStore> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-conversation-'));
  temporaryDirs.push(dir);
  const opened = openAdminStore({ dataDir: dir });
  stores.push(opened);
  return opened;
}

const BASE_URL = 'https://blog.example';

/** The post every test here is about, and the id the fediverse knows it by. */
const POST = 'https://blog.example/ap/posts/hello';

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
    const admin = await store();
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

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

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
    const admin = await store();
    admin.putFollower({
      actorId: 'https://remote.example/users/ada',
      inboxId: 'https://remote.example/users/ada/inbox',
      sharedInboxId: null,
      handle: '@ada@remote.example',
      name: 'Ada Lovelace',
      iconUrl: 'https://remote.example/avatars/ada.png',
      url: 'https://remote.example/@ada',
    });
    logReply(admin, { inReplyTo: POST, id: 'https://remote.example/notes/1' });

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

    assert.deepEqual(conversation.replies[0]?.author, {
      name: 'Ada Lovelace',
      handle: '@ada@remote.example',
      url: 'https://remote.example/@ada',
      avatar: 'https://remote.example/avatars/ada.png',
      actorId: 'https://remote.example/users/ada',
    });
  });

  it('nests a reply under the reply it answers', async () => {
    const admin = await store();
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

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

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
    const admin = await store();
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

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

    assert.deepEqual(conversation.replies, []);
    assert.equal(conversation.counts.likes, 1);
  });

  it('drops a reply its author deleted, and keeps one a stranger claimed to delete', async () => {
    const admin = await store();
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

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

    assert.deepEqual(
      conversation.replies.map((reply) => reply.id),
      ['https://remote.example/notes/2'],
    );
    assert.equal(conversation.counts.replies, 1);
  });

  it('keeps the answers to a deleted reply, under whatever it was answering', async () => {
    const admin = await store();
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

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

    assert.deepEqual(
      conversation.replies.map((reply) => reply.id),
      ['https://remote.example/notes/2'],
    );
  });

  it('sanitises what a remote server sent', async () => {
    const admin = await store();
    logReply(admin, {
      inReplyTo: POST,
      id: 'https://remote.example/notes/1',
      content:
        '<p>Nice<script>alert(1)</script> <a href="javascript:alert(2)">post</a> ' +
        '<a href="https://elsewhere.example/">link</a></p>',
    });

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

    assert.equal(
      conversation.replies[0]?.content,
      '<p>Nice post <a href="https://elsewhere.example/" rel="nofollow noopener noreferrer">link</a></p>',
    );
  });

  it('counts the likes and the boosts, and keeps the actors behind them', async () => {
    const admin = await store();
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
      object: 'https://blog.example/ap/posts/other',
    });

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

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
    const admin = await store();
    logReaction(admin, 'Like', {
      id: 'https://remote.example/likes/1',
      actor: 'https://remote.example/users/ada',
    });
    logReaction(admin, 'Like', {
      id: 'https://remote.example/likes/2',
      actor: 'https://remote.example/users/ada',
    });

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

    assert.equal(conversation.counts.likes, 1);
  });

  it('takes a like back when the actor undoes it', async () => {
    const admin = await store();
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

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

    assert.equal(conversation.counts.likes, 0);
    assert.equal(conversation.counts.boosts, 1);
  });

  it('is empty for a post nobody has answered', async () => {
    const admin = await store();

    const conversation = postConversation({ admin, baseUrl: BASE_URL }, hello());

    assert.deepEqual(conversation.replies, []);
    assert.deepEqual(conversation.likes, []);
    assert.deepEqual(conversation.boosts, []);
    assert.equal(conversation.counts.total, 0);
  });
});
