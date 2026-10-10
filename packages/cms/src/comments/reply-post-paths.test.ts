import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import { csrfField, resolveNothing, sandbox, signIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { COMMENT_ADMIN_FIELDS, COMMENTS_PATH, COMMENTS_REPLY_PATH } from '../admin/comments.ts';
import type { Document } from '../content/document.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import { COMMENT_POST_PATH } from './form.ts';
import { COMMENT_FIELDS } from './submission.ts';

/**
 * Every signed-in reply is a reply post (TASK-326): the moderation screen
 * writes one as the thread does, the commenter it answers is told once
 * whichever door it came in by, its reply context is read from the index when
 * it answers this site, and its author link is the site's own.
 */

remoteHostsDoNotExist();

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';
const NOW = new Date('2026-09-20T12:00:00.000Z');
const POST_URL = '/2026/09/hello-world/';
const ADA = { username: 'ada', password: 'correct horse battery', displayName: 'Ada Lovelace' };
const ANN = '00000000-0000-4000-8000-0000000000a1';
const ANN_PAGE = `${BASE_URL}/comment/${ANN}/`;
const MICROPUB = '/_geekity/micropub';

function frontMatter(lines: string[], body: string): string {
  return ['---', ...lines, '---', '', body, ''].join('\n');
}

const POST = frontMatter(
  ['title: Hello world', "date: '2026-09-19T09:00:00Z'", `permalink: ${POST_URL}`, 'author: ada'],
  'Words.',
);

const COMMENTS = JSON.stringify({
  post: POST_URL,
  comments: [
    {
      id: ANN,
      source: 'comment',
      kind: 'reply',
      status: 'approved',
      author: { name: 'Ann', url: 'https://ann.example/', email: 'ann@example.com', avatar: null },
      content: { markdown: 'Ann says so.', html: '<p>Ann says so.</p>' },
      submitted: '2026-09-19T10:01:00.000Z',
      addressHash: null,
      inReplyTo: null,
      url: null,
      notify: true,
    },
  ],
});

interface Site {
  cms: Cms;
  provider: MemoryMailProvider;
  looked: string[];
}

/** A site with one open post and Ann's comment on it, Ann having asked for email. */
async function site(extra: Record<string, string> = {}, config: GeekityConfig = {}): Promise<Site> {
  const contentDir = await box.dir('geekity-reply-paths-content-');
  const dataDir = await box.dir('geekity-reply-paths-data-');
  const files: Record<string, string> = {
    'posts/2026-09-19-hello-world.md': POST,
    '_data/comments/hello-world.json': COMMENTS,
    ...extra,
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  writeUsers(dataDir, [
    {
      username: ADA.username,
      password: ADA.password,
      email: 'ada@example.com',
      profile: { displayName: ADA.displayName },
    },
  ]);
  return await boot(contentDir, dataDir, config);
}

/** Boot a site over these directories, mail in a list and every host lookup recorded. */
async function boot(
  contentDir: string,
  dataDir: string,
  config: GeekityConfig = {},
): Promise<Site> {
  const provider = createMemoryMailProvider();
  const looked: string[] = [];
  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    now: () => NOW,
    mail: { provider, backoffMs: () => 0, logger: { info: () => {}, warn: () => {} } },
    hostLookup: (hostname) => {
      looked.push(hostname);
      return resolveNothing(hostname);
    },
    ...config,
  });
  return { cms, provider, looked };
}

function replyPosts(cms: Cms): Document[] {
  return cms.store.listAll({ type: 'post' }).filter((document) => document.inReplyTo !== undefined);
}

async function settled(cms: Cms): Promise<void> {
  await cms.replyContexts.settled();
  await cms.mail.settled();
}

/** The reply notices Ann has been sent. */
function toldAnn(provider: MemoryMailProvider): number {
  return provider.sent.filter((message) =>
    message.to.some((to) => to.address === 'ann@example.com'),
  ).length;
}

