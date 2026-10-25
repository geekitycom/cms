import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { openAdminStore } from './admin-store.ts';
import type { AdminStore, NewDelivery, NewInboxActivity } from './admin-store.ts';

const dirs: string[] = [];
const stores: AdminStore[] = [];

after(async () => {
  for (const opened of stores) opened.close();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function store(): Promise<AdminStore> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-inspect-'));
  dirs.push(dir);
  const opened = openAdminStore({ dataDir: dir });
  stores.push(opened);
  return opened;
}

const POST = 'https://blog.example/2026/03/hello/';
const ADA = 'https://remote.example/users/ada';
const BOB = 'https://other.example/users/bob';

function activity(overrides: Partial<NewInboxActivity> = {}): NewInboxActivity {
  return {
    activityId: 'https://remote.example/likes/1',
    activityType: 'Like',
    actorId: ADA,
    objectId: POST,
    json: '{"type":"Like"}',
    ...overrides,
  };
}

describe('searching the inbox log', () => {
  async function seeded(): Promise<AdminStore> {
    const admin = await store();
    admin.logInboxActivity(activity({ receivedAt: '2026-03-01T00:00:00.000Z' }));
    admin.logInboxActivity(
      activity({
        activityId: 'https://other.example/notes/9/activity',
        activityType: 'Create',
        actorId: BOB,
        objectId: 'https://other.example/notes/9',
        recipient: 'ada',
        receivedAt: '2026-03-02T00:00:00.000Z',
        json: JSON.stringify({
          type: 'Create',
          object: { id: 'https://other.example/notes/9', inReplyTo: POST },
        }),
      }),
    );
    admin.logInboxActivity(
      activity({
        activityId: 'https://remote.example/boosts/1',
        activityType: 'Announce',
        receivedAt: '2026-03-03T00:00:00.000Z',
      }),
    );
    return admin;
  }

  it('finds everything newest first, with the total, when nothing narrows it', async () => {
    const admin = await seeded();

    const found = admin.searchInboxActivities({});

    assert.equal(found.total, 3);
    assert.deepEqual(
      found.items.map((one) => one.activityType),
      ['Announce', 'Create', 'Like'],
    );
  });

  it('narrows by type, actor, object, reply target, recipient and time', async () => {
    const admin = await seeded();
    const types = (search: Parameters<AdminStore['searchInboxActivities']>[0]) =>
      admin.searchInboxActivities(search).items.map((one) => one.activityType);

    assert.deepEqual(types({ type: 'Like' }), ['Like']);
    assert.deepEqual(types({ actor: BOB }), ['Create']);
    assert.deepEqual(types({ object: POST }), ['Announce', 'Like']);
    assert.deepEqual(types({ inReplyTo: POST }), ['Create']);
    assert.deepEqual(types({ recipient: 'ada' }), ['Create']);
    assert.deepEqual(types({ since: '2026-03-02T00:00:00.000Z' }), ['Announce', 'Create']);
    assert.deepEqual(types({ until: '2026-03-02T00:00:00.000Z' }), ['Like']);
    assert.deepEqual(types({ activityId: 'https://remote.example/boosts/1' }), ['Announce']);
    assert.deepEqual(types({ actor: ADA, type: 'Announce' }), ['Announce']);
  });

  it('finds one row by its id', async () => {
    const admin = await seeded();
    const [newest] = admin.listInboxActivities({ limit: 1 });
    assert.ok(newest !== undefined);

    assert.deepEqual(admin.searchInboxActivities({ id: newest.id }).items, [newest]);
  });

  it('pages, counting every match rather than the page', async () => {
    const admin = await seeded();

    const page = admin.searchInboxActivities({}, { limit: 1, offset: 1 });

    assert.equal(page.total, 3);
    assert.deepEqual(
      page.items.map((one) => one.activityType),
      ['Create'],
    );
  });
});

describe('searching the delivery outcomes', () => {
  const OLD_ID = 'https://blog.example/?p=813';

  function delivery(overrides: Partial<NewDelivery> = {}): NewDelivery {
    return {
      activityId: `${POST}#create`,
      activityType: 'Create',
      objectId: POST,
      slug: 'hello',
      actorId: ADA,
      inboxId: 'https://remote.example/inbox',
      status: 'sent',
      error: null,
      attemptedAt: '2026-03-01T00:00:00.000Z',
      ...overrides,
    };
  }

  async function seeded(): Promise<AdminStore> {
    const admin = await store();
    admin.recordDelivery(delivery());
    admin.recordDelivery(
      delivery({
        actorId: BOB,
        inboxId: 'https://other.example/inbox',
        status: 'failed',
        error: 'HTTP 403',
      }),
    );
    admin.recordDelivery(
      delivery({
        activityId: `${POST}#update-1`,
        activityType: 'Update',
        status: 'retrying',
        error: 'HTTP 502',
        attemptedAt: '2026-03-02T00:00:00.000Z',
      }),
    );
    admin.recordDelivery(
      delivery({
        activityId: `${OLD_ID}#delete`,
        activityType: 'Delete',
        objectId: OLD_ID,
        attemptedAt: '2026-02-01T00:00:00.000Z',
      }),
    );
    admin.recordDelivery(
      delivery({
        activityId: 'https://blog.example/2026/04/other/#create',
        objectId: 'https://blog.example/2026/04/other/',
        slug: 'other',
        status: 'failed',
        error: 'timed out',
        attemptedAt: '2026-04-01T00:00:00.000Z',
      }),
    );
    return admin;
  }

  it('lists the activities sent about a post under any of its ids, newest first, with counts', async () => {
    const admin = await seeded();

    const sent = admin.listSentActivitiesAbout([POST, OLD_ID]);

    assert.deepEqual(
      sent.map((one) => [one.activityType, one.objectId, one.lastAttemptedAt, one.counts]),
      [
        [
          'Update',
          POST,
          '2026-03-02T00:00:00.000Z',
          { sent: 0, queued: 0, retrying: 1, failed: 0 },
        ],
        [
          'Create',
          POST,
          '2026-03-01T00:00:00.000Z',
          { sent: 1, queued: 0, retrying: 0, failed: 1 },
        ],
        [
          'Delete',
          OLD_ID,
          '2026-02-01T00:00:00.000Z',
          { sent: 1, queued: 0, retrying: 0, failed: 0 },
        ],
      ],
    );
  });

  it('narrows deliveries by object, activity, status and inbox, newest first, paged', async () => {
    const admin = await seeded();
    const errors = (search: Parameters<AdminStore['searchDeliveries']>[0]) =>
      admin.searchDeliveries(search).items.map((one) => one.error);

    assert.deepEqual(errors({ objectIds: [POST], statuses: ['failed'] }), ['HTTP 403']);
    assert.deepEqual(errors({ statuses: ['failed', 'retrying'] }), [
      'timed out',
      'HTTP 502',
      'HTTP 403',
    ]);
    assert.deepEqual(errors({ activityId: `${POST}#update-1` }), ['HTTP 502']);
    assert.deepEqual(errors({ inboxId: 'https://other.example/inbox' }), ['HTTP 403']);

    const page = admin.searchDeliveries({}, { limit: 2, offset: 1 });
    assert.equal(page.total, 5);
    assert.deepEqual(
      page.items.map((one) => one.error),
      ['HTTP 502', 'HTTP 403'],
    );
  });
});
