import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { PluginDataFolder } from '@geekity/cms/plugin';

import { followerCounts } from '../src/followers.ts';
import { fakeTagsPub } from './tags-pub.ts';
import type { FakeTagsPub } from './tags-pub.ts';

/**
 * A lookup that outlasts its timeout (TASK-286), with a short timeout so the
 * test does not wait the plugin's five seconds.
 */

const folder = mkdtempSync(path.join(tmpdir(), 'geekity-tags-followers-'));
let tagsPub: FakeTagsPub;

before(async () => {
  tagsPub = await fakeTagsPub();
});
after(async () => {
  await tagsPub.close();
  rmSync(folder, { recursive: true, force: true });
});

const data: PluginDataFolder = {
  path: folder,
  read: () => undefined,
  update: () => Promise.reject(new Error('a failed lookup writes nothing')),
};

describe('followerCounts', () => {
  it('gives up on a lookup that does not answer in time, leaving its count unknown', async () => {
    tagsPub.delayMs = 2_000;
    const started = Date.now();
    const counts = await followerCounts(['slow'], {
      fetch: (url, init) =>
        fetch(url, {
          ...(init.headers === undefined ? {} : { headers: init.headers }),
          ...(init.signal === undefined ? {} : { signal: init.signal }),
        }),
      server: tagsPub.url,
      userAgent: 'Test/1.0',
      data,
      timeoutMs: 50,
      signal: new AbortController().signal,
    });
    assert.deepEqual(counts.get('slow'), {
      known: false,
      reason: 'tags.pub did not answer in time',
    });
    assert.ok(Date.now() - started < 1_000, 'it did not wait for the answer');
  });
});