async function page(cms: Cms, url: string): Promise<string> {
  const response = await cms.app.request(url);
  assert.equal(response.status, 200, url);
  return await response.text();
}

async function signedIn(cms: Cms): Promise<Browser> {
  return await signIn(cms, { username: ADA.username, password: ADA.password });
}

/** Ada answers Ann from the thread. */
async function fromThread(cms: Cms): Promise<void> {
  const agent = await signedIn(cms);
  const html = await (await agent.get(POST_URL)).text();
  const token = new RegExp(`name="${COMMENT_FIELDS.csrf}" value="([^"]+)"`).exec(html)?.[1];
  assert.ok(token !== undefined, 'the signed-in form carries a token');
  const response = await agent.post(COMMENT_POST_PATH, {
    [COMMENT_FIELDS.post]: 'hello-world',
    [COMMENT_FIELDS.body]: 'Answering from the thread.',
    [COMMENT_FIELDS.inReplyTo]: ANN,
    [COMMENT_FIELDS.csrf]: token,
  });
  assert.equal(response.status, 303, await response.clone().text());
}

/** Ada answers Ann from the moderation screen. */
async function fromModeration(cms: Cms, fields: Record<string, string> = {}): Promise<Response> {
  const agent = await signedIn(cms);
  const token = csrfField(await (await agent.get(`${COMMENTS_PATH}?status=approved`)).text());
  assert.ok(token !== undefined, 'the queue carries a CSRF token');
  const response = await agent.post(COMMENTS_REPLY_PATH, {
    csrf_token: token,
    [COMMENT_ADMIN_FIELDS.id]: ANN,
    [COMMENT_ADMIN_FIELDS.body]: 'Answering from the queue.',
    [COMMENT_ADMIN_FIELDS.status]: 'approved',
    ...fields,
  });
  assert.equal(response.status, 303);
  return response;
}

/** Ada answers Ann in the editor. */
async function fromEditor(cms: Cms): Promise<void> {
  const agent = await signedIn(cms);
  const html = await (await agent.get('/admin/posts/new')).text();
  const response = await agent.post('/admin/posts/new', {
    csrf_token: csrfField(html) ?? '',
    date: '2026-09-20T11:00:00Z',
    'in-reply-to': ANN_PAGE,
    body: 'Answering from the editor.',
    visibility: 'unlisted',
    action: 'publish',
  });
  assert.equal(response.status, 303, await response.clone().text());
}

async function micropubToken(cms: Cms): Promise<string> {
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: 1,
      me: `${BASE_URL}/author/ada/`,
      scopes: ['create', 'update', 'delete'],
    },
    NOW,
  );
  return accessToken;
}

