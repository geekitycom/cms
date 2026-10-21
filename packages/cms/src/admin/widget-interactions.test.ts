import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { addComment } from '../comments/records.ts';
import type { NewComment } from '../comments/records.ts';
import type { Cms } from '../index.ts';
import type { NewInboxActivity } from '../store/admin-store.ts';
import { TEN_AM_20_OCTOBER_IN_CHICAGO } from './__testing__/chicago-clock.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { screenOf, text } from './__testing__/markup.ts';

const box = sandbox();
after(() => box.cleanup());

const POST_ID = 'https://blog.example/2026/10/hello/';
const ADA = 'https://remote.example/users/ada';

const POST = `---
title: Hello there
date: '2026-10-01T09:00:00Z'
permalink: /2026/10/hello/
---

Words.
`;

async function site(): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-interactions-widget-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', timezone: 'America/Chicago' }),
    'utf8',
  );
  await writeFile(path.join(contentDir, 'posts', '2026-10-01-hello.md'), POST, 'utf8');
  const cms = await box.site({
    contentDir,
    baseUrl: 'https://blog.example',
    now: () => TEN_AM_20_OCTOBER_IN_CHICAGO,
  });
  return { cms, agent: await signedIn(cms) };
}

async function comment(cms: Cms, overrides: Partial<NewComment>): Promise<string> {
  const written = await addComment(
    { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
    {
      slug: 'hello',
      permalink: '/2026/10/hello/',
      source: 'comment',
      kind: 'reply',
      status: 'approved',
      author: { name: 'Someone', url: null, email: null, avatar: null },
      content: { markdown: 'Nice.', html: '<p>Nice.</p>' },
      submitted: '2026-10-19T12:00:00.000Z',
      addressHash: null,
      notify: false,
      inReplyTo: null,
      url: null,
      ...overrides,
    },
  );
  return written.id;
}

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
    objectId: POST_ID,
    receivedAt,
    json: JSON.stringify({ id: activityId, type: activityType, object: POST_ID }),
    ...fields,
  };
}

function reply(receivedAt: string, actorId: string): NewInboxActivity {
  sequence += 1;
  const activityId = `https://remote.example/creates/${String(sequence)}`;
  const note = `https://remote.example/notes/${String(sequence)}`;
  return activity('Create', receivedAt, {
    activityId,
    actorId,
    objectId: note,
    json: JSON.stringify({
      id: activityId,
      type: 'Create',
      object: { id: note, type: 'Note', inReplyTo: POST_ID },
    }),
  });
}

function follower(cms: Cms, name: string, followedAt: string): void {
  const actorId = `https://remote.example/users/${name.toLowerCase().replaceAll(' ', '-')}`;
  cms.admin.putFollower({
    username: 'ada',
    actorId,
    inboxId: `${actorId}/inbox`,
    sharedInboxId: null,
    handle: null,
    name,
    iconUrl: null,
    url: null,
    followedAt,
  });
}

async function card(agent: Browser): Promise<string> {
  const response = await agent.get('/admin');
  assert.equal(response.status, 200);
  const [, html = ''] = screenOf(await response.text()).split(
    '<h2 class="card-title">Recent interactions</h2>',
  );
  return html.split('<h2 class="card-title">')[0] ?? '';
}

function who(html: string): string[] {
  return [...html.matchAll(/<tr>\s*<td class="wrap-anywhere">([^<]*)<\/td>/g)].map(
    ([, name]) => name ?? '',
  );
}

