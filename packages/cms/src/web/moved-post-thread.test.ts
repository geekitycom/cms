import assert from 'node:assert/strict';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { fieldsOf, saveUrlOf } from '../admin/__testing__/editor-form.ts';
import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { repliesKey } from './feed-source.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';
const POST = '/2026/09/hello/';
const FILE = 'posts/2026-09-02-hello.md';

const ADA = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000a2';
const GRACE = '00000000-0000-4000-8000-0000000000e1';
const CY = '00000000-0000-4000-8000-0000000000c1';
const NOTE = 'https://remote.example/notes/1';

function markdown(frontMatter: string[], body: string): string {
  return ['---', ...frontMatter, '---', '', body, ''].join('\n');
}

function said(
  id: string,
  name: string,
  minute: number,
  values: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    source: 'comment',
    kind: 'reply',
    status: 'approved',
    author: { name, url: `https://${name.toLowerCase()}.example/`, avatar: null },
    content: { markdown: `${name} says so.`, html: `<p>${name} says so.</p>` },
    submitted: `2026-09-03T10:${String(minute).padStart(2, '0')}:00.000Z`,
    addressHash: null,
    inReplyTo: null,
    url: null,
    ...values,
  };
}

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  [FILE]: markdown(
    ['title: Hello', "date: '2026-09-02T09:00:00Z'", `permalink: ${POST}`],
    'Hello has words of its own.',
  ),
  'posts/2026-09-04-answer.md': markdown(
    [
      "date: '2026-09-04T09:00:00Z'",
      'permalink: /2026/09/answer/',
      `in-reply-to: ${BASE_URL}${POST}`,
    ],
    'An answer of my own.',
  ),
  'posts/2026-09-05-to-ada.md': markdown(
    [
      "date: '2026-09-05T09:00:00Z'",
      'permalink: /2026/09/to-ada/',
      `in-reply-to: ${BASE_URL}/comment/${ADA}/`,
    ],
    'Answering Ada myself.',
  ),
  '_data/comments/hello.json': JSON.stringify({
    post: POST,
    comments: [
      said(ADA, 'Ada', 1),
      said(BOB, 'Bob', 2, { inReplyTo: ADA }),
      said(GRACE, 'Grace', 3, {
        source: 'webmention',
        url: 'https://grace.example/2026/09/about-that/',
      }),
    ],
  }),
};

const EVERYONE = ['Ada says so.', 'Bob says so.', 'Grace says so.', 'Federated words.'];
const REPLY_POSTS = ['An answer of my own.', 'Answering Ada myself.'];

