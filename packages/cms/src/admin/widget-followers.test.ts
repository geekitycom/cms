import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { recordFollowerChange } from '../federation/follower-history.ts';
import type { FollowerChange } from '../federation/follower-history.ts';
import type { Cms } from '../index.ts';
import {
  ELEVEN_PM_19_OCTOBER_IN_CHICAGO,
  TEN_AM_20_OCTOBER_IN_CHICAGO,
} from './__testing__/chicago-clock.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { screenOf, text } from './__testing__/markup.ts';

const box = sandbox();
after(() => box.cleanup());

async function site(): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-followers-widget-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', timezone: 'America/Chicago' }),
    'utf8',
  );
  const cms = await box.site({ contentDir, now: () => TEN_AM_20_OCTOBER_IN_CHICAGO });
  return { cms, agent: await signedIn(cms) };
}

function follow(cms: Cms, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const actorId = `https://remote.example/users/${String(index)}`;
    cms.admin.putFollower({
      username: 'admin',
      actorId,
      inboxId: `${actorId}/inbox`,
      sharedInboxId: null,
      handle: null,
      name: null,
      iconUrl: null,
      url: null,
    });
  }
}

async function seed(cms: Cms): Promise<void> {
  const change = (at: string, kind: FollowerChange['change'], count: number) =>
    recordFollowerChange(cms.config.dataDir, { at, username: 'admin', change: kind, count });
  await change('2026-10-12T12:00:00.000Z', 'follow', 3);
  await change('2026-10-15T12:00:00.000Z', 'follow', 4);
  await change('2026-10-15T13:00:00.000Z', 'follow', 5);
  await change(ELEVEN_PM_19_OCTOBER_IN_CHICAGO, 'unfollow', 4);
  follow(cms, 4);
}

async function card(agent: Browser, query = ''): Promise<string> {
  const response = await agent.get(`/admin${query}`);
  assert.equal(response.status, 200);
  const [, html = ''] = screenOf(await response.text()).split(
    '<h2 class="card-title">Followers</h2>',
  );
  return text(html.split('<h2 class="card-title">')[0] ?? '');
}

describe('the followers widget (TASK-446)', () => {
  it('charts the count at the end of each of the last 7 days, in the site’s time zone', async () => {
    const { cms, agent } = await site();
    await seed(cms);

    const words = await card(agent);

    assert.match(words, /14 Oct 2026 3 /);
    assert.match(words, /15 Oct 2026 5 /);
    assert.match(words, /18 Oct 2026 5 /);
    assert.match(words, /19 Oct 2026 4 /);
    assert.match(words, /20 Oct 2026 4/);
    assert.doesNotMatch(words, /13 Oct 2026/);
  });

  it('shows the count, and what was gained and lost, against the period before', async () => {
    const { cms, agent } = await site();
    await seed(cms);

    const words = await card(agent);

    assert.match(words, /Followers 4 ▲ \+33%, up from 3/);
    assert.match(words, /Gained 2 ▲ \+100%, up from 1/);
    assert.match(words, /Lost 1 ▲ Up from 0/);
  });

  it('covers 30 days when the owner chooses 30', async () => {
    const { cms, agent } = await site();
    await seed(cms);

    const words = await card(agent, '?period=30');

    assert.match(words, /21 Sept 2026 2 /);
    assert.match(words, /12 Oct 2026 3 /);
    assert.match(words, /Followers 4 ▲ \+100%, up from 2/);
    assert.match(words, /Gained 3 ▲ Up from 0/);
    assert.match(words, /Lost 1 ▲ Up from 0/);
    assert.doesNotMatch(words, /20 Sept 2026/);
  });

  it('draws a site with no history yet at its current count, not climbing from zero', async () => {
    const { cms, agent } = await site();
    follow(cms, 6);

    const words = await card(agent);

    assert.match(words, /14 Oct 2026 6 /);
    assert.match(words, /20 Oct 2026 6/);
    assert.match(words, /Followers 6 No change from 6/);
    assert.match(words, /Gained 0 No change from 0/);
    assert.match(words, /Lost 0 No change from 0/);
  });
});
