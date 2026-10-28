import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';
import { Temporal } from '@js-temporal/polyfill';

import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import type { NewDelivery } from '../store/deliveries.ts';
import { FEDERATION_QUEUE_TABLE, openQueueDatabase } from '../store/queue-database.ts';

const temporaryDirs: string[] = [];
const started: Cms[] = [];

after(async () => {
  for (const cms of started) await cms.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const NOW = new Date('2026-06-01T00:00:00.000Z');
const OBJECT_ID = 'https://forgotten.example/2026/03/hello/';
const ACTIVITY_ID = `${OBJECT_ID}#update/1`;
const FORGOTTEN_INBOX = 'https://forgotten.example/inbox';
const WAITING_INBOX = 'https://waiting.example/inbox';

function queued(inboxId: string): NewDelivery {
  return {
    activityId: ACTIVITY_ID,
    activityType: 'Update',
    objectId: OBJECT_ID,
    slug: 'hello',
    actorId: inboxId.replace('/inbox', '/users/ada'),
    inboxId,
    status: 'queued',
    error: null,
    attemptedAt: '2026-03-01T00:00:00.000Z',
  };
}

async function site(queue?: null): Promise<{ cms: Cms; dataDir: string }> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-forgotten-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-forgotten-data-'));
  temporaryDirs.push(contentDir, dataDir);
  const cms = createCms({
    contentDir,
    dataDir,
    port: 0,
    now: () => NOW,
    baseUrl: 'https://forgotten.example',
    ...(queue === null ? { federation: { queue: null } } : {}),
  });
  started.push(cms);
  return { cms, dataDir };
}

function statuses(cms: Cms): string[][] {
  return cms.admin.listDeliveries(ACTIVITY_ID).map((row) => [row.inboxId, row.status]);
}

describe('deliveries the queue no longer holds', () => {
  it('read as unknown once the site starts, while one the queue still holds stays queued', async () => {
    const { cms, dataDir } = await site();
    cms.admin.recordDelivery(queued(FORGOTTEN_INBOX));
    cms.admin.recordDelivery(queued(WAITING_INBOX));
    const queue = new SqliteMessageQueue(openQueueDatabase(dataDir), {
      tableName: FEDERATION_QUEUE_TABLE,
    });
    await queue.enqueue(
      { type: 'outbox', activityId: ACTIVITY_ID, inbox: WAITING_INBOX, attempt: 1 },
      { delay: Temporal.Duration.from({ hours: 1 }) as never },
    );
    queue[Symbol.dispose]();

    await cms.serve();

    assert.deepEqual(statuses(cms), [
      [FORGOTTEN_INBOX, 'unknown'],
      [WAITING_INBOX, 'queued'],
    ]);
  });

  it('all read as unknown on a site that sends without a queue', async () => {
    const { cms } = await site(null);
    cms.admin.recordDelivery(queued(FORGOTTEN_INBOX));

    await cms.serve();

    assert.deepEqual(statuses(cms), [[FORGOTTEN_INBOX, 'unknown']]);
  });
});
