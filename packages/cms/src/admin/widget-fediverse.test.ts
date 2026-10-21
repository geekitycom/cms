import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import type { NewInboxActivity } from '../store/admin-store.ts';
import {
  ELEVEN_PM_19_OCTOBER_IN_CHICAGO,
  TEN_AM_20_OCTOBER_IN_CHICAGO,
} from './__testing__/chicago-clock.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { screenOf, text } from './__testing__/markup.ts';

const ELEVEN_PM_13_OCTOBER_IN_CHICAGO = '2026-10-14T04:00:00.000Z';

const box = sandbox();
after(() => box.cleanup());

const POST = 'https://blog.example/2026/10/hello/';
const ADA = 'https://remote.example/users/ada';

let sequence = 0;

function activity(
  activityType: string,
  receivedAt: string,
  fields: Partial<NewInboxActivity> = {},
): NewInboxActivity {
  sequence += 1;
  const activityId = `https://remote.example/activities/${String(sequence)}`;
  return {
    activityId,
    activityType,
    actorId: ADA,
    objectId: POST,
    receivedAt,
    json: JSON.stringify({ id: activityId, type: activityType, actor: ADA, object: POST }),
    ...fields,
  };
}

function reply(receivedAt: string): NewInboxActivity {
  sequence += 1;
  const activityId = `https://remote.example/creates/${String(sequence)}`;
  const note = `https://remote.example/notes/${String(sequence)}`;
  return activity('Create', receivedAt, {
    activityId,
    objectId: note,
    json: JSON.stringify({
      id: activityId,
      type: 'Create',
      actor: ADA,
      object: { id: note, type: 'Note', inReplyTo: POST },
    }),
  });
}

async function site(): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-fediverse-widget-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', timezone: 'America/Chicago' }),
    'utf8',
  );
  const cms = await box.site({ contentDir, now: () => TEN_AM_20_OCTOBER_IN_CHICAGO });
  return { cms, agent: await signedIn(cms) };
}

function seed(cms: Cms): void {
  const log = (entry: NewInboxActivity) => cms.admin.logInboxActivity(entry);
  log(activity('Like', ELEVEN_PM_19_OCTOBER_IN_CHICAGO));
  log(
    activity('Like', '2026-10-20T06:00:00.000Z', { actorId: 'https://remote.example/users/bob' }),
  );
  log(activity('Announce', '2026-10-15T12:00:00.000Z'));
  log(reply('2026-10-18T12:00:00.000Z'));
  const undone = log(
    activity('Like', '2026-10-16T12:00:00.000Z', { actorId: 'https://remote.example/users/cal' }),
  );
  log(
    activity('Undo', '2026-10-16T13:00:00.000Z', {
      actorId: 'https://remote.example/users/cal',
      objectId: undone.activityId,
    }),
  );
  log(activity('Like', '2026-10-10T12:00:00.000Z', { objectId: 'https://blog.example/a/' }));
  log(activity('Like', ELEVEN_PM_13_OCTOBER_IN_CHICAGO, { objectId: 'https://blog.example/b/' }));
  log(activity('Like', '2026-10-01T12:00:00.000Z', { objectId: 'https://blog.example/c/' }));
}

async function dashboard(agent: Browser, query = ''): Promise<string> {
  const response = await agent.get(`/admin${query}`);
  assert.equal(response.status, 200);
  return await response.text();
}

describe('the fediverse widget (TASK-445)', () => {
  it('draws likes, boosts and replies per day for the last 7 days, in the site’s time zone', async () => {
    const { cms, agent } = await site();
    seed(cms);

    const words = text(screenOf(await dashboard(agent)));

    assert.match(words, /Fediverse/);
    assert.match(words, /Day Likes Boosts Replies/);
    assert.match(words, /14 Oct 2026 0 0 0/);
    assert.match(words, /15 Oct 2026 0 1 0/);
    assert.match(words, /16 Oct 2026 0 0 0/);
    assert.match(words, /18 Oct 2026 0 0 1/);
    assert.match(words, /19 Oct 2026 1 0 0/);
    assert.match(words, /20 Oct 2026 1 0 0/);
    assert.doesNotMatch(words, /13 Oct 2026/);
    assert.doesNotMatch(words, /21 Oct 2026/);
  });

  it('shows each total for the period with its change from the period before', async () => {
    const { cms, agent } = await site();
    seed(cms);

    const words = text(screenOf(await dashboard(agent)));

    assert.match(words, /Likes 2 No change from 2/);
    assert.match(words, /Boosts 1 ▲ Up from 0/);
    assert.match(words, /Replies 1 ▲ Up from 0/);
  });

  it('covers 30 days when the owner chooses 30, and 7 for any other choice', async () => {
    const { cms, agent } = await site();
    seed(cms);

    const month = text(screenOf(await dashboard(agent, '?period=30')));
    assert.match(month, /21 Sept 2026 0 0 0/);
    assert.match(month, /1 Oct 2026 1 0 0/);
    assert.match(month, /13 Oct 2026 1 0 0/);
    assert.match(month, /Likes 5 ▲ Up from 0/);
    assert.doesNotMatch(month, /20 Sept 2026/);

    const other = text(screenOf(await dashboard(agent, '?period=90')));
    assert.doesNotMatch(other, /13 Oct 2026/);
    assert.match(other, /Likes 2 /);
  });

  it('offers 7 and 30 days as links, marking the one shown', async () => {
    const { agent } = await site();

    const html = screenOf(await dashboard(agent, '?period=30'));

    assert.match(html, /<a[^>]*href="\/admin"[^>]*>7 days<\/a>/);
    assert.match(
      html,
      /<a[^>]*href="\/admin\?period=30"[^>]*aria-current="page"[^>]*>30 days<\/a>/,
    );
  });

  it('draws every day as zero on a site the fediverse has not reached', async () => {
    const { agent } = await site();

    const words = text(screenOf(await dashboard(agent)));

    assert.match(words, /14 Oct 2026 0 0 0/);
    assert.match(words, /20 Oct 2026 0 0 0/);
    assert.match(words, /Likes 0 No change from 0/);
  });
});
