import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';

import {
  FEDERATION_QUEUE_TABLE,
  listWaitingDeliveries,
  openQueueDatabase,
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
