import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Context } from 'hono';

import { resolveConfig } from '../config.ts';
import type { GeekityEnv } from './env.ts';
import { createRenderer } from './render.ts';
import { siteView } from './site-view.ts';

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A request context over a content directory whose `site.json` holds `site`. */
async function contextWith(site: Record<string, unknown>): Promise<Context<GeekityEnv>> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-site-view-'));
  temporaryDirs.push(contentDir);
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(path.join(contentDir, '_data', 'site.json'), JSON.stringify(site), 'utf8');

  const config = resolveConfig({ contentDir, themesDir: path.join(contentDir, 'themes') });
  const renderer = createRenderer({ config });
  return { var: { store: {}, renderer, config } } as unknown as Context<GeekityEnv>;
}

describe('the site view', () => {
  it('carries every permalink base, the wiki base among them', async () => {
    const view = siteView(
      await contextWith({ tagBase: 'topics', categoryBase: 'filed', wikiBase: 'notes' }),
    );
    assert.deepEqual(view.bases, { tag: 'topics', category: 'filed', wiki: 'notes' });
  });

  it('serves the default wiki base when the site names none, or one that cannot work', async () => {
    assert.equal(siteView(await contextWith({})).bases.wiki, 'wiki');
    assert.equal(siteView(await contextWith({ wikiBase: 'admin' })).bases.wiki, 'wiki');
    assert.equal(siteView(await contextWith({ wikiBase: 'tag' })).bases.wiki, 'wiki');
  });
});
