import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { writeAkismetKey } from '../../comments/akismet.ts';
import { addComment } from '../../comments/records.ts';
import type { NewComment } from '../../comments/records.ts';
import { addContactMessage } from '../../contact/records.ts';
import type { NewContactMessage } from '../../contact/records.ts';
import type { Cms } from '../../index.ts';
import { writeMailCredentials } from '../../mail/credentials.ts';
import { csrfField, signIn } from './harness.ts';
import type { Browser, Sandbox } from './harness.ts';
import { writeUsers } from './users.ts';

const NOW = new Date('2026-10-02T12:00:00.000Z');

/** An app's sign-in request, sent back to `redirectUri`. */
function authorization(redirectUri: string): string {
  return new URLSearchParams({
    response_type: 'code',
    client_id: 'https://app.example/',
    redirect_uri: redirectUri,
    state: 'state-123',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    scope: 'profile email create',
  }).toString();
}

/** The screens a GET reaches, by the name the test calls each one. */
export const REMAINING_SCREENS = {
  comments: '/admin/comments',
  commentsApproved: '/admin/comments?status=approved',
  commentsSpam: '/admin/comments?status=spam',
  messages: '/admin/messages',
  messagesSpam: '/admin/messages?status=spam',
  themes: '/admin/appearance/themes',
  navigation: '/admin/navigation',
  settingsGeneral: '/admin/settings',
  settingsReading: '/admin/settings/reading',
  settingsPermalinks: '/admin/settings/permalinks',
  settingsDiscussion: '/admin/settings/discussion',
  settingsEmail: '/admin/settings/email',
  settingsPrivacy: '/admin/settings/privacy',
  federationSettings: '/admin/federation/settings',
  tools: '/admin/tools',
  personalData: '/admin/tools/personal-data',
  usersEdit: '/admin/users/1',
  usersEditOther: '/admin/users/2',
  usersNew: '/admin/users/new',
  consent: `/admin/indieauth/consent?${authorization('https://app.example/callback')}`,
  refused: `/admin/indieauth/consent?${authorization('https://evil.example/callback')}`,
  error: '/admin/broken',
} as const;

export type RemainingScreen =
  keyof typeof REMAINING_SCREENS | 'toolsConfirm' | 'personalDataFound' | 'navigationRefused';

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

function comment(overrides: Partial<NewComment>): NewComment {
  return {
    slug: 'hello-world',
    permalink: '/2026/09/hello-world/',
    source: 'comment',
    kind: 'reply',
    status: 'pending',
    author: {
      name: 'Ada Lovelace',
      url: 'https://ada.example/',
      email: 'ada@example.com',
      avatar: null,
    },
    content: { markdown: 'Good post.', html: '<p>Good post.</p>\n' },
    submitted: '2026-09-19T10:00:00.000Z',
    addressHash: 'deadbeefcafe',
    notify: false,
    inReplyTo: null,
    url: null,
    ...overrides,
  };
}

function message(overrides: Partial<NewContactMessage>): NewContactMessage {
  return {
    received: '2026-09-20T12:00:00.000Z',
    status: 'received',
    page: { slug: 'contact', permalink: '/contact/', title: 'Say hello' },
    from: { name: 'Grace Hopper', email: 'grace@example.com' },
    subject: 'About the compiler',
    message: 'It is a lovely machine.\nPlease write back.',
    addressHash: 'abcdef0123456789abcdef0123456789',
    ...overrides,
  };
}

