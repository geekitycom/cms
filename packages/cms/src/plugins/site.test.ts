import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { leakedSecrets, pngWithMetadata } from '../__testing__/metadata.ts';
import { openAdminStore } from '../admin/store.ts';
import type { AdminStore } from '../admin/store.ts';
import { resolveConfig } from '../config.ts';
import type { PluginSite } from '../plugin.ts';
import { pluginSite } from './site.ts';

const roots: string[] = [];
const stores: AdminStore[] = [];
after(async () => {
  for (const store of stores) store.close();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function site(
  limits: { uploadMaxBytes?: number; uploadTypes?: string[] } = {},
): Promise<{ site: PluginSite; contentDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'geekity-plugin-site-'));
  roots.push(root);
  const config = resolveConfig(
    { contentDir: path.join(root, 'content'), dataDir: path.join(root, 'data'), ...limits },
    { env: {} },
  );
  const admin = openAdminStore({ dataDir: config.dataDir });
  stores.push(admin);
  return { site: pluginSite({ admin, config }), contentDir: config.contentDir };
}

describe('PluginSite.checkUpload', () => {
  it('answers the bytes the editor would store, metadata stripped, and writes nothing', async () => {
    const { site: plugin, contentDir } = await site();
    const original = await pngWithMetadata();
    assert.notDeepEqual(leakedSecrets(original), []);

    const check = plugin.checkUpload('photo.png', original);

    assert.equal(check.accepted, true);
    assert.deepEqual(check.accepted && leakedSecrets(check.bytes), []);
    await assert.rejects(readdir(contentDir));
  });

  it('refuses a type the site does not accept, saying why', async () => {
    const { site: plugin } = await site();

    const check = plugin.checkUpload('drawing.svg', new TextEncoder().encode('<svg/>'));

    assert.equal(check.accepted, false);
    assert.match(check.accepted ? '' : check.why, /\.svg are not allowed here/);
  });

  it('refuses a file over the site’s limit for its kind', async () => {
    const { site: plugin } = await site({ uploadMaxBytes: 64 });

    const check = plugin.checkUpload('photo.png', await pngWithMetadata());

    assert.equal(check.accepted, false);
    assert.match(
      check.accepted ? '' : check.why,
      /too big\. This site accepts uploads up to 64 bytes/,
    );
  });

  it('refuses a file whose bytes are not the format its name says', async () => {
    const { site: plugin } = await site();

    const check = plugin.checkUpload('photo.png', new TextEncoder().encode('not a png at all'));

    assert.equal(check.accepted, false);
    assert.match(check.accepted ? '' : check.why, /does not look like a \.png/);
  });
});
