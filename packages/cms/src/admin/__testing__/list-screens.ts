import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readActivityLog } from '../../indieauth/activity-log.ts';
import { issueTokens } from '../../indieauth/tokens.ts';
import type { Cms } from '../../index.ts';
import { signIn } from './harness.ts';
import type { Browser, Sandbox } from './harness.ts';
import { writeUsers } from './users.ts';

/**
 * One site holding a row in every state each list screen can show, and those
 * screens as a signed-in admin is served them, for `list-screens.test.ts`.
 */

const NOW = new Date('2026-10-02T12:00:00.000Z');

/** The list screens, by the name the test calls each one. */
export const LIST_SCREENS = {
  posts: '/admin/posts',
  postDrafts: '/admin/posts?status=draft',
  postTrash: '/admin/posts?status=trash',
  postsPageTwo: '/admin/posts?page=2',
  pages: '/admin/pages',
  tags: '/admin/tags',
  categories: '/admin/categories',
  users: '/admin/users',
  apps: '/admin/users/apps',
  activity: '/admin/users/activity',
  activityFailures: '/admin/users/activity?show=failures',
  media: '/admin/media',
  followers: '/admin/federation',
  syndication: '/admin/syndication',
} as const;

export type ListScreen = keyof typeof LIST_SCREENS | 'activityEntry';

/** One document under `contentDir`, with whatever front matter it is given. */
async function write(
  contentDir: string,
  file: string,
  frontMatter: string[],
  body = 'Body.',
): Promise<void> {
  const target = path.join(contentDir, ...file.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `---\n${frontMatter.join('\n')}\n---\n\n${body}\n`, 'utf8');
}

/** A site seeded with a row in every state, a signed-in admin, and the id of
 *  the app request it refused. */
export async function listSite(
  box: Sandbox,
  baseUrl = 'https://blog.example',
): Promise<{ cms: Cms; agent: Browser; refusedId: string }> {
  const contentDir = await box.dir('geekity-list-screens-content-');
  const dataDir = await box.dir('geekity-list-screens-data-');

  for (let day = 1; day <= 26; day += 1) {
    const dd = String(day).padStart(2, '0');
    await write(contentDir, `posts/2026-01-${dd}-post-${dd}.md`, [
      `title: Post ${dd}`,
      `date: 2026-01-${dd}T09:00:00Z`,
      `permalink: /2026/01/post-${dd}/`,
      'author: ada',
      'tags: [coffee, walks]',
      'categories: [notes]',
      ...(day === 26 ? ['activitypub:', '  published: 2026-01-26T09:00:00Z'] : []),
    ]);
  }
  await write(contentDir, 'posts/2026-09-01-unfinished.md', [
    'title: Unfinished',
    'date: 2026-09-01T09:00:00Z',
    'permalink: /2026/09/unfinished/',
    'draft: true',
  ]);
  await write(contentDir, 'posts/2026-12-01-later.md', [
    'title: Later',
    'date: 2026-12-01T09:00:00Z',
    'permalink: /2026/12/later/',
  ]);
  await write(contentDir, 'posts/2026-09-02-secret.md', [
    'title: Secret',
    'date: 2026-09-02T09:00:00Z',
    'permalink: /2026/09/secret/',
    'visibility: secret',
  ]);
  await write(
    contentDir,
    '_trash/posts/2026-09-03-thrown-away.md',
    ['title: Thrown away', 'date: 2026-09-03T09:00:00Z', 'permalink: /2026/09/thrown-away/'],
    '![](/uploads/2026/09/photo.png)',
  );
  await write(contentDir, 'pages/about.md', ['title: About', 'permalink: /about/']);
  await write(contentDir, 'pages/colophon.md', [
    'title: Colophon',
    'permalink: /colophon/',
    'draft: true',
  ]);

  const uploads = path.join(contentDir, 'uploads', '2026', '09');
  await mkdir(uploads, { recursive: true });
  await writeFile(
    path.join(uploads, 'photo.png'),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  await writeFile(
    path.join(uploads, 'paper.pdf'),
    new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
  );
  const older = new Date('2026-09-01T09:00:00Z');
  const newer = new Date('2026-09-02T09:00:00Z');
  await utimes(path.join(uploads, 'photo.png'), newer, newer);
  await utimes(path.join(uploads, 'paper.pdf'), older, older);

  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'syndicationTargets.json'),
    JSON.stringify([
      { id: 'indienews', name: 'IndieNews', url: 'https://news.indieweb.org/{lang}' },
      { name: 'Nameless' },
    ]),
    'utf8',
  );

  writeUsers(dataDir, [
    { username: 'ada', password: 'correct horse battery' },
    { username: 'grace', email: 'grace@example.com' },
  ]);

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl,
    now: () => NOW,
    hostLookup: () => Promise.resolve(['203.0.113.7']),
    federation: { queue: null, allowPrivateAddress: true },
  });
  const agent = await signIn(cms);

  await issueTokens(
    dataDir,
    {
      clientId: 'https://quill.example/',
      clientName: 'Quill',
      redirectUri: 'https://quill.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: 1,
      me: `${baseUrl}/`,
      scopes: ['create', 'media'],
    },
    NOW,
  );
  const { accessToken } = await issueTokens(
    dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: 1,
      me: `${baseUrl}/`,
      scopes: ['create'],
    },
    NOW,
  );
  const authorization = { authorization: `Bearer ${accessToken}` };
  await cms.app.request('/_geekity/micropub?q=config', { headers: authorization });
  await cms.app.request('/_geekity/micropub', {
    method: 'POST',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: ['h-entry'],
      properties: { content: ['Hello'], visibility: ['private'] },
    }),
  });
  const [refused] = await readActivityLog(dataDir);

  cms.admin.putFollower({
    username: 'ada',
    actorId: 'https://remote.example/users/bob',
    inboxId: 'https://remote.example/users/bob/inbox',
    sharedInboxId: 'https://remote.example/inbox',
    handle: '@bob@remote.example',
    name: 'Bob',
    iconUrl: null,
    url: 'https://remote.example/@bob',
    followedAt: '2026-09-04T10:00:00.000Z',
  });
  cms.admin.putRelay({
    inboxId: 'https://relay.example/inbox',
    actorId: 'https://relay.example/actor',
    state: 'rejected',
    reason: 'This relay is invitation only.',
    followId: `${baseUrl}/author/ada/#relay-follow/1`,
  });
  cms.admin.putRelay({
    inboxId: 'https://waiting.example/inbox',
    actorId: null,
    state: 'pending',
    reason: null,
    followId: `${baseUrl}/author/ada/#relay-follow/2`,
  });
  cms.admin.recordDelivery({
    activityId: `${baseUrl}/2026/01/post-26/#create`,
    activityType: 'Create',
    objectId: `${baseUrl}/2026/01/post-26/`,
    slug: 'post-26',
    actorId: 'https://remote.example/users/bob',
    inboxId: 'https://remote.example/users/bob/inbox',
    status: 'failed',
    error: 'Connection refused',
  });

  return { cms, agent, refusedId: refused?.id ?? 'none' };
}

/** Every list screen over one seeded site, as HTML by screen name. */
export async function listScreens(box: Sandbox): Promise<Record<ListScreen, string>> {
  const { agent, refusedId } = await listSite(box);
  const screens: Partial<Record<ListScreen, string>> = {};
  for (const [name, url] of Object.entries(LIST_SCREENS)) {
    screens[name as ListScreen] = await (await agent.get(url)).text();
  }
  screens.activityEntry = await (await agent.get(`/admin/users/activity/${refusedId}`)).text();
  return screens as Record<ListScreen, string>;
}
