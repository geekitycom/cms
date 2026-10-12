import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { nextEvent } from './__testing__/wait.ts';
import { liveWatchers } from './__testing__/watchers.ts';
import { writeFileAtomically, WritesRefusedError } from './files/atomic.ts';
import { createCms } from './index.ts';
import type { Cms } from './index.ts';
import { definePlugin, HOST_API_VERSION } from './plugin.ts';
import { DEFAULT_SITE_SETTINGS } from './site/settings.ts';
import { writeSiteJson } from './site/site-json.ts';

const temporaryDirs: string[] = [];
const started: Cms[] = [];

after(async () => {
  for (const cms of started) await cms.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const PLUGIN = '@acme/plugin-ticker';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Count the interval timers set and not yet cleared from here on. The
 * services' default timers call the global `setInterval` when started.
 */
function liveIntervals(): { live(): number; restore(): void } {
  const set = globalThis.setInterval;
  const clear = globalThis.clearInterval;
  const live = new Set<unknown>();
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const handle = set(...args);
    live.add(handle);
    return handle;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle: Parameters<typeof clearInterval>[0]) => {
    live.delete(handle);
    clear(handle);
  }) as typeof clearInterval;
  return {
    live: () => live.size,
    restore() {
      globalThis.setInterval = set;
      globalThis.clearInterval = clear;
    },
  };
}

const NOW = new Date('2026-06-01T00:00:00.000Z');

/** A serving CMS with one enabled plugin that records its start and stop, and a post due next year. */
async function serving(): Promise<{
  cms: Cms;
  contentDir: string;
  dataDir: string;
  log: string[];
}> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-drain-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-drain-data-'));
  temporaryDirs.push(contentDir, dataDir);

  await writeSiteJson({ contentDir, settings: { ...DEFAULT_SITE_SETTINGS, timezone: 'UTC' } });
  const siteJson = path.join(contentDir, '_data', 'site.json');
  const site = JSON.parse(await readFile(siteJson, 'utf8')) as Record<string, unknown>;
  await writeFile(siteJson, JSON.stringify({ ...site, plugins: { [PLUGIN]: { enabled: true } } }));

  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, 'posts', 'later.md'),
    '---\ntitle: Later\ndate: 2027-01-01T00:00:00.000Z\n---\n\nNot yet.\n',
  );

  const log: string[] = [];
  const cms = createCms({
    contentDir,
    dataDir,
    port: 0,
    watch: true,
    now: () => NOW,
    baseUrl: 'https://drain.example',
    plugins: [
      definePlugin({
        name: PLUGIN,
        version: '1.0.0',
        label: 'Ticker',
        description: 'Starts and stops.',
        hostApi: HOST_API_VERSION,
        requires: {},
        register() {},
        start() {
          log.push('start');
        },
        stop() {
          log.push('stop');
        },
      }),
    ],
  });
  started.push(cms);
  return { cms, contentDir, dataDir, log };
}