describe('the recent interactions widget (TASK-447)', () => {
  it('lists the ten newest across comments, webmentions, the fediverse and followers, newest first', async () => {
    const { cms, agent } = await site();
    for (let day = 1; day <= 4; day += 1) {
      await comment(cms, {
        author: { name: `Commenter ${String(day)}`, url: null, email: null, avatar: null },
        submitted: `2026-10-0${String(day)}T12:00:00.000Z`,
      });
    }
    await comment(cms, {
      source: 'webmention',
      kind: 'like',
      author: { name: 'Webmentioner', url: 'https://bob.example/', email: null, avatar: null },
      url: 'https://bob.example/likes/1',
      submitted: '2026-10-11T12:00:00.000Z',
    });
    cms.admin.logInboxActivity(activity('Like', '2026-10-12T12:00:00.000Z'));
    cms.admin.logInboxActivity(
      activity('Announce', '2026-10-13T12:00:00.000Z', {
        actorId: 'https://remote.example/users/booster',
      }),
    );
    cms.admin.logInboxActivity(reply('2026-10-14T12:00:00.000Z', 'https://other.example/@cal'));
    follower(cms, 'Grace Hopper', '2026-10-15T12:00:00.000Z');
    follower(cms, 'Alan Turing', '2026-10-05T12:00:00.000Z');
    await comment(cms, {
      author: { name: 'Newest', url: null, email: null, avatar: null },
      submitted: '2026-10-16T12:00:00.000Z',
    });
    await comment(cms, {
      author: { name: 'Eleventh', url: null, email: null, avatar: null },
      submitted: '2026-09-30T12:00:00.000Z',
    });

    const html = await card(agent);

    assert.deepEqual(who(html), [
      'Newest',
      'Grace Hopper',
      '@cal@other.example',
      '@booster@remote.example',
      '@ada@remote.example',
      'Webmentioner',
      'Alan Turing',
      'Commenter 4',
      'Commenter 3',
      'Commenter 2',
    ]);
  });

  it('names who, what, which post and when, and links each to where the owner acts on it', async () => {
    const { cms, agent } = await site();
    const id = await comment(cms, {
      author: { name: 'Ada Lovelace', url: null, email: null, avatar: null },
      submitted: '2026-10-19T14:30:00.000Z',
    });
    await comment(cms, {
      source: 'webmention',
      kind: 'repost',
      author: { name: 'Bob', url: 'https://bob.example/', email: null, avatar: null },
      url: 'https://bob.example/reposts/1',
      submitted: '2026-10-19T13:00:00.000Z',
    });
    cms.admin.logInboxActivity(activity('Like', '2026-10-19T12:00:00.000Z'));
    cms.admin.logInboxActivity(
      activity('Announce', '2026-10-19T11:00:00.000Z', {
        actorId: 'https://remote.example/users/booster',
      }),
    );
    cms.admin.logInboxActivity(reply('2026-10-19T10:00:00.000Z', 'https://other.example/@cal'));
    follower(cms, 'Grace Hopper', '2026-10-19T09:00:00.000Z');

    const html = await card(agent);
    const words = text(html);

    assert.match(words, /Who What When/);
    assert.match(words, /Ada Lovelace Comment on Hello there 19 Oct, 09:30/);
    assert.match(words, /Bob Webmention repost of Hello there 19 Oct, 08:00/);
    assert.match(words, /@ada@remote\.example Fediverse like of Hello there 19 Oct, 07:00/);
    assert.match(words, /@booster@remote\.example Fediverse boost of Hello there/);
    assert.match(words, /@cal@other\.example Fediverse reply to Hello there/);
    assert.match(words, /Grace Hopper New follower 19 Oct, 04:00/);

    assert.ok(
      html.includes(
        `<a class="link" href="/admin/comments?status=approved#comment-${id}">Comment on Hello there</a>`,
      ),
      'a comment links to its place in the moderation list',
    );
    assert.match(
      html,
      /<a class="link" href="\/admin\/posts\/[^"]+">Fediverse like of Hello there<\/a>/,
    );
    assert.ok(
      html.includes('<a class="link" href="/admin/federation">New follower</a>'),
      'a follower links to the federation screen',
    );
  });

  it('leaves out fediverse activity about something that is not one of the site’s posts', async () => {
    const { cms, agent } = await site();
    cms.admin.logInboxActivity(
      activity('Like', '2026-10-19T12:00:00.000Z', {
        objectId: 'https://elsewhere.example/notes/1',
      }),
    );
    cms.admin.logInboxActivity(activity('Like', '2026-10-18T12:00:00.000Z'));

    const words = text(await card(agent));

    assert.equal(words.match(/Fediverse like/g)?.length, 1);
  });

  it('marks a pending comment as waiting, and leaves out spam and imported fediverse comments', async () => {
    const { cms, agent } = await site();
    const id = await comment(cms, {
      status: 'pending',
      author: { name: 'Waiting Person', url: null, email: null, avatar: null },
    });
    await comment(cms, {
      status: 'spam',
      author: { name: 'Pill Seller', url: null, email: null, avatar: null },
    });
    await comment(cms, {
      source: 'activitypub',
      author: { name: 'Imported Reply', url: null, email: null, avatar: null },
    });

    const html = await card(agent);
    const words = text(html);

    assert.match(words, /Waiting Person Comment on Hello there, waiting/);
    assert.ok(html.includes(`href="/admin/comments?status=pending#comment-${id}"`));
    assert.doesNotMatch(words, /Pill Seller/);
    assert.doesNotMatch(words, /Imported Reply/);
  });

  it('says so on a site nobody has interacted with yet', async () => {
    const { agent } = await site();

    const words = text(await card(agent));

    assert.match(words, /No comments, mentions, reactions or new followers yet\./);
  });
});

describe('the moderation list', () => {
  it('gives each comment an anchor the dashboard links to', async () => {
    const { cms, agent } = await site();
    const id = await comment(cms, { status: 'pending' });

    const html = await (await agent.get('/admin/comments?status=pending')).text();

    assert.ok(html.includes(`id="comment-${id}"`));
  });
});