/** The seeded site and a signed-in admin over it. */
export async function remainingSite(
  box: Sandbox,
  baseUrl = 'https://blog.example',
): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-remaining-content-');
  const dataDir = await box.dir('geekity-remaining-data-');
  const themesDir = await box.dir('geekity-remaining-themes-');

  await writeTree(contentDir, {
    'posts/2026-09-19-hello-world.md': [
      '---',
      'title: Hello world',
      "date: '2026-09-19T09:00:00Z'",
      'permalink: /2026/09/hello-world/',
      '---',
      '',
      'Words.',
      '',
    ].join('\n'),
    'pages/contact.md': [
      '---',
      'title: Say hello',
      'permalink: /contact/',
      'contact: true',
      '---',
      '',
    ].join('\n'),
    '_data/site.json': JSON.stringify({
      title: 'A Site',
      baseUrl,
      mailProvider: 'smtp',
      menus: {
        primary: [{ label: 'About', url: '/about/' }],
        top_bar: [{ label: 'Elsewhere', url: 'https://elsewhere.example/' }],
      },
      taxonomyRedirects: [{ taxonomy: 'category', from: 'misc', to: 'general' }],
    }),
  });
  await writeTree(themesDir, {
    'midnight/theme.json': JSON.stringify({
      name: 'Midnight',
      kind: 'site',
      description: 'Dark, quiet, and mostly type.',
    }),
    'midnight/layouts/post.njk': '<!doctype html><h1>Midnight: {{ title }}</h1>',
    'broken/theme.json': '{ not json',
  });

  writeUsers(dataDir, [
    {
      username: 'ada',
      password: 'correct horse battery',
      email: 'ada@blog.example',
    },
    { username: 'grace' },
  ]);
  await writeAkismetKey(dataDir, {
    key: 'abcdef123456',
    status: 'invalid',
    checkedAt: '2026-10-01T09:00:00.000Z',
  });
  await writeMailCredentials(dataDir, {
    brevo: { apiKey: 'xkeysib-secret-1234' },
    smtp: {
      host: 'smtp.example',
      port: 587,
      secure: false,
      user: 'ada',
      password: 'hunter2',
    },
  });

  for (let index = 0; index < 26; index += 1) {
    await addContactMessage(
      dataDir,
      message({
        received: new Date(Date.UTC(2026, 8, 1 + index, 12)).toISOString(),
        read: index !== 25,
        subject: index === 25 ? 'About the compiler' : `Older note ${String(index + 1)}`,
      }),
    );
  }
  await addContactMessage(
    dataDir,
    message({
      received: '2026-09-28T12:00:00.000Z',
      status: 'spam',
      from: { name: 'Pill Seller', email: 'pills@spam.example' },
      subject: 'Cheap pills',
      message: 'Buy now.',
    }),
  );

  const cms = await box.open({
    contentDir,
    dataDir,
    themesDir,
    baseUrl,
    now: () => NOW,
  });
  cms.app.get('/admin/broken', () => {
    throw new Error('the screen fell over');
  });

  const stores = { admin: cms.admin, contentDir, dataDir };
  const first = await addComment(stores, comment({}));
  await addComment(
    stores,
    comment({
      source: 'webmention',
      kind: 'mention',
      author: { name: 'Remote Blog', url: 'https://remote.example/', email: null, avatar: null },
      content: { markdown: 'Linked here.', html: '<p>Linked here.</p>\n' },
      url: 'https://remote.example/a-post/',
      addressHash: null,
      inReplyTo: null,
    }),
  );
  for (let index = 0; index < 26; index += 1) {
    await addComment(
      stores,
      comment({
        status: 'approved',
        author: { name: `Reader ${String(index + 1)}`, url: null, email: null, avatar: null },
        content: { markdown: 'Let through.', html: '<p>Let through.</p>\n' },
        submitted: new Date(Date.UTC(2026, 8, 19, 11, index)).toISOString(),
        inReplyTo: index === 25 ? first.id : null,
      }),
    );
  }
  await addComment(
    stores,
    comment({
      status: 'spam',
      author: { name: 'Pill Seller', url: null, email: 'pills@spam.example', avatar: null },
      content: { markdown: 'Buy pills.', html: '<p>Buy pills.</p>\n' },
    }),
  );

  return { cms, agent: await signIn(cms) };
}

/** Every remaining screen over one seeded site, as HTML by screen name. */
export async function remainingScreens(box: Sandbox): Promise<Record<RemainingScreen, string>> {
  const { agent } = await remainingSite(box);
  const screens: Partial<Record<RemainingScreen, string>> = {};
  for (const [name, url] of Object.entries(REMAINING_SCREENS)) {
    screens[name as RemainingScreen] = await (await agent.get(url)).text();
  }

  const token = csrfField(screens.tools ?? '') ?? '';
  screens.toolsConfirm = await (
    await agent.post('/admin/tools/rebuild-index', { csrf_token: token })
  ).text();
  screens.personalDataFound = await (
    await agent.post('/admin/tools/personal-data', {
      csrf_token: token,
      email: 'ada@example.com',
    })
  ).text();
  screens.navigationRefused = await (
    await agent.post('/admin/navigation/add', { csrf_token: token, name: 'Top-Bar' })
  ).text();
  return screens as Record<RemainingScreen, string>;
}