async function micropub(cms: Cms, token: string, body: unknown): Promise<Response> {
  return await cms.app.request(MICROPUB, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Ada answers Ann over Micropub; the new post's URL. */
async function fromMicropub(cms: Cms, token: string): Promise<string> {
  const response = await micropub(cms, token, {
    type: ['h-entry'],
    properties: { content: ['Answering over Micropub.'], 'in-reply-to': [ANN_PAGE] },
  });
  assert.equal(response.status, 201, await response.clone().text());
  return response.headers.get('location') ?? '';
}

describe('a reply from the moderation screen (AC #1)', () => {
  it('is a reply post answering the comment’s page, unlisted, shown under it', async () => {
    const { cms } = await site();
    await fromModeration(cms);

    const [created] = replyPosts(cms);
    assert.ok(created !== undefined, 'a reply post was written');
    assert.equal(created.inReplyTo, ANN_PAGE);
    assert.equal(created.extra['visibility'], 'unlisted');
    assert.equal(created.author, ADA.username);
    assert.equal(created.body.trim(), 'Answering from the queue.');
    assert.equal(cms.admin.listCommentsFor('hello-world').length, 1, 'no comment was added');

    const html = await page(cms, POST_URL);
    const ann = html.indexOf(`id="comment-${ANN}"`);
    const answer = html.indexOf('Answering from the queue.');
    assert.ok(ann > -1 && answer > ann, 'under the comment it answers');
    assert.match(html.slice(ann, answer), /<ol class="children">/);
  });

  it('is public when its "Include in posts and feeds" box is ticked', async () => {
    const { cms } = await site();
    await fromModeration(cms, { [COMMENT_ADMIN_FIELDS.listed]: 'on' });
    assert.equal(replyPosts(cms)[0]?.extra['visibility'], undefined);
  });

  it('offers that box, unticked, on the reply form', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    const html = await (await agent.get(`${COMMENTS_PATH}?status=approved`)).text();
    const box = new RegExp(`<input[^>]*name="${COMMENT_ADMIN_FIELDS.listed}"[^>]*>`).exec(
      html,
    )?.[0];
    assert.ok(box !== undefined, 'the box is on the form');
    assert.doesNotMatch(box, /checked/);
    assert.match(html, /Include in posts and feeds/);
  });

  it('leaves an owner comment already on file a comment', async () => {
    const { cms } = await site();
    await fromModeration(cms);
    assert.equal(cms.admin.getComment(ANN)?.source, 'comment');
  });
});

describe('the reply notice (AC #2)', () => {
  it('goes once for a reply from the thread', async () => {
    const { cms, provider } = await site();
    await fromThread(cms);
    await settled(cms);
    assert.equal(toldAnn(provider), 1);
    assert.match(provider.sent[0]?.text ?? '', /Answering from the thread\./);
  });

  it('goes once for a reply from the moderation screen', async () => {
    const { cms, provider } = await site();
    await fromModeration(cms);
    await settled(cms);
    assert.equal(toldAnn(provider), 1);
    assert.match(provider.sent[0]?.text ?? '', /Answering from the queue\./);
  });

  it('goes once for a reply post written in the editor', async () => {
    const { cms, provider } = await site();
    await fromEditor(cms);
    await settled(cms);
    assert.equal(toldAnn(provider), 1);
    assert.match(provider.sent[0]?.text ?? '', /Answering from the editor\./);
  });

  it('goes once over Micropub, and not again on an edit, a trash and restore, or a restart', async () => {
    const { cms, provider } = await site();
    const token = await micropubToken(cms);
    const url = await fromMicropub(cms, token);
    await settled(cms);
    assert.equal(toldAnn(provider), 1);
    assert.match(provider.sent[0]?.text ?? '', /Answering over Micropub\./);

    const edited = await micropub(cms, token, {
      action: 'update',
      url,
      replace: { content: ['Answering over Micropub, edited.'] },
    });
    assert.ok(edited.status < 300, await edited.clone().text());
    assert.equal((await micropub(cms, token, { action: 'delete', url })).status, 204);
    assert.equal((await micropub(cms, token, { action: 'undelete', url })).status, 204);
    await settled(cms);
    assert.equal(toldAnn(provider), 1, 'an edit, a trash and a restore tell nobody');

    const again = await boot(cms.config.contentDir, cms.config.dataDir);
    await settled(again.cms);
    assert.equal(toldAnn(again.provider), 0, 'a restart tells nobody');
  });

  it('is not sent for a reply post already on file, at boot or when it is edited', async () => {
    const { cms, provider } = await site({
      'posts/2026-09-20-answer.md': frontMatter(
        [
          "title: ''",
          "date: '2026-09-20T09:00:00Z'",
          'permalink: /2026/09/answer/',
          'author: ada',
          `in-reply-to: ${ANN_PAGE}`,
        ],
        'Answered before.',
      ),
    });
    const edited = await micropub(cms, await micropubToken(cms), {
      action: 'update',
      url: `${BASE_URL}/2026/09/answer/`,
      replace: { content: ['Answered before, edited.'] },
    });
    assert.ok(edited.status < 300, await edited.clone().text());
    await settled(cms);
    assert.equal(toldAnn(provider), 0);
  });

  it('is not sent for a reply post to a comment whose writer did not ask', async () => {
    const quiet = COMMENTS.replace('"notify":true', '"notify":false');
    const { cms, provider } = await site({ '_data/comments/hello-world.json': quiet });
    await fromThread(cms);
    await settled(cms);
    assert.equal(toldAnn(provider), 0);
  });
});

describe('the reply context of a reply post answering this site (AC #3)', () => {
  it('is read from the index, with no fetch of the site’s own page', async () => {
    const { cms, looked } = await site({
      'posts/2026-09-20-answer.md': frontMatter(
        [
          "title: ''",
          "date: '2026-09-20T09:00:00Z'",
          'permalink: /2026/09/answer/',
          'author: ada',
          `in-reply-to: ${BASE_URL}${POST_URL}`,
        ],
        'A top-level reply.',
      ),
    });
    cms.replyContexts.catchUp();
    await settled(cms);

    assert.deepEqual(looked, [], 'nothing was looked up');
    const context = cms.replyContexts.read(`${BASE_URL}${POST_URL}`);
    assert.equal(context?.name, 'Hello world');
    assert.equal(context.author?.name, ADA.displayName);
    assert.equal(context.text, 'Words.');

    const html = await page(cms, '/2026/09/answer/');
    assert.match(
      html,
      /In reply to\s*<a class="u-url p-name" href="[^"]*hello-world\/">Hello world<\/a>/,
    );
  });

  it('is read from the index for a reply from the thread, too', async () => {
    const { cms, looked } = await site();
    const agent = await signedIn(cms);
    const html = await (await agent.get(POST_URL)).text();
    const token = new RegExp(`name="${COMMENT_FIELDS.csrf}" value="([^"]+)"`).exec(html)?.[1];
    await agent.post(COMMENT_POST_PATH, {
      [COMMENT_FIELDS.post]: 'hello-world',
      [COMMENT_FIELDS.body]: 'To the post.',
      [COMMENT_FIELDS.inReplyTo]: '',
      [COMMENT_FIELDS.csrf]: token ?? '',
    });
    await settled(cms);
    assert.deepEqual(looked, []);
  });
});

