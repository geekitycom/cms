import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';

import {
  FEDERATION_QUEUE_TABLE,
  dropMessagesSignedByRetiredKeys,
  listWaitingDeliveries,
  openQueueDatabase,
  queueFile,
} from './queue-database.ts';

const temporaryDirs: string[] = [];
after(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-queue-'));
  temporaryDirs.push(dir);
  return dir;
}

const ACTIVITY_ID = 'https://blog.example/2026/03/hello/#create';

describe('the deliveries waiting in the queue', () => {
  it('names none when the queue file was never made', async () => {
    assert.deepEqual(listWaitingDeliveries(await dataDir()), []);
  });

  it('names each inbox an outbox message or a fanout still carries', async () => {
    const dir = await dataDir();
    const queue = new SqliteMessageQueue(openQueueDatabase(dir), {
      tableName: FEDERATION_QUEUE_TABLE,
    });
    await queue.enqueue({
      type: 'outbox',
      activityId: ACTIVITY_ID,
      activityType: 'https://www.w3.org/ns/activitystreams#Create',
      inbox: 'https://one.example/inbox',
      attempt: 1,
    });
    await queue.enqueue({
      type: 'fanout',
      activityId: `${ACTIVITY_ID}-2`,
      activityType: 'https://www.w3.org/ns/activitystreams#Update',
      inboxes: {
        'https://two.example/inbox': { actorIds: [], sharedInbox: true },
        'https://three.example/inbox': { actorIds: [], sharedInbox: false },
      },
    });
    await queue.enqueue({ type: 'inbox', id: 'not a delivery' });
    queue[Symbol.dispose]();

    const waiting = listWaitingDeliveries(dir);

    assert.deepEqual(waiting.map((delivery) => [delivery.activityId, delivery.inbox]).sort(), [
      [ACTIVITY_ID, 'https://one.example/inbox'],
      [`${ACTIVITY_ID}-2`, 'https://three.example/inbox'],
      [`${ACTIVITY_ID}-2`, 'https://two.example/inbox'],
    ]);
  });
});

describe('the signing keys a queued message carries', () => {
  const MARKER = 'private-key-material-0123456789';

  it('leaves no copy of a taken message in the queue file', async () => {
    const dir = await dataDir();
    const db = openQueueDatabase(dir);
    const queue = new SqliteMessageQueue(db, { tableName: FEDERATION_QUEUE_TABLE });
    await queue.enqueue({ type: 'outbox', keys: [{ keyId: 'k', privateKey: { d: MARKER } }] });
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

    db.exec(`DELETE FROM ${FEDERATION_QUEUE_TABLE}`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    queue[Symbol.dispose]();

    const bytes = await readFile(queueFile(dir));
    assert.equal(bytes.includes(MARKER), false);
  });

  it('keeps the write-ahead log and shared-memory files to the owner', async () => {
    const dir = await dataDir();
    await mkdir(dir, { recursive: true });
    for (const suffix of ['-wal', '-shm']) {
      await writeFile(`${queueFile(dir)}${suffix}`, '', { mode: 0o644 });
    }

    openQueueDatabase(dir).close();

    for (const suffix of ['-wal', '-shm']) {
      const mode = (await stat(`${queueFile(dir)}${suffix}`).catch(() => undefined))?.mode;
      if (mode !== undefined) assert.equal(mode & 0o777, 0o600, `${suffix} is 0600`);
    }
  });

  it('drops a message signed by a key the site no longer holds, and keeps the rest', async () => {
    const dir = await dataDir();
    const queue = new SqliteMessageQueue(openQueueDatabase(dir), {
      tableName: FEDERATION_QUEUE_TABLE,
    });
    const signed = (d: string, inbox: string) => ({
      type: 'outbox',
      activityId: ACTIVITY_ID,
      inbox,
      keys: [{ keyId: 'https://blog.example/author/ada#main-key', privateKey: { d } }],
    });
    await queue.enqueue(signed('current', 'https://kept.example/inbox'));
    await queue.enqueue(signed('replaced', 'https://dropped.example/inbox'));
    await queue.enqueue({
      type: 'fanout',
      activityId: `${ACTIVITY_ID}-2`,
      keys: [{ keyId: 'https://blog.example/author/gone#main-key', privateKey: { d: 'gone' } }],
      inboxes: { 'https://dropped-too.example/inbox': { actorIds: [], sharedInbox: false } },
    });
    queue[Symbol.dispose]();

    dropMessagesSignedByRetiredKeys(dir, new Set(['current']));

    assert.deepEqual(
      listWaitingDeliveries(dir).map((delivery) => delivery.inbox),
      ['https://kept.example/inbox'],
    );
  });
});
