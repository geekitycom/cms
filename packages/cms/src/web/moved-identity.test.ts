import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { fieldsOf, saveUrlOf } from '../admin/__testing__/editor-form.ts';
import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import type { Cms, DocumentChangeHook } from '../index.ts';
import { repliesKey } from './feed-source.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';
const POST = '/2026/09/hello/';
const PAGE = '/about/';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const CY = '00000000-0000-4000-8000-0000000000c1';
const TARGET = 'https://elsewhere.example/a-page/';

function markdown(frontMatter: string[], body: string): string {
  return ['---', ...frontMatter, '---', '', body, ''].join('\n');
}

function said(id: string, name: string, minute: number): Record<string, unknown> {
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
  };
}

function helloPost(frontMatter: string[] = []): string {
  return markdown(
    ['title: Hello', "date: '2026-09-02T09:00:00Z'", `permalink: ${POST}`, ...frontMatter],
    'Hello has words of its own.',
  );
}

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', webmentionsSend: false }),
  'posts/2026-09-02-hello.md': helloPost(),
  '_data/comments/hello.json': JSON.stringify({ post: POST, comments: [said(ADA, 'Ada', 1)] }),
  'pages/about.md': markdown(
    ['title: About', `permalink: ${PAGE}`, 'comments: true'],
    'All about it.',
  ),
  '_data/comments/about.json': JSON.stringify({ post: PAGE, comments: [said(CY, 'Cy', 2)] }),
  'posts/2026-09-04-on-about.md': markdown(
    [
      "date: '2026-09-04T09:00:00Z'",
      'permalink: /2026/09/on-about/',
      `in-reply-to: ${BASE_URL}${PAGE}`,
    ],
    'A word on the about page.',
  ),
};

async function site(
  options: { watch?: boolean; onDocumentChange?: DocumentChangeHook } = {},
): Promise<{
  cms: Cms;
  contentDir: string;
}> {
  const contentDir = await box.dir('geekity-identity-content-');
  const dataDir = await box.dir('geekity-identity-data-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    now: () => new Date('2026-09-10T12:00:00Z'),
    ...(options.watch === true ? { watch: true, port: 0 } : {}),
    ...(options.onDocumentChange === undefined
      ? {}
      : { onDocumentChange: options.onDocumentChange }),
  });
  return { cms, contentDir };
}

const agents = new WeakMap<Cms, Browser>();

async function edit(cms: Cms, screen: string, changes: Record<string, string>): Promise<void> {
  const agent = agents.get(cms) ?? (await signedIn(cms));
  agents.set(cms, agent);
  const html = await (await agent.get(screen)).text();
  const action = saveUrlOf(html);
  assert.ok(action !== undefined, `${screen} has a save URL`);
  const fields = Object.fromEntries(fieldsOf(html));
  const response = await agent.post(action, { ...fields, action: 'update', ...changes });
  assert.equal(response.status, 303, `${screen} saved`);
}

async function text(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return await response.text();
}

