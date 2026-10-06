/**
 * The conversation under a page (TASK-196).
 *
 * A page takes part only while it takes comments, which it does when its front
 * matter says `comments: true` and the site has not switched comments off. One
 * that does is drawn exactly as a post is: the same reactions, the same thread,
 * the same form. One that does not shows nothing, whatever has been approved
 * against it.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';

/** The ids are hex because they stand in for the UUIDs a comment file holds. */
const REPLY = 'a';
const LIKE = 'b';
const REPOST = 'c';
const MENTION = 'd';

function id(prefix: string, which: string): string {
  return `00000000-0000-4000-8000-${prefix}${which.repeat(12 - prefix.length)}`;
}

function page(name: string, frontMatter: string[]): string {
  return [
    '---',
    `title: ${name}`,
    `permalink: /${name}/`,
    ...frontMatter,
    '---',
    '',
    'Words.',
    '',
  ].join('\n');
}

const TWIN_POST = [
  '---',
  'title: Twin',
  "date: '2026-09-10T09:00:00Z'",
  'permalink: /2026/09/twin/',
  '---',
  '',
  'Words.',
  '',
].join('\n');

function entry(values: Record<string, unknown>): Record<string, unknown> {
  return {
    source: 'comment',
    kind: 'reply',
    status: 'approved',
    author: { name: 'Somebody', url: null, email: null, avatar: null },
    content: { markdown: '', html: '' },
    submitted: '2026-09-11T10:00:00.000Z',
    addressHash: null,
    inReplyTo: null,
    url: null,
    notify: false,
    ...values,
  };
}

/** A reply, a like, a repost and a mention, all approved, under `permalink`. */
function answered(permalink: string, prefix: string): string {
  const webmention = (which: string, kind: string, name: string) =>
    entry({
      id: id(prefix, which),
      source: 'webmention',
      kind,
      author: { name, url: `https://${name.toLowerCase()}.example/`, email: null, avatar: null },
      content: { markdown: 'Wrote about it', html: '<p>Wrote about it</p>' },
      url: `https://${name.toLowerCase()}.example/${kind}`,
    });

  return JSON.stringify({
    post: permalink,
    comments: [
      entry({
        id: id(prefix, REPLY),
        author: { name: 'Ada', url: 'https://ada.example/', email: null, avatar: null },
        content: { markdown: 'Approved words.', html: '<p>Approved words.</p>' },
      }),
      webmention(LIKE, 'like', 'Bob'),
      webmention(REPOST, 'repost', 'Cal'),
      webmention(MENTION, 'mention', 'Dee'),
    ],
  });
}

async function site(siteJson: Record<string, unknown> = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-page-conversation-content-');
  const dataDir = await box.dir('geekity-page-conversation-data-');

  const files: Record<string, string> = {
    '_data/site.json': JSON.stringify({ title: 'A Site', ...siteJson }),
    'posts/twin.md': TWIN_POST,
    'pages/open.md': page('open', ['comments: true']),
    'pages/plain.md': page('plain', []),
    'pages/shut.md': page('shut', ['comments: false']),
    '_data/comments/twin.json': answered('/2026/09/twin/', '1'),
    '_data/comments/open.json': answered('/open/', '2'),
    '_data/comments/plain.json': answered('/plain/', '3'),
    '_data/comments/shut.json': answered('/shut/', '4'),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }

  return await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    now: () => new Date('2026-09-13T12:00:00Z'),
  });
}

async function body(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** From the reactions to the start of the comment form: the conversation. */
function conversation(html: string): string {
  const start = html.indexOf('<div class="reactions-section">');
  if (start < 0) return '';
  return html.slice(start, html.indexOf('<section class="comment-respond"', start));
}

describe('a page that takes comments', () => {
  it('shows its replies, likes, reposts and mentions in the markup a post uses', async () => {
    const cms = await site();
    const onPost = conversation(await body(cms, '/2026/09/twin/'));
    const onPage = conversation(await body(cms, '/open/'));

    assert.match(onPost, /Approved words\./, 'the post has a conversation to compare');
    assert.match(onPost, /p-like/);
    assert.match(onPost, /p-repost/);
    assert.match(onPost, /p-mention/);
    assert.equal(
      onPage
        .replaceAll('00000000-0000-4000-8000-2', '00000000-0000-4000-8000-1')
        .replaceAll('/open/', '/2026/09/twin/')
        .trim(),
      onPost.trim(),
    );
  });

  it('has the comment form under it', async () => {
    const html = await body(await site(), '/open/');

    assert.match(html, /<section class="comment-respond" id="respond">/);
  });
});

describe('a page that does not take comments', () => {
  for (const [why, pathname] of [
    ['its front matter turns them off', '/shut/'],
    ['it never turned them on, as pages do not by default', '/plain/'],
  ] as const) {
    it(`shows nothing when ${why}`, async () => {
      const html = await body(await site(), pathname);

      assert.doesNotMatch(html, /Approved words\.|reactions-section|comments-area/);
      assert.doesNotMatch(html, /id="respond"/);
    });
  }

  it('shows nothing when the site has switched comments off', async () => {
    const cms = await site({ comments: false });
    const html = await body(cms, '/open/');

    assert.doesNotMatch(html, /Approved words\.|reactions-section|comments-area/);
    assert.doesNotMatch(html, /id="respond"/);
    assert.match(
      await body(cms, '/2026/09/twin/'),
      /Approved words\./,
      'while a post still shows what was said before the switch',
    );
  });
});
