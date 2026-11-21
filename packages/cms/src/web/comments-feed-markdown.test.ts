import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';
const POST = '/2026/09/hello/';
const FORM = '0000000000000a01';
const WEBMENTION = '0000000000000a02';
const SENDER = 'https://grace.example/2026/09/about-that/';
const NOTE = 'https://remote.example/notes/1';

const FORM_MARKDOWN = [
  'Ada links [the post](/2026/09/hello/) and types <b>a tag</b>.',
  '',
  '![a cat](/media/cat.jpg)',
].join('\n');

function comment(values: Record<string, unknown>): Record<string, unknown> {
  return {
    source: 'comment',
    kind: 'reply',
    status: 'approved',
    author: { name: 'Somebody', url: null, email: null, avatar: null },
    submitted: '2026-09-03T10:00:00.000Z',
    addressHash: null,
    inReplyTo: null,
    url: null,
    notify: false,
    ...values,
  };
}

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/2026-09-02-hello.md': [
    '---',
    'title: Hello',
    "date: '2026-09-02T09:00:00Z'",
    `permalink: ${POST}`,
    '---',
    '',
    'Hello has words of its own.',
    '',
  ].join('\n'),
  '_data/comments/hello.json': JSON.stringify({
    post: POST,
    comments: [
      comment({
        id: FORM,
        author: { name: 'Ada', url: null, email: null, avatar: null },
        content: {
          markdown: FORM_MARKDOWN,
          html:
            '<p>Ada links [the post](/2026/09/hello/) and types &lt;b&gt;a tag&lt;/b&gt;.</p>\n' +
            '<p><a href="/media/cat.jpg" rel="nofollow ugc">a cat</a></p>\n',
        },
        submitted: '2026-09-03T10:01:00.000Z',
      }),
      comment({
        id: WEBMENTION,
        source: 'webmention',
        url: SENDER,
        author: { name: 'Grace', url: 'https://grace.example/', email: null, avatar: null },
        content: {
          markdown: 'Grace writes back.',
          html: '<p>Grace <a href="https://grace.example/about/">writes</a> <strong>back</strong>.</p>',
        },
        submitted: '2026-09-03T10:02:00.000Z',
      }),
    ],
  }),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-comments-feed-markdown-content-');
  const dataDir = await box.dir('geekity-comments-feed-markdown-data-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    now: () => new Date('2026-09-05T12:00:00Z'),
  });
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
        content:
          '<p>Federated <em>words</em> about <a href="https://remote.example/tags/cats" rel="tag">#cats</a>.</p>',
        inReplyTo: `${BASE_URL}${POST}`,
        published: '2026-09-03T09:00:00Z',
        url: 'https://remote.example/@ada/1',
      },
    }),
  });
});

const FEEDS = [
  '/comments/feed/',
  `${POST}feed/`,
  `/replies/${createHash('sha256').update(`${BASE_URL}${POST}`).digest('hex').slice(0, 16)}/`,
];

async function items(pathname: string): Promise<Map<string, string>> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, pathname);
  const found = new Map<string, string>();
  for (const [item] of (await response.text()).matchAll(/<item>[\s\S]*?<\/item>/g)) {
    const guid = /<guid[^>]*>([^<]*)<\/guid>/.exec(item)?.[1] ?? '';
    found.set(guid, item);
  }
  return found;
}

function markdownOf(item: string | undefined): string {
  const match = /<source:markdown><!\[CDATA\[([\s\S]*?)\]\]><\/source:markdown>/.exec(item ?? '');
  assert.ok(match !== null, `no source:markdown in ${item ?? 'a missing item'}`);
  return match[1] ?? '';
}

describe('a comment item in the comments feeds', () => {
  for (const feed of FEEDS) {
    it(`carries source:markdown and no title in ${feed}`, async () => {
      const found = await items(feed);
      assert.equal(found.size, 3, 'the form comment, the webmention and the fediverse reply');
      for (const item of found.values()) {
        assert.doesNotMatch(item, /<title>/);
        assert.match(item, /<description>/, 'RSS keeps the description an untitled item needs');
        markdownOf(item);
      }
    });

    it(`gives a form comment the Markdown it was written in, every URL absolute, in ${feed}`, async () => {
      const markdown = markdownOf((await items(feed)).get(`${BASE_URL}/comment/${FORM}/`));
      assert.equal(
        markdown,
        [
          `Ada links [the post](${BASE_URL}/2026/09/hello/) and types \\<b>a tag\\</b>.`,
          '',
          `![a cat](${BASE_URL}/media/cat.jpg)`,
        ].join('\n'),
      );
    });

    it(`converts a webmention’s HTML in ${feed}`, async () => {
      const markdown = markdownOf((await items(feed)).get(SENDER));
      assert.equal(markdown, 'Grace [writes](https://grace.example/about/) **back**.');
    });

    it(`converts a fediverse reply’s HTML in ${feed}`, async () => {
      const markdown = markdownOf((await items(feed)).get(NOTE));
      assert.equal(markdown, 'Federated _words_ about [#cats](https://remote.example/tags/cats).');
    });
  }

  it('moves the comments feeds’ ETag', async () => {
    const response = await cms.app.request('/comments/feed/');
    assert.notEqual(response.headers.get('etag'), REVISION_FOUR_ETAG);
  });
});

const REVISION_FOUR_ETAG = '"636b938718eb7ae98bc0417251cf465e"';