async function until(what: string, check: () => Promise<boolean> | boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function moveByHand(contentDir: string): Promise<void> {
  await rm(path.join(contentDir, 'posts', '2026-09-02-hello.md'));
  await writeFile(
    path.join(contentDir, 'posts', '2026-09-02-greetings.md'),
    markdown(
      [
        'title: Hello',
        "date: '2026-09-02T09:00:00Z'",
        'permalink: /2026/09/greetings/',
        'redirect_from:',
        `  - ${POST}`,
      ],
      'Hello has words of its own.',
    ),
  );
}

describe('a moved document keeps its whole identity (TASK-332)', () => {
  it('keeps a moved page’s replies feed and the reply posts to its old URL', async () => {
    const { cms } = await site();
    const before = await text(cms, `/replies/${repliesKey(`${BASE_URL}${PAGE}`)}/`);
    assert.ok(before.includes('Cy says so.'), 'the page’s replies feed has Cy before the move');

    await edit(cms, '/admin/pages/about', { slug: 'team' });

    const page = await text(cms, '/team/');
    for (const words of ['Cy says so.', 'A word on the about page.']) {
      assert.ok(page.includes(words), `the moved page shows “${words}”`);
    }
    const feed = await text(cms, `/replies/${repliesKey(`${BASE_URL}${PAGE}`)}/`);
    for (const words of ['Cy says so.', 'A word on the about page.']) {
      assert.ok(feed.includes(words), `the page’s replies feed still has “${words}”`);
    }
  });

  it('keeps the comments of a post moved while unpublished once it is published again', async () => {
    const { cms } = await site();
    await edit(cms, '/admin/posts/hello', { action: 'save-draft' });
    await edit(cms, '/admin/posts/hello', { action: 'save-draft', slug: 'greetings' });
    await edit(cms, '/admin/posts/greetings', { action: 'publish' });

    const moved = await text(cms, '/2026/09/greetings/');
    assert.ok(moved.includes('Ada says so.'), 'the post moved while a draft keeps Ada');
    const old = await cms.app.request(POST);
    assert.equal(old.status, 301, 'its old URL sends a reader on');
  });

  it('takes the comments along when a watched move settles', async () => {
    const { cms, contentDir } = await site({ watch: true });
    await cms.serve();
    try {
      await moveByHand(contentDir);
      await until('the moved post to show Ada', async () =>
        (await cms.app.request('/2026/09/greetings/'))
          .text()
          .then((body) => body.includes('Ada says so.')),
      );
    } finally {
      await cms.close();
    }
  });

  it('gives each post its own comments when a watched burst moves one and adds one at its old URL', async () => {
    const { cms, contentDir } = await site({ watch: true });
    await cms.serve();
    try {
      await moveByHand(contentDir);
      await new Promise((resolve) => setTimeout(resolve, 40));
      await writeFile(
        path.join(contentDir, 'posts', '2026-09-09-hello.md'),
        markdown(
          ['title: Another hello', "date: '2026-09-09T09:00:00Z'", `permalink: ${POST}`],
          'A new post here.',
        ),
      );
      await until('both posts to be indexed and the comments to settle', async () => {
        const landed =
          cms.store.getByPath('posts/2026-09-09-hello.md') !== undefined &&
          cms.store.getByPath('posts/2026-09-02-greetings.md') !== undefined &&
          cms.store.getByPath('posts/2026-09-02-hello.md') === undefined;
        await new Promise((resolve) => setTimeout(resolve, 300));
        return landed;
      });

      const comments = path.join(contentDir, '_data', 'comments');
      const file = JSON.parse(await readFile(path.join(comments, 'hello.json'), 'utf8')) as {
        post: string;
      };
      assert.equal(file.post, POST, 'the comments stay with the post at their URL');
      assert.ok((await text(cms, POST)).includes('Ada says so.'), 'the new post shows Ada');
      assert.ok(
        !(await text(cms, '/2026/09/greetings/')).includes('Ada says so.'),
        'the moved post does not take them',
      );
    } finally {
      await cms.close();
    }
  });

  it('has moved the comments before the site’s own change hook hears of the move', async () => {
    const heard: number[] = [];
    const opened: { cms?: Cms } = {};
    const { cms } = await site({
      onDocumentChange: (change) => {
        if (change.origin === 'admin' && change.next?.slug === 'greetings') {
          heard.push(opened.cms?.admin.listCommentsFor('greetings').length ?? -1);
        }
      },
    });
    opened.cms = cms;
    await edit(cms, '/admin/posts/hello', { slug: 'greetings' });
    assert.deepEqual(heard, [1], 'the hook finds Ada under the new slug');
  });

  it('takes the record of the webmentions a post sent along when its slug changes', async () => {
    const { cms } = await site();
    cms.admin.recordSentWebmention({
      slug: 'hello',
      source: `${BASE_URL}${POST}`,
      target: TARGET,
      endpoint: 'https://elsewhere.example/webmention',
      status: 'sent',
      error: null,
    });

    await edit(cms, '/admin/posts/hello', { slug: 'greetings' });

    assert.deepEqual(
      cms.admin.listSentWebmentions('greetings').map((sent) => [sent.target, sent.status]),
      [[TARGET, 'sent']],
      'the moved post keeps what it sent',
    );
    assert.deepEqual(cms.admin.listSentWebmentions('hello'), [], 'no row is left behind');
  });
});