describe('cms.drain()', () => {
  it('answers GET and HEAD, and refuses other methods with 503 and Retry-After, until resumed', async () => {
    const { cms } = await serving();
    cms.app.post('/echo', (c) => c.text('ok'));
    await cms.serve();

    await cms.drain();
    const refused = await cms.app.request('/echo', { method: 'POST' });
    assert.equal(refused.status, 503);
    assert.equal(refused.headers.get('retry-after'), '5');
    assert.equal(refused.headers.get('connection'), 'close');

    const read = await cms.app.request('/_geekity/health');
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('connection'), 'close', 'the client opens a new connection');
    assert.equal((await cms.app.request('/_geekity/health', { method: 'HEAD' })).status, 200);

    await cms.resume();
    const accepted = await cms.app.request('/echo', { method: 'POST' });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get('connection'), null);
  });

  it('once drained and closing, sends a reader to the same URL on a new connection (TASK-309)', async () => {
    const { cms } = await serving();
    cms.app.post('/echo', (c) => c.text('ok'));
    await cms.serve();
    await cms.drain();

    const closing = cms.close();
    const moved = await cms.app.request('/_geekity/health?from=old');
    assert.equal(moved.status, 307);
    assert.equal(moved.headers.get('location'), '/_geekity/health?from=old');
    assert.equal(moved.headers.get('connection'), 'close');
    const refused = await cms.app.request('/echo', { method: 'POST' });
    assert.equal(refused.status, 503, 'a write is still refused, to be retried');
    await closing;
  });

  it('lets a write already in flight finish before it stops anything', async () => {
    const { cms, log } = await serving();
    const held = deferred();
    const entered = deferred();
    cms.app.post('/slow', async (c) => {
      entered.resolve();
      await held.promise;
      return c.text('finished');
    });
    await cms.serve();

    const slow = cms.app.request('/slow', { method: 'POST' });
    await entered.promise;
    let reportWaiting: (writes: number) => void = () => undefined;
    const waiting = nextEvent<number>('the drain to say it waits for the write', (done) => {
      reportWaiting = done;
    });
    let drained = false;
    const draining = cms.drain(reportWaiting).then(() => {
      drained = true;
    });

    assert.equal((await cms.app.request('/slow', { method: 'POST' })).status, 503);
    const writes = await Promise.race([
      waiting,
      draining.then(() => {
        throw new Error('the drain finished without waiting for the write in flight');
      }),
    ]);
    assert.equal(writes, 1, 'the drain waits for the one write in flight');
    assert.equal(drained, false);
    assert.deepEqual(log, ['start'], 'nothing has stopped');

    held.resolve();
    const response = await slow;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'finished');
    await draining;
  });

  it('says nothing about waiting when no write is in flight', async () => {
    const { cms } = await serving();
    await cms.serve();
    const waited: number[] = [];

    await cms.drain((writes) => waited.push(writes));

    assert.deepEqual(waited, []);
  });

  it('stops the scheduler, the watcher and the plugins before it resolves, and restarts them on resume', async (t) => {
    const { cms, contentDir, log } = await serving();
    const intervals = liveIntervals();
    const watchers = liveWatchers();
    t.after(() => watchers.restore());
    await cms.serve();
    assert.equal(watchers.live(), 1, 'the content watcher runs');
    assert.equal(
      intervals.live(),
      5,
      'digests, retention, avatars, actor profiles and the reply backfill tick',
    );
    assert.notEqual(cms.scheduler.waitingFor(), undefined, 'the scheduler waits for the post');
    assert.deepEqual(log, ['start']);

    await cms.drain();
    assert.equal(intervals.live(), 0, 'every interval timer is cleared');
    assert.equal(cms.scheduler.waitingFor(), undefined, 'the scheduler stopped');
    assert.deepEqual(log, ['start', 'stop'], 'the plugin stopped');

    await cms.app.request('/_geekity/health');
    assert.deepEqual(log, ['start', 'stop'], 'a request does not start it again');

    assert.equal(watchers.live(), 0, 'the watcher stopped');
    await writeFile(
      path.join(contentDir, 'posts', 'unseen.md'),
      '---\ntitle: Unseen\ndate: 2026-01-01T00:00:00.000Z\n---\n\nHello.\n',
    );

    await cms.resume();
    assert.equal(watchers.live(), 1, 'the watcher is back');
    assert.equal(intervals.live(), 5, 'the interval timers are back');
    intervals.restore();
    assert.notEqual(cms.scheduler.waitingFor(), undefined, 'the scheduler is back');
    assert.deepEqual(log, ['start', 'stop', 'start'], 'the plugin is back');
    assert.deepEqual(
      cms.store
        .listAll()
        .map((d) => d.title)
        .sort(),
      ['Later', 'Unseen'],
      'the scan read what changed meanwhile',
    );
  });

  it('writes nothing to the database, data/ or content/ once drained', async () => {
    const { cms, contentDir, dataDir } = await serving();
    await cms.serve();
    await cms.drain();

    assert.throws(() => cms.admin.setState('after', 'drain'), /readonly/);
    await assert.rejects(
      writeFileAtomically(path.join(dataDir, 'late.json'), '{}'),
      WritesRefusedError,
    );
    await assert.rejects(
      writeFileAtomically(path.join(contentDir, 'late.md'), ''),
      WritesRefusedError,
    );

    await cms.resume();
    cms.admin.setState('after', 'resume');
    await writeFileAtomically(path.join(dataDir, 'late.json'), '{}');
  });

  it('answers a GET that tries to write while drained with 503 and Retry-After', async () => {
    const { cms } = await serving();
    cms.app.get('/remember', (c) => {
      c.var.admin.setState('seen', 'yes');
      return c.text('remembered');
    });
    await cms.serve();
    await cms.drain();

    const response = await cms.app.request('/remember');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '5');
  });
});
