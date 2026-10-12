import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

const temporaryDirs: string[] = [];
const started: Cms[] = [];

after(async () => {
  for (const cms of started) await cms.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function site(): Promise<Cms> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-lifecycle-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-lifecycle-data-'));
  temporaryDirs.push(contentDir, dataDir);
  await mkdir(path.join(contentDir, 'pages'), { recursive: true });
  await writeFile(
    path.join(contentDir, 'pages', 'about.md'),
    '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
  );
  const cms = createCms({ contentDir, dataDir, watch: false, port: 0 });
  started.push(cms);
  return cms;
}

function queued(cms: Cms): Record<string, { settled(): Promise<void> }> {
  return {
    scheduler: cms.scheduler,
    delivery: cms.delivery,
    relays: cms.relays,
    webmentions: cms.webmentions,
    replyContexts: cms.replyContexts,
    avatars: cms.avatars,
    actorProfiles: cms.actorProfiles,
    replyBackfill: cms.replyBackfill,
    retention: cms.retention,
    digests: cms.digests,
    notifier: cms.notifier,
    indexNow: cms.indexNow,
    mail: cms.mail,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function holdsUntilEverySettles(
  cms: Cms,
  end: () => Promise<void>,
): Promise<{ called: string[] }> {
  const services = Object.entries(queued(cms));
  const called: string[] = [];
  const releases: (() => void)[] = [];
  const originals = services.map(([, service]) => service.settled.bind(service));
  for (const [name, service] of services) {
    service.settled = () => {
      called.push(name);
      return new Promise<void>((resolve) => releases.push(resolve));
    };
  }

  try {
    let ended = false;
    const ending = end().then(() => {
      ended = true;
    });

    for (let released = 0; released < services.length; released += 1) {
      for (let wait = 0; releases.length <= released && wait < 1000; wait += 1) await tick();
      assert.ok(releases.length > released, `settled() was called ${released} times, then stopped`);
      await tick();
      assert.equal(ended, false, `ended with ${called.at(-1) ?? 'nothing'} still settling`);
      releases[released]?.();
    }
    await ending;
  } finally {
    services.forEach(([, service], index) => {
      const original = originals[index];
      if (original !== undefined) service.settled = original;
    });
    for (const release of releases) release();
  }
  return { called };
}

describe('ending a CMS', () => {
  it('close() waits for every service queue', async () => {
    const cms = await site();
    await cms.serve();

    const { called } = await holdsUntilEverySettles(cms, () => cms.close());

    assert.deepEqual([...called].sort(), Object.keys(queued(cms)).sort());
  });

  it('drain() waits for every service queue', async () => {
    const cms = await site();
    await cms.serve();

    const { called } = await holdsUntilEverySettles(cms, () => cms.drain());

    assert.deepEqual([...called].sort(), Object.keys(queued(cms)).sort());
  });

  it('settles a service that hands work on before the service it hands that work to', async () => {
    const cms = await site();
    await cms.serve();
    const handsWorkTo: [string, string][] = [
      ['scheduler', 'delivery'],
      ['scheduler', 'webmentions'],
      ['scheduler', 'replyContexts'],
      ['scheduler', 'notifier'],
      ['scheduler', 'indexNow'],
      ['digests', 'mail'],
    ];

    const { called } = await holdsUntilEverySettles(cms, () => cms.close());

    for (const [from, to] of handsWorkTo) {
      assert.ok(called.indexOf(from) < called.indexOf(to), `${to} settled before ${from}`);
    }
  });
});

describe('content change subscribers', () => {
  it('hears a change in one fixed order, the site hook last', async () => {
    const cms = await site();
    const heard: string[] = [];
    const delivery = cms.delivery.handle.bind(cms.delivery);
    cms.delivery.handle = (change) => {
      heard.push('delivery');
      return delivery(change);
    };
    for (const name of [
      'webmentions',
      'replyContexts',
      'notifier',
      'indexNow',
      'scheduler',
    ] as const) {
      const service = cms[name];
      const handle = service.handle.bind(service);
      service.handle = (change) => {
        heard.push(name);
        handle(change);
      };
    }
    cms.onDocumentChange(() => {
      heard.push('site');
    });

    await cms.sync();

    assert.deepEqual(heard, [
      'delivery',
      'webmentions',
      'replyContexts',
      'notifier',
      'indexNow',
      'scheduler',
      'site',
    ]);
  });
});
