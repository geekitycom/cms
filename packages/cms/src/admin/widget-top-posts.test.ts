import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { addComment } from '../comments/records.ts';
import type { NewComment } from '../comments/records.ts';
import type { Cms } from '../index.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PostEngagement } from '../plugin.ts';
import type { NewInboxActivity } from '../store/admin-store.ts';
import { TEN_AM_20_OCTOBER_IN_CHICAGO } from './__testing__/chicago-clock.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { screenOf, text } from './__testing__/markup.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';

const TITLES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
const slugOf = (title: string): string => title.toLowerCase();
const postId = (title: string): string => `${BASE}/2026/10/${slugOf(title)}/`;

async function site(plugins: Plugin[] = []): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-top-posts-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({
      title: 'A Site',
      timezone: 'America/Chicago',
      plugins: Object.fromEntries(plugins.map((plugin) => [plugin.name, { enabled: true }])),
    }),
    'utf8',
  );
  for (const title of TITLES) {
    await writeFile(
      path.join(contentDir, 'posts', `2026-10-01-${slugOf(title)}.md`),
      `---\ntitle: ${title}\ndate: '2026-10-01T09:00:00Z'\npermalink: /2026/10/${slugOf(title)}/\n---\n\nWords.\n`,
      'utf8',
    );
  }
  const cms = await box.site({
    contentDir,
    baseUrl: BASE,
    now: () => TEN_AM_20_OCTOBER_IN_CHICAGO,
    plugins,
  });
  return { cms, agent: await signedIn(cms) };
}

