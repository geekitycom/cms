import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms, createUser, pluginDataFolder } from '@geekity/cms';
import type { Cms } from '@geekity/cms';

import wordpress from '../src/index.ts';
import { wordPressRecords } from '../src/records.ts';
import { signIn, writeSite } from './site.ts';

/**
 * The plugin's screen under Plugins (TASK-282): when each old path was last
 * asked for, which used to sit beside the switch on Federation > Settings.
 */

const SCREEN = '/admin/plugins/@geekity/plugin-wordpress';
const ADA = { username: 'ada', password: 'correct horse battery' };

const started: Cms[] = [];
const dirs: string[] = [];

after(async () => {
  for (const cms of started) await cms.close();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function site(enabled = true): Promise<Cms> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-wp-screen-data-'));
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-wp-screen-content-'));
  dirs.push(dataDir, contentDir);
  writeSite(contentDir, { baseUrl: 'http://localhost', author: ADA.username, enabled });
  await createUser({ dataDir, ...ADA });
  const cms = createCms({ dataDir, contentDir, watch: false, plugins: [wordpress] });
  started.push(cms);
  return cms;
}

function records(cms: Cms) {
  return wordPressRecords(pluginDataFolder(cms.config.dataDir, wordpress.name));
}

describe('the WordPress screen', () => {
  it('lists every path with never until one is asked for, then when it was', async () => {
    const cms = await site();
    await records(cms).setNumber(ADA.username, 2);
    const admin = await signIn(cms.app, ADA);

    const empty = await (await admin.get(SCREEN)).text();
    assert.match(empty, /<h1[^>]*>WordPress<\/h1>/);
    assert.match(empty, /wp-json\/activitypub\/1\.0\/actors\/2\/inbox/);
    assert.match(empty, /wp-json\/activitypub\/1\.0\/inbox/);
    assert.match(empty, /Never/, 'a path nobody has asked for says so');
    assert.match(empty, /refetched the actor/, 'and the note says when to disable the plugin');

    await records(cms).recordRequest({
      target: { route: 'inbox', wordpressActorId: '2' },
      username: ADA.username,
      at: new Date('2026-09-01T10:00:00.000Z'),
    });

    const asked = await (await admin.get(SCREEN)).text();
    assert.match(asked, /1 September 2026|September 1, 2026/, 'the instant is shown');
  });

  it('says so when no user carries a WordPress actor id', async () => {
    const cms = await site();
    const admin = await signIn(cms.app, ADA);

    const html = await (await admin.get(SCREEN)).text();

    assert.match(html, /No user carries a WordPress actor id/);
    assert.match(html, /<code>geekity import wordpress-actor<\/code>/);
  });

  it('is under Plugins in the menu, and gone while the plugin is disabled', async () => {
    const enabled = await signIn((await site()).app, ADA);
    assert.match(
      await (await enabled.get('/admin/plugins')).text(),
      new RegExp(`href="${SCREEN}"`),
    );

    const disabled = await signIn((await site(false)).app, ADA);
    assert.equal((await disabled.get(SCREEN)).status, 404);
    assert.doesNotMatch(
      await (await disabled.get('/admin/plugins')).text(),
      new RegExp(`href="${SCREEN}"`),
    );
  });
});
