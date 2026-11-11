import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';

import { openAdminStore } from '../store/admin-store.ts';
import type { AdminStore } from '../store/admin-store.ts';
import { FEDERATION_QUEUE_TABLE, openQueueDatabase } from '../store/queue-database.ts';
import { markForgottenDeliveries } from './forgotten-deliveries.ts';

const temporaryDirs: string[] = [];
const openStores: AdminStore[] = [];
after(async () => {
  for (const opened of openStores) opened.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const NOW = new Date('2026-06-01T00:00:00.000Z');
const CREATE = 'https://blog.example/2026/03/hello/#create';
const UPDATE = 'https://blog.example/2026/03/hello/#update';

describe('deliveries the queue forgot', () => {
  it('are marked unknown unless a waiting outbox message or fanout carries their activity and inbox together', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-forgotten-'));
    temporaryDirs.push(dataDir);
    const queue = new SqliteMessageQueue(openQueueDatabase(dataDir), {
      tableName: FEDERATION_QUEUE_TABLE,
    });
    await queue.enqueue({
      type: 'outbox',
      activityId: CREATE,
      activityType: 'https://www.w3.org/ns/activitystreams#Create',
      inbox: 'https://outbox.example/inbox',
      attempt: 1,
    });
    await queue.enqueue({
      type: 'fanout',
      activityId: UPDATE,
      activityType: 'https://www.w3.org/ns/activitystreams#Update',
      inboxes: {
        'https://fanout-a.example/inbox': { actorIds: [], sharedInbox: true },
        'https://fanout-b.example/inbox': { actorIds: [], sharedInbox: false },
      },
    });
    queue[Symbol.dispose]();
    const admin = openAdminStore({ dataDir });
    openStores.push(admin);
    const rows: [activityId: string, inbox: string][] = [
      [CREATE, 'https://outbox.example/inbox'],
      [CREATE, 'https://fanout-a.example/inbox'],
      [CREATE, 'https://elsewhere.example/inbox'],
      [UPDATE, 'https://fanout-a.example/inbox'],
      [UPDATE, 'https://fanout-b.example/inbox'],
      [UPDATE, 'https://outbox.example/inbox'],
    ];
    for (const [activityId, inbox] of rows) {
      admin.recordDelivery({
        activityId,
        activityType: activityId === CREATE ? 'Create' : 'Update',
        objectId: 'https://blog.example/2026/03/hello/',
        slug: 'hello',
        actorId: inbox.replace('/inbox', '/users/ada'),
        inboxId: inbox,
        status: 'retrying',
        error: 'Their instance answered 503.',
        attemptedAt: '2026-03-01T00:00:00.000Z',
      });
    }

    markForgottenDeliveries(admin, { dataDir, queue: undefined, now: () => NOW });

    assert.deepEqual(
      [CREATE, UPDATE].flatMap((activityId) =>
        admin.listDeliveries(activityId).map((row) => [row.activityId, row.inboxId, row.status]),
      ),
      [
        [CREATE, 'https://elsewhere.example/inbox', 'unknown'],
        [CREATE, 'https://fanout-a.example/inbox', 'unknown'],
        [CREATE, 'https://outbox.example/inbox', 'retrying'],
        [UPDATE, 'https://fanout-a.example/inbox', 'retrying'],
        [UPDATE, 'https://fanout-b.example/inbox', 'retrying'],
        [UPDATE, 'https://outbox.example/inbox', 'unknown'],
      ],
    );
  });
});
