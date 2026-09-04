import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Document } from './document.ts';
import { createScheduler, isScheduled, MAXIMUM_DELAY_MS, scheduledFor } from './schedule.ts';
import type { ScheduleTimers, ScheduleWatermark } from './schedule.ts';
import { openContentStore } from './store.ts';
import type { ContentStore } from './store.ts';
import type { DocumentChange } from './sync.ts';

const temporaryDirs: string[] = [];
const openStores: ContentStore[] = [];

after(async () => {
  for (const opened of openStores) opened.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The smallest post the store will accept, with overrides on top. */
function post(overrides: Partial<Document> = {}): Document {
  return {
    type: 'post',
    path: 'posts/2026-09-04-tomorrow.md',
    slug: 'tomorrow',
    permalink: '/2026/09/tomorrow/',
    title: 'Tomorrow',
    date: '2026-09-04T09:00:00Z',
    tags: [],
    categories: [],
    draft: false,
    extra: {},
    body: 'Body.',
    html: '<p>Body.</p>\n',
    hash: 'a'.repeat(64),
    ...overrides,
  };
}

/** A timer nothing waits for: the test decides when it goes off. */
function fakeTimers(): ScheduleTimers & {
  /** The delay the timer currently in flight was set for. */
  delay(): number | undefined;
  /** Run it, as the real one would. */
  fire(): void;
} {
  let pending: { callback: () => void; delayMs: number } | undefined;
  let nextHandle = 1;

  return {
    set(callback, delayMs) {
      pending = { callback, delayMs };
      return nextHandle++;
    },
    clear() {
      pending = undefined;
    },
    delay() {
      return pending?.delayMs;
    },
    fire() {
      const running = pending;
      assert.ok(running !== undefined, 'a timer was armed');
      pending = undefined;
      running.callback();
    },
  };
}

/** The watermark, in memory. */
function watermarkAt(initial?: string): ScheduleWatermark & { value(): string | undefined } {
  let stored = initial;
  return {
    read: () => stored,
    write(instant) {
      stored = instant;
    },
    value: () => stored,
  };
}

/** A scheduler over a store this test moves the clock of, recording what it announced. */
async function harness(
  options: { now?: string; watermark?: string | null; documents?: Document[] } = {},
): Promise<{
  store: ContentStore;
  announced: DocumentChange[];
  timers: ReturnType<typeof fakeTimers>;
  watermark: ReturnType<typeof watermarkAt>;
  scheduler: ReturnType<typeof createScheduler>;
  set: (instant: string) => void;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-schedule-'));
  temporaryDirs.push(dir);

  let now = new Date(options.now ?? '2026-09-03T12:00:00Z');
  const store = openContentStore({ dataDir: dir, now: () => now });
  openStores.push(store);
  store.upsertAll(options.documents ?? [post()]);

  const announced: DocumentChange[] = [];
  const timers = fakeTimers();
  const watermark = watermarkAt(
    options.watermark === null ? undefined : (options.watermark ?? '2026-09-03T12:00:00.000Z'),
  );
  const scheduler = createScheduler({
    store,
    watermark,
    timers,
    announce: async (change) => {
      announced.push(change);
      await Promise.resolve();
    },
  });

  return {
    store,
    announced,
    timers,
    watermark,
    scheduler,
    set: (instant: string) => {
      now = new Date(instant);
    },
  };
}

describe('isScheduled', () => {
  it('holds a document whose date is ahead of the clock and releases it on the instant', () => {
    const at = new Date('2026-09-04T09:00:00Z');

    assert.equal(isScheduled({ date: '2026-09-04T09:00:00Z' }, new Date(at.getTime() - 1)), true);
    assert.equal(isScheduled({ date: '2026-09-04T09:00:00Z' }, at), false);
    assert.equal(isScheduled({ date: '2026-09-04T04:00:00-05:00' }, at), false);
  });

  it('holds nothing that has no readable date, so an undated page is never scheduled', () => {
    const at = new Date('2026-09-03T12:00:00Z');

    assert.equal(isScheduled({ date: undefined }, at), false);
    assert.equal(isScheduled({ date: 'not a date' }, at), false);
  });

  it('says when a held document is due, and nothing about one that is not held', () => {
    assert.equal(
      scheduledFor({ date: '2026-09-04T04:00:00-05:00' }, new Date('2026-09-03T12:00:00Z')),
      '2026-09-04T09:00:00.000Z',
    );
    assert.equal(
      scheduledFor({ date: '2026-09-04T09:00:00Z' }, new Date('2026-09-04T09:00:00Z')),
      undefined,
    );
  });
});

describe('the scheduler', () => {
  it('waits for the next document due and announces it as a publish when the time comes', async () => {
    const box = await harness();

    await box.scheduler.start();

    assert.equal(box.scheduler.waitingFor(), '2026-09-04T09:00:00.000Z');
    assert.equal(box.timers.delay(), 21 * 60 * 60 * 1000);
    assert.equal(box.announced.length, 0, 'nothing is announced while it waits');

    box.set('2026-09-04T09:00:00Z');
    box.timers.fire();
    await box.scheduler.settled();

    assert.equal(box.announced.length, 1);
    const change = box.announced[0];
    assert.ok(change !== undefined);
    assert.equal(change.origin, 'schedule');
    assert.equal(change.type, 'created');
    assert.equal(change.path, 'posts/2026-09-04-tomorrow.md');
    assert.equal(change.previous, undefined, 'no subscriber knew about it before');
    assert.equal(change.next?.title, 'Tomorrow');
    assert.equal(box.scheduler.waitingFor(), undefined, 'nothing is left to wait for');
  });

  it('announces a document that came due while nothing was running, and only once', async () => {
    const box = await harness({ now: '2026-09-04T10:00:00Z' });

    await box.scheduler.start();

    assert.deepEqual(
      box.announced.map((change) => change.next?.title),
      ['Tomorrow'],
    );

    await box.scheduler.run();

    assert.equal(box.announced.length, 1, 'the watermark moved past it');
  });

  it('announces nothing at all on a site that has never run one', async () => {
    const box = await harness({ now: '2026-09-04T10:00:00Z', watermark: null });

    await box.scheduler.start();

    assert.deepEqual(box.announced, [], 'a rebuilt database does not announce the archive');
    assert.equal(box.watermark.value(), '2026-09-04T10:00:00.000Z');
  });

  it('re-arms when a change moves the date, and stops waiting when one becomes a draft', async () => {
    const box = await harness();
    await box.scheduler.start();

    box.store.upsert(post({ date: '2026-09-10T09:00:00Z' }));
    box.scheduler.handle(changeFor(box.store));

    assert.equal(box.scheduler.waitingFor(), '2026-09-10T09:00:00.000Z');

    box.store.upsert(post({ date: '2026-09-10T09:00:00Z', draft: true }));
    box.scheduler.handle(changeFor(box.store));

    assert.equal(box.scheduler.waitingFor(), undefined);
    assert.equal(box.timers.delay(), undefined, 'the timer was cleared');
  });

  it('waits in hops rather than overflowing setTimeout on a post dated years out', async () => {
    const box = await harness({ documents: [post({ date: '2099-01-01T00:00:00Z' })] });

    await box.scheduler.start();

    assert.equal(box.timers.delay(), MAXIMUM_DELAY_MS);

    box.timers.fire();
    await box.scheduler.settled();

    assert.deepEqual(box.announced, [], 'the hop published nothing');
    assert.equal(box.timers.delay(), MAXIMUM_DELAY_MS, 'and it is waiting again');
  });

  it('keeps waiting when an announcement throws, rather than losing the timer', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'geekity-schedule-'));
    temporaryDirs.push(dir);
    let now = new Date('2026-09-03T12:00:00Z');
    const store = openContentStore({ dataDir: dir, now: () => now });
    openStores.push(store);
    store.upsertAll([
      post(),
      post({
        path: 'posts/2026-09-05-later.md',
        slug: 'later',
        permalink: '/2026/09/later/',
        title: 'Later',
        date: '2026-09-05T09:00:00Z',
      }),
    ]);
    const warnings: string[] = [];
    const timers = fakeTimers();
    const scheduler = createScheduler({
      store,
      timers,
      watermark: watermarkAt('2026-09-03T12:00:00.000Z'),
      logger: { warn: (message) => warnings.push(message) },
      announce: () => Promise.reject(new Error('the subscriber blew up')),
    });

    await scheduler.start();
    now = new Date('2026-09-04T09:00:00Z');
    timers.fire();
    await scheduler.settled();

    assert.deepEqual(
      warnings,
      ['Could not announce posts/2026-09-04-tomorrow.md as published: the subscriber blew up'],
      'the failure is reported against the document it happened to',
    );
    assert.equal(scheduler.waitingFor(), '2026-09-05T09:00:00.000Z', 'and the next one is armed');
  });
});

/** A change carrying whatever the store now holds, which is all `handle` reads. */
function changeFor(store: ContentStore): DocumentChange {
  const document = store.getByPath('posts/2026-09-04-tomorrow.md');
  return {
    type: 'updated',
    path: 'posts/2026-09-04-tomorrow.md',
    previous: undefined,
    next: document,
    origin: 'admin',
  };
}