async function comment(cms: Cms, title: string, overrides: Partial<NewComment> = {}) {
  await addComment(
    { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
    {
      slug: slugOf(title),
      permalink: `/2026/10/${slugOf(title)}/`,
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
}

let sequence = 0;

function activity(
  activityType: string,
  title: string,
  fields: Partial<NewInboxActivity> = {},
): NewInboxActivity {
  sequence += 1;
  const activityId = `https://remote.example/activities/${String(sequence)}`;
  return {
    activityId,
    activityType,
    actorId: `https://remote.example/users/u${String(sequence)}`,
    objectId: postId(title),
    receivedAt: '2026-10-19T12:00:00.000Z',
    json: JSON.stringify({ id: activityId, type: activityType, object: postId(title) }),
    ...fields,
  };
}

function reply(title: string, receivedAt = '2026-10-19T12:00:00.000Z'): NewInboxActivity {
  sequence += 1;
  const activityId = `https://remote.example/creates/${String(sequence)}`;
  const note = `https://remote.example/notes/${String(sequence)}`;
  return activity('Create', title, {
    activityId,
    objectId: note,
    receivedAt,
    json: JSON.stringify({
      id: activityId,
      type: 'Create',
      object: { id: note, type: 'Note', inReplyTo: postId(title) },
    }),
  });
}

function likes(cms: Cms, title: string, count: number): void {
  for (let i = 0; i < count; i += 1) cms.admin.logInboxActivity(activity('Like', title));
}

async function card(agent: Browser, query = ''): Promise<string> {
  const response = await agent.get(`/admin${query}`);
  assert.equal(response.status, 200);
  const [, html = ''] = screenOf(await response.text()).split(
    '<h2 class="card-title">Top posts</h2>',
  );
  return html.split('<h2 class="card-title">')[0] ?? '';
}

function rows(html: string): string[] {
  const [, body = ''] = html.split('<tbody>');
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) => text(row ?? ''));
}

describe('the top posts widget (TASK-448)', () => {
  it('lists the five most engaged posts with a breakdown by kind and the total, most first (AC #1)', async () => {
    const { cms, agent } = await site();
    TITLES.forEach((title, index) => likes(cms, title, TITLES.length - index));
    cms.admin.logInboxActivity(activity('Announce', 'Echo'));
    cms.admin.logInboxActivity(activity('Announce', 'Echo'));
    cms.admin.logInboxActivity(reply('Echo'));
    await comment(cms, 'Echo', {
      source: 'webmention',
      kind: 'like',
      author: { name: 'Bob', url: 'https://bob.example/', email: null, avatar: null },
      url: 'https://bob.example/likes/1',
    });
    await comment(cms, 'Echo');

    const html = await card(agent);

    assert.match(text(html), /Post Total Breakdown/);
    assert.deepEqual(rows(html), [
      'Echo 7 2 likes, 2 boosts, 1 reply, 1 webmention, 1 comment',
      'Alpha 6 6 likes',
      'Bravo 5 5 likes',
      'Charlie 4 4 likes',
      'Delta 3 3 likes',
    ]);
    assert.match(html, /<a class="link" href="\/admin\/posts\/[^"]+">Echo<\/a>/);
  });

  it('counts the dashboard’s period: 7 days by default, 30 days when asked (AC #1)', async () => {
    const { cms, agent } = await site();
    likes(cms, 'Alpha', 1);
    cms.admin.logInboxActivity(reply('Bravo', '2026-09-30T12:00:00.000Z'));

    assert.deepEqual(rows(await card(agent)), ['Alpha 1 1 like']);
    assert.deepEqual(rows(await card(agent, '?period=30')), ['Alpha 1 1 like', 'Bravo 1 1 reply']);
  });

  it('leaves out undone likes and boosts, unapproved comments and imported fediverse comments (AC #2)', async () => {
    const { cms, agent } = await site();
    const like = cms.admin.logInboxActivity(activity('Like', 'Alpha'));
    const boost = cms.admin.logInboxActivity(activity('Announce', 'Alpha'));
    for (const taken of [like, boost]) {
      cms.admin.logInboxActivity(
        activity('Undo', 'Alpha', { actorId: taken.actorId, objectId: taken.activityId }),
      );
    }
    likes(cms, 'Alpha', 1);
    await comment(cms, 'Alpha', { status: 'pending' });
    await comment(cms, 'Alpha', { status: 'spam' });
    await comment(cms, 'Alpha', { source: 'activitypub' });
    await comment(cms, 'Alpha');

    assert.deepEqual(rows(await card(agent)), ['Alpha 2 1 like, 1 comment']);
  });

  it('says so on a site whose posts drew nothing in the period (AC #4)', async () => {
    const { agent } = await site();

    const html = await card(agent);

    assert.match(text(html), /No likes, boosts, replies, webmentions or comments in this period\./);
    assert.deepEqual(rows(html), []);
  });
});

describe('the engagement core service (TASK-448)', () => {
  it('hands a plugin the per-post totals through host.use (AC #3)', async () => {
    const reached: (readonly PostEngagement[])[] = [];
    const plugin = definePlugin({
      name: '@acme/plugin-views',
      version: '1.0.0',
      label: 'Views',
      description: 'Sets views beside engagement.',
      hostApi: HOST_API_VERSION,
      register(host) {
        host.widget({
          id: 'views',
          title: 'Views and engagement',
          width: 'full',
          refreshSeconds: 0,
          async load() {
            const posts = await host
              .use('@geekity/cms/engagement')
              .posts({ since: '2026-10-01T00:00:00.000Z' });
            reached.push(posts);
            return [
              {
                ranked: {
                  caption: 'Engagement',
                  items: posts.map((post) => ({ label: post.path, value: post.total })),
                },
              },
            ];
          },
        });
      },
    });
    const { cms, agent } = await site([plugin]);
    likes(cms, 'Alpha', 2);
    cms.admin.logInboxActivity(reply('Bravo', '2026-09-20T12:00:00.000Z'));
    await comment(cms, 'Charlie');

    const response = await agent.get('/admin');
    const words = text(screenOf(await response.text()));

    assert.match(words, /Views and engagement/);
    assert.match(words, /\/2026\/10\/alpha\/ 2/);
    const [posts = []] = reached;
    assert.deepEqual(
      posts.map(({ editUrl, ...post }) => ({
        ...post,
        editUrl: editUrl.startsWith('/admin/posts/'),
      })),
      [
        {
          slug: 'alpha',
          title: 'Alpha',
          path: '/2026/10/alpha/',
          editUrl: true,
          likes: 2,
          boosts: 0,
          replies: 0,
          webmentions: 0,
          comments: 0,
          total: 2,
        },
        {
          slug: 'charlie',
          title: 'Charlie',
          path: '/2026/10/charlie/',
          editUrl: true,
          likes: 0,
          boosts: 0,
          replies: 0,
          webmentions: 0,
          comments: 1,
          total: 1,
        },
      ],
    );
  });
});
