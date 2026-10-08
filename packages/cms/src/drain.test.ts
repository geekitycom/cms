import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { DEFAULT_SITE_SETTINGS, writeSiteJson } from './admin/settings.ts';
import { writeFileAtomically, WritesRefusedError } from './files/atomic.ts';
import { createCms } from './index.ts';
import type { Cms } from './index.ts';
import { definePlugin, HOST_API_VERSION } from './plugin.ts';

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

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const nextYear = new Date().getUTCFullYear() + 1;
  await writeFile(
    path.join(contentDir, 'posts', 'later.md'),
    `---\ntitle: Later\ndate: ${String(nextYear)}-01-01T00:00:00.000Z\n---\n\nNot yet.\n`,
  );

  const log: string[] = [];
  const cms = createCms({
    contentDir,
    dataDir,
    port: 0,
    watch: true,
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

  it('lets a write already in flight finish before it stops anything', async () => {
    const { cms } = await serving();
    const held = deferred();
    cms.app.post('/slow', async (c) => {
      await held.promise;
      return c.text('finished');
    });
    await cms.serve();

    const slow = cms.app.request('/slow', { method: 'POST' });
    await pause(20);
    let drained = false;
    const draining = cms.drain().then(() => {
      drained = true;
    });
    await pause(50);

    assert.equal(drained, false, 'the drain waited for the write');
    assert.equal((await cms.app.request('/slow', { method: 'POST' })).status, 503);

    held.resolve();
    const response = await slow;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'finished');
    await draining;
  });

  it('stops the scheduler, the watcher and the plugins before it resolves, and restarts them on resume', async () => {
    const { cms, contentDir, log } = await serving();
    const intervals = liveIntervals();
    await cms.serve();
    assert.equal(intervals.live(), 4, 'digests, retention, avatars and actor profiles tick');
    assert.notEqual(cms.scheduler.waitingFor(), undefined, 'the scheduler waits for the post');
    assert.deepEqual(log, ['start']);

    await cms.drain();
    assert.equal(intervals.live(), 0, 'every interval timer is cleared');
    assert.equal(cms.scheduler.waitingFor(), undefined, 'the scheduler stopped');
    assert.deepEqual(log, ['start', 'stop'], 'the plugin stopped');

    await cms.app.request('/_geekity/health');
    assert.deepEqual(log, ['start', 'stop'], 'a request does not start it again');

    await writeFile(
      path.join(contentDir, 'posts', 'unseen.md'),
      '---\ntitle: Unseen\ndate: 2026-01-01T00:00:00.000Z\n---\n\nHello.\n',
    );
    await pause(400);
    assert.equal(cms.store.listAll().length, 1, 'the watcher stopped');

    await cms.resume();
    assert.equal(intervals.live(), 4, 'the interval timers are back');
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
