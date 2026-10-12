import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { liveWatchers } from './watchers.ts';

const directories: string[] = [];
after(() => Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true }))));

async function directory(): Promise<string> {
  const made = await mkdtemp(path.join(tmpdir(), 'geekity-watchers-'));
  directories.push(made);
  return made;
}

describe('liveWatchers', () => {
  it('sees a watch opened through the node:fs import until it is closed', async () => {
    const watchers = liveWatchers();
    try {
      const opened = watch(await directory(), { recursive: true });
      assert.equal(watchers.watching(), true);

      opened.close();
      assert.equal(watchers.watching(), false);
    } finally {
      watchers.restore();
    }
  });

  it('sees nothing opened before it began or after it was restored', async () => {
    const before = watch(await directory());
    const watchers = liveWatchers();
    watchers.restore();
    const later = watch(await directory());

    assert.equal(watchers.watching(), false);
    before.close();
    later.close();
  });
});