async function site(): Promise<{ cms: Cms; contentDir: string; dataDir: string }> {
  const contentDir = await box.dir('geekity-moved-content-');
  const dataDir = await box.dir('geekity-moved-data-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  await mkdir(path.join(dataDir, 'comments'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'comments', 'hello.json'),
    JSON.stringify({ comments: { [ADA]: { email: 'ada@ada.example', notify: true } } }),
    { mode: 0o600 },
  );
  const cms = await open(contentDir, dataDir);
  cms.admin.logInboxActivity({
    activityId: `${NOTE}/activity`,
    activityType: 'Create',
    actorId: 'https://remote.example/users/ada',
    objectId: NOTE,
    json: JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${NOTE}/activity`,
      type: 'Create',
      actor: 'https://remote.example/users/ada',
      object: {
        id: NOTE,
        type: 'Note',
        attributedTo: 'https://remote.example/users/ada',
        content: '<p>Federated words.</p>',
        inReplyTo: `${BASE_URL}${POST}`,
        published: '2026-09-03T09:00:00Z',
      },
    }),
  });
  return { cms, contentDir, dataDir };
}

async function open(contentDir: string, dataDir: string): Promise<Cms> {
  return await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    now: () => new Date('2026-09-10T12:00:00Z'),
  });
}

const agents = new WeakMap<Cms, Browser>();

async function editPost(cms: Cms, changes: Record<string, string>, slug = 'hello'): Promise<void> {
  const agent = agents.get(cms) ?? (await signedIn(cms));
  agents.set(cms, agent);
  const html = await (await agent.get(`/admin/posts/${slug}`)).text();
  const action = saveUrlOf(html);
  assert.ok(action !== undefined, 'the editor has a save URL');
  const fields = Object.fromEntries(fieldsOf(html));
  const response = await agent.post(action, { ...fields, action: 'update', ...changes });
  assert.equal(response.status, 303, 'the editor saved the post');
}

async function exists(file: string): Promise<boolean> {
  return await access(file).then(
    () => true,
    () => false,
  );
}

async function json(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

async function text(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return await response.text();
}

function includesAll(body: string, expected: readonly string[], where: string): void {
  for (const words of expected) assert.ok(body.includes(words), `${where} shows “${words}”`);
}

async function conversationAt(cms: Cms, permalink: string, guid: string): Promise<void> {
  includesAll(await text(cms, permalink), [...EVERYONE, ...REPLY_POSTS], 'the post');
  includesAll(await text(cms, `${permalink}feed/`), [...EVERYONE, ...REPLY_POSTS], 'its feed');
  includesAll(await text(cms, '/comments/feed/'), EVERYONE, 'the site’s comments feed');
  includesAll(
    await text(cms, `/comment/${ADA}/`),
    ['Ada says so.', 'Bob says so.', 'Answering Ada myself.'],
    'Ada’s page',
  );
  includesAll(await text(cms, `/replies/${ADA}/`), ['Bob says so.'], 'Ada’s replies feed');
  includesAll(
    await text(cms, `/replies/${repliesKey(guid)}/`),
    ['Ada says so.', 'Grace says so.', 'Federated words.', 'An answer of my own.'],
    'the post’s replies feed',
  );
}

describe('a post that moves keeps its conversation (TASK-329)', () => {
  it('has the whole conversation before it moves', async () => {
    const { cms } = await site();
    await conversationAt(cms, POST, `${BASE_URL}${POST}`);
  });

  it('keeps it when the editor changes the permalink and keeps the slug', async () => {
    const { cms } = await site();
    await editPost(cms, { permalink: '/writing/hello/' });
    await conversationAt(cms, '/writing/hello/', `${BASE_URL}${POST}`);
  });

  it('keeps it when the editor changes the permalink’s last segment', async () => {
    const { cms } = await site();
    await editPost(cms, { permalink: '/writing/greetings/' });
    await conversationAt(cms, '/writing/greetings/', `${BASE_URL}${POST}`);
  });

  it('keeps it when the editor changes the slug, which renames the file', async () => {
    const { cms } = await site();
    await editPost(cms, { slug: 'greetings' });
    await conversationAt(cms, '/2026/09/greetings/', `${BASE_URL}${POST}`);
  });

  it('keeps it when the file is renamed by hand and the permalink stays', async () => {
    const { cms, contentDir } = await site();
    await rename(
      path.join(contentDir, FILE),
      path.join(contentDir, 'posts', '2026-09-02-greetings.md'),
    );
    await cms.sync();
    await conversationAt(cms, POST, `${BASE_URL}${POST}`);
  });

  it('keeps it when the file moves to another directory', async () => {
    const { cms, contentDir } = await site();
    await mkdir(path.join(contentDir, 'posts', 'archive'));
    await rename(
      path.join(contentDir, FILE),
      path.join(contentDir, 'posts', 'archive', '2026-09-02-hello.md'),
    );
    await cms.sync();
    await conversationAt(cms, POST, `${BASE_URL}${POST}`);
  });

  it('keeps it after the editor’s rename once the database is rebuilt from the files', async () => {
    const { cms, contentDir, dataDir } = await site();
    await editPost(cms, { slug: 'greetings' });
    await cms.close();
    await rm(path.join(dataDir, 'geekity.db'), { force: true });
    const reopened = await open(contentDir, dataDir);
    includesAll(
      await text(reopened, '/2026/09/greetings/'),
      ['Ada says so.', 'Bob says so.', 'Grace says so.', ...REPLY_POSTS],
      'the post',
    );
    includesAll(await text(reopened, `/comment/${ADA}/`), ['Bob says so.'], 'Ada’s page');
  });

  it('takes the comment files along, emails and all', async () => {
    const { cms, contentDir, dataDir } = await site();
    await editPost(cms, { slug: 'greetings' });

    const comments = path.join(contentDir, '_data', 'comments');
    assert.equal(await exists(path.join(comments, 'hello.json')), false, 'the old file is gone');
    assert.equal(await exists(path.join(dataDir, 'comments', 'hello.json')), false);
    const moved = await json(path.join(comments, 'greetings.json'));
    assert.equal(moved['post'], '/2026/09/greetings/', 'the file records where the post is now');
    assert.deepEqual(
      (moved['comments'] as { id: string }[]).map((comment) => comment.id),
      [ADA, BOB, GRACE],
    );
    assert.deepEqual(await json(path.join(dataDir, 'comments', 'greetings.json')), {
      comments: { [ADA]: { email: 'ada@ada.example', notify: true } },
    });
  });

  it('follows a chain of moves', async () => {
    const { cms } = await site();
    await editPost(cms, { slug: 'greetings' });
    await editPost(cms, { slug: 'salutations' }, 'greetings');
    await conversationAt(cms, '/2026/09/salutations/', `${BASE_URL}${POST}`);
  });

  it('keeps it when the permalink is changed by hand with the old one kept as a redirect', async () => {
    const { cms, contentDir } = await site();
    await writeFile(
      path.join(contentDir, FILE),
      markdown(
        [
          'title: Hello',
          "date: '2026-09-02T09:00:00Z'",
          'permalink: /2026/09/greetings/',
          'redirect_from:',
          `  - ${POST}`,
          'activitypub:',
          `  id: ${BASE_URL}${POST}`,
        ],
        'Hello has words of its own.',
      ),
      'utf8',
    );
    await cms.sync();
    await conversationAt(cms, '/2026/09/greetings/', `${BASE_URL}${POST}`);
  });

  it('merges what was said after the move with what it left behind', async () => {
    const { cms, contentDir, dataDir } = await site();
    await editPost(cms, { slug: 'greetings' });
    const comments = path.join(contentDir, '_data', 'comments');
    const moved = await json(path.join(comments, 'greetings.json'));
    await cms.close();

    await writeFile(path.join(comments, 'hello.json'), FILES['_data/comments/hello.json'] ?? '');
    await writeFile(
      path.join(comments, 'greetings.json'),
      JSON.stringify({
        ...moved,
        comments: [...(moved['comments'] as unknown[]), said(CY, 'Cy', 9)],
      }),
    );

    const reopened = await open(contentDir, dataDir);
    assert.equal(await exists(path.join(comments, 'hello.json')), false, 'the move is finished');
    const page = await text(reopened, '/2026/09/greetings/');
    includesAll(
      page,
      ['Ada says so.', 'Bob says so.', 'Grace says so.', 'Cy says so.'],
      'the post',
    );
    assert.equal(page.split('Ada says so.').length - 1, 1, 'Ada is said once');
  });

  for (const rebuilt of [false, true]) {
    it(`leaves the comments with a new post that takes the old URL over${rebuilt ? ', through a rebuild' : ''}`, async () => {
      const { cms, contentDir, dataDir } = await site();
      await editPost(cms, { slug: 'greetings' });
      await cms.close();
      if (rebuilt) await rm(path.join(dataDir, 'geekity.db'), { force: true });
      await writeFile(
        path.join(contentDir, 'posts', '2026-09-09-hello.md'),
        markdown(
          ['title: Another hello', "date: '2026-09-09T09:00:00Z'", `permalink: ${POST}`],
          'A new post here.',
        ),
      );
      await writeFile(
        path.join(contentDir, '_data', 'comments', 'hello.json'),
        JSON.stringify({ post: POST, comments: [said(CY, 'Cy', 9)] }),
      );

      const reopened = await open(contentDir, dataDir);
      includesAll(await text(reopened, POST), ['Cy says so.'], 'the new post');
      const moved = await text(reopened, '/2026/09/greetings/');
      includesAll(moved, ['Ada says so.'], 'the moved post');
      assert.ok(!moved.includes('Cy says so.'), 'the new post’s comments stay its own');
    });
  }
});