describe('what a reply post citing a comment says (AC #4)', () => {
  it('names a comment by its writer, and a post as before', async () => {
    const { cms } = await site({
      'posts/2026-09-20-answer.md': frontMatter(
        [
          "title: ''",
          "date: '2026-09-20T09:00:00Z'",
          'permalink: /2026/09/answer/',
          'author: ada',
          `in-reply-to: ${ANN_PAGE}`,
        ],
        'Answering Ann.',
      ),
    });
    const html = await page(cms, '/2026/09/answer/');
    const cited = /<p class="cite-line[\s\S]*?<\/p>/.exec(html)?.[0] ?? '';
    assert.match(cited, /In reply to\s*<a class="u-url" href="[^"]+">a comment<\/a> by/);
    assert.match(cited, /Ann/);
    assert.doesNotMatch(cited, /a post/);

    const feed = await page(cms, '/feed/');
    assert.doesNotMatch(feed, /a post by Ann/);
  });
});

describe('a reply post’s author link in a thread (AC #5)', () => {
  it('carries no nofollow or ugc, while a visitor’s still does', async () => {
    const { cms } = await site();
    await fromThread(cms);
    const html = await page(cms, POST_URL);

    const visitor = /<li id="comment-[^"]+" class="[^"]*comment-comment[\s\S]*?<\/b>/.exec(
      html,
    )?.[0];
    assert.match(
      visitor ?? '',
      /href="https:\/\/ann\.example\/" rel="nofollow ugc noopener noreferrer"/,
    );

    const post = /<li id="comment-[^"]+" class="[^"]*comment-post[\s\S]*?<\/b>/.exec(html)?.[0];
    assert.ok(post !== undefined, 'the reply post is in the thread');
    assert.match(post, /href="\/author\/ada\/"/);
    assert.doesNotMatch(post, /nofollow|ugc/);
  });
});
