import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import { browser, sandbox, signIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import type { Document } from '../content/document.ts';
import type { Cms } from '../index.ts';
import { COMMENT_POST_PATH } from './form.ts';
import { commentsFile } from './records.ts';
import { COMMENT_FIELDS } from './submission.ts';

/**
 * A signed-in user's reply in a thread is a reply post (TASK-300): one record,
 * shown inline where a comment would have been, whose `in-reply-to` is what it
 * answers. Driven over HTTP through the real app, because every criterion is
 * about what a browser is sent, what lands in `content/` and what the feeds say.
 */

// A reply post answering a webmention or a fediverse reply goes out to it,
// which is the point; here those hosts simply do not answer.
remoteHostsDoNotExist();

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';
const NOW = new Date('2026-09-20T12:00:00.000Z');
const POST_URL = '/2026/09/hello-world/';
const ADA = { username: 'ada', password: 'correct horse battery', displayName: 'Ada Lovelace' };

const NATIVE = '00000000-0000-4000-8000-0000000000a1';
const WEBMENTION = '00000000-0000-4000-8000-0000000000b1';
const SENDER = 'https://grace.example/2026/09/about-that/';
const NOTE = 'https://remote.example/users/carol/statuses/1';
const NOTE_URL = 'https://remote.example/@carol/1';
const CAROL = 'https://remote.example/users/carol';

function frontMatter(lines: string[], body: string): string {
  return ['---', ...lines, '---', '', body, ''].join('\n');
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
    author: { name, url: null, email: null, avatar: null },
    content: { markdown: `${name} says so.`, html: `<p>${name} says so.</p>` },
    submitted: `2026-09-19T10:${String(minute).padStart(2, '0')}:00.000Z`,
    addressHash: null,
    inReplyTo: null,
    url: null,
    notify: false,
    ...values,
  };
}

const POST = frontMatter(
  ['title: Hello world', "date: '2026-09-19T09:00:00Z'", `permalink: ${POST_URL}`, 'author: ada'],
  'Words.',
);

const COMMENTS = JSON.stringify({
  post: POST_URL,
  comments: [
    said(NATIVE, 'Ann', 1),
    said(WEBMENTION, 'Grace', 2, { source: 'webmention', url: SENDER }),
  ],
});

/** A site with one open post, a native comment, a webmention and a fediverse reply on it. */
async function site(extra: Record<string, string> = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-reply-posts-content-');
  const dataDir = await box.dir('geekity-reply-posts-data-');
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
    { username: ADA.username, password: ADA.password, profile: { displayName: ADA.displayName } },
  ]);

  const cms = await box.open({ contentDir, dataDir, baseUrl: BASE_URL, now: () => NOW });
  logNote(cms, { id: NOTE, url: NOTE_URL, inReplyTo: `${BASE_URL}${POST_URL}` });
  return cms;
}

function logNote(cms: Cms, note: { id: string; url: string; inReplyTo: string }): void {
  cms.admin.logInboxActivity({
    activityId: `${note.id}/activity`,
    activityType: 'Create',
    actorId: CAROL,
    objectId: note.id,
    json: JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${note.id}/activity`,
      type: 'Create',
      actor: CAROL,
      object: {
        id: note.id,
        type: 'Note',
        attributedTo: CAROL,
        url: note.url,
        content: '<p>Carol has thoughts.</p>',
        inReplyTo: note.inReplyTo,
        published: '2026-09-19T10:03:00Z',
      },
    }),
  });
}

async function page(agent: Browser | Cms, url: string = POST_URL): Promise<string> {
  const response = 'app' in agent ? await agent.app.request(url) : await agent.get(url);
  assert.equal(response.status, 200, url);
  return await response.text();
}

function tokenIn(html: string): string {
  const match = new RegExp(`name="${COMMENT_FIELDS.csrf}" value="([^"]+)"`).exec(html);
  assert.ok(match?.[1] !== undefined, 'the signed-in form carries a token');
  return match[1];
}

/** Reply from the thread as Ada, answering `inReplyTo` (empty for the post). */
async function reply(
  cms: Cms,
  inReplyTo: string,
  fields: Record<string, string> = {},
): Promise<{ agent: Browser; created: Document; response: Response }> {
  const agent = await signIn(cms, { username: ADA.username, password: ADA.password });
  const token = tokenIn(await page(agent));
  const before = new Set(replyPosts(cms).map((document) => document.path));
  const response = await agent.post(COMMENT_POST_PATH, {
    [COMMENT_FIELDS.post]: 'hello-world',
    [COMMENT_FIELDS.body]: 'Answering from the thread.',
    [COMMENT_FIELDS.inReplyTo]: inReplyTo,
    [COMMENT_FIELDS.csrf]: token,
    ...fields,
  });
  assert.equal(response.status, 303, await response.clone().text());
  const created = replyPosts(cms).find((document) => !before.has(document.path));
  assert.ok(created !== undefined, 'a reply post was written');
  return { agent, created, response };
}

function replyPosts(cms: Cms): Document[] {
  return cms.store.listAll({ type: 'post' }).filter((document) => document.inReplyTo !== undefined);
}

/** The thread on a post's page, without the links to the posts either side of it. */
async function thread(cms: Cms): Promise<string> {
  const html = await page(cms);
  const start = html.indexOf('id="comments"');
  assert.ok(start > -1, 'the page has a thread');
  return html.slice(start);
}

async function storedComments(cms: Cms): Promise<Record<string, unknown>[]> {
  const source = await readFile(commentsFile(cms.config.contentDir, 'hello-world'), 'utf8');
  return (JSON.parse(source) as { comments: Record<string, unknown>[] }).comments;
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('a signed-in reply from the thread (AC #1)', () => {
  it('to the post is a reply post answering the post, and no comment', async () => {
    const cms = await site();
    const { created } = await reply(cms, '');

    assert.equal(created.inReplyTo, `${BASE_URL}${POST_URL}`);
    assert.equal(created.body.trim(), 'Answering from the thread.');
    assert.equal(created.author, ADA.username);
    assert.equal((await storedComments(cms)).length, 2, 'no comment was added');
  });

  it('to a native comment answers the comment’s own page', async () => {
    const cms = await site();
    const { created } = await reply(cms, NATIVE);
    assert.equal(created.inReplyTo, `${BASE_URL}/comment/${NATIVE}/`);
  });

  it('to a webmention answers the page it was sent from', async () => {
    const cms = await site();
    const { created } = await reply(cms, WEBMENTION);
    assert.equal(created.inReplyTo, SENDER);
  });

  it('to a fediverse reply answers the note by its id', async () => {
    const cms = await site();
    const { created } = await reply(cms, NOTE);
    assert.equal(created.inReplyTo, NOTE);
  });

  it('to a reply post answers the reply post', async () => {
    const cms = await site();
    const { created: first } = await reply(cms, NATIVE);
    const { created: second } = await reply(cms, `${BASE_URL}${first.permalink}`);
    assert.equal(second.inReplyTo, `${BASE_URL}${first.permalink}`);
  });
});

describe('the reply post in the thread (AC #2)', () => {
  it('is shown once under what it answers, with its author, words and its own URL', async () => {
    const cms = await site();
    const { created, response } = await reply(cms, NATIVE);

    const location = response.headers.get('location') ?? '';
    assert.ok(location.startsWith(`${POST_URL}?comment=posted#comment-`), location);

    const html = await thread(cms);
    assert.equal(count(html, 'Answering from the thread.'), 1, 'once');
    const native = html.indexOf(`id="comment-${NATIVE}"`);
    const answer = html.indexOf('comment-post');
    assert.ok(native > -1 && answer > native, 'after the comment it answers');
    const nested = html.slice(native, answer);
    assert.match(nested, /<ol class="children">/, 'nested under it');
    assert.match(html, new RegExp(`class="u-url" href="${created.permalink}"`));
    assert.match(html.slice(answer), new RegExp(ADA.displayName));
  });
});

describe('the "Include in posts and feeds" box (AC #3)', () => {
  it('is offered unchecked to somebody signed in and never to a visitor', async () => {
    const cms = await site();
    const agent = await signIn(cms, { username: ADA.username, password: ADA.password });
    const signed = await page(agent);
    assert.match(signed, /<label for="comment-listed">Include in posts and feeds<\/label>/);
    assert.doesNotMatch(signed, /id="comment-listed"[^>]*checked/);
    assert.doesNotMatch(await page(cms), /Include in posts and feeds/);
  });

  it('left unchecked publishes the reply post unlisted', async () => {
    const cms = await site();
    const { created } = await reply(cms, '');
    assert.equal(created.extra['visibility'], 'unlisted');
  });

  it('checked publishes it public', async () => {
    const cms = await site();
    const { created } = await reply(cms, '', { [COMMENT_FIELDS.listed]: '1' });
    assert.equal(created.extra['visibility'], undefined);
  });

  it('forged by a visitor changes nothing: the visitor leaves a comment', async () => {
    const cms = await site();
    const response = await browser(cms).post(COMMENT_POST_PATH, {
      [COMMENT_FIELDS.post]: 'hello-world',
      [COMMENT_FIELDS.name]: 'A Stranger',
      [COMMENT_FIELDS.body]: 'Hello from outside.',
      [COMMENT_FIELDS.inReplyTo]: '',
      [COMMENT_FIELDS.trap]: '',
      [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
      [COMMENT_FIELDS.listed]: '1',
    });
    assert.equal(response.status, 303);
    assert.deepEqual(replyPosts(cms), []);
    assert.equal((await storedComments(cms)).length, 3);
  });
});

describe('where a reply post is listed (AC #4)', () => {
  it('a public one is in the listing and every feed, an unlisted one in none', async () => {
    const cms = await site();
    const { created: listed } = await reply(cms, '', {
      [COMMENT_FIELDS.body]: 'Listed answer.',
      [COMMENT_FIELDS.listed]: '1',
    });
    const { created: unlisted } = await reply(cms, '', {
      [COMMENT_FIELDS.body]: 'Unlisted answer.',
    });

    for (const url of ['/', '/feed/', '/feed/atom/', '/feed/json/']) {
      const body = await page(cms, url);
      assert.ok(body.includes(listed.permalink), `${url} lists the public reply`);
      assert.ok(!body.includes(unlisted.permalink), `${url} leaves out the unlisted one`);
    }
    const response = await cms.app.request(unlisted.permalink);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  });
});

describe('the Reply links (AC #6)', () => {
  it('are on every reply for somebody signed in, and on native comments only for a visitor', async () => {
    const cms = await site();
    const agent = await signIn(cms, { username: ADA.username, password: ADA.password });

    const signed = await page(agent);
    for (const id of [NATIVE, WEBMENTION, NOTE]) {
      assert.ok(signed.includes(`?reply_to=${encodeURIComponent(id)}#respond`), id);
    }

    const visitor = await page(cms);
    assert.ok(visitor.includes(`?reply_to=${NATIVE}#respond`));
    assert.ok(!visitor.includes(`?reply_to=${WEBMENTION}#respond`));
    assert.ok(!visitor.includes(`?reply_to=${encodeURIComponent(NOTE)}#respond`));
  });

  it('name a fediverse reply on the form for somebody signed in', async () => {
    const cms = await site();
    const agent = await signIn(cms, { username: ADA.username, password: ADA.password });
    const html = await page(agent, `${POST_URL}?reply_to=${encodeURIComponent(NOTE)}`);
    assert.match(html, /Replying to @carol@remote\.example\./);
    assert.ok(html.includes(`value="${NOTE}"`));
  });
});

describe('a reply post written in the editor or over Micropub (AC #7)', () => {
  const ANSWER = frontMatter(
    [
      "title: ''",
      "date: '2026-09-19T11:00:00Z'",
      'permalink: /2026/09/answer/',
      'author: ada',
      `in-reply-to: ${BASE_URL}/comment/${NATIVE}/`,
    ],
    'Written in the editor.',
  );

  it('shows inline under the comment it names', async () => {
    const cms = await site({ 'posts/2026-09-19-answer.md': ANSWER });
    const html = await thread(cms);
    const native = html.indexOf(`id="comment-${NATIVE}"`);
    const answer = html.indexOf('Written in the editor.');
    assert.ok(native > -1 && answer > native);
    assert.equal(count(html, 'Written in the editor.'), 1);
  });

  it('takes its reply context from the stored comment rather than the post page', async () => {
    const cms = await site({ 'posts/2026-09-19-answer.md': ANSWER });
    await cms.replyContexts.settled();

    const context = cms.replyContexts.read(`${BASE_URL}/comment/${NATIVE}/`);
    assert.equal(context?.text, 'Ann says so.');
    assert.equal(context.author?.name, 'Ann');

    const html = await page(cms, '/2026/09/answer/');
    const cited = /<div class="reply-context[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
    assert.match(cited, /Ann says so\./);
    assert.doesNotMatch(cited, /Hello world/, 'not the post the comment is on');
  });
});

describe('answers to a reply post (AC #8)', () => {
  const ANSWER = frontMatter(
    [
      "title: ''",
      "date: '2026-09-19T11:00:00Z'",
      'permalink: /2026/09/answer/',
      'author: ada',
      `in-reply-to: ${BASE_URL}${POST_URL}`,
    ],
    'A reply post.',
  );
  const ANSWERED = JSON.stringify({
    post: '/2026/09/answer/',
    comments: [
      said('00000000-0000-4000-8000-0000000000c1', 'Hugo', 30, {
        source: 'webmention',
        url: 'https://hugo.example/re/',
      }),
    ],
  });

  it('thread under it in the original thread', async () => {
    const cms = await site({
      'posts/2026-09-19-answer.md': ANSWER,
      '_data/comments/answer.json': ANSWERED,
    });
    logNote(cms, {
      id: 'https://remote.example/users/dan/statuses/9',
      url: 'https://remote.example/@dan/9',
      inReplyTo: `${BASE_URL}/2026/09/answer/`,
    });

    const html = await thread(cms);
    const answer = html.indexOf('A reply post.');
    const hugo = html.indexOf('Hugo says so.');
    const dan = html.indexOf('Carol has thoughts.', answer);
    assert.ok(answer > -1 && hugo > answer && dan > answer, 'both under the reply post');
    assert.equal(count(html, 'A reply post.'), 1);
  });
});

describe('what stays a comment (AC #9)', () => {
  it('a visitor answering a fediverse reply leaves a native comment and no post', async () => {
    const cms = await site();
    const response = await browser(cms).post(COMMENT_POST_PATH, {
      [COMMENT_FIELDS.post]: 'hello-world',
      [COMMENT_FIELDS.name]: 'A Stranger',
      [COMMENT_FIELDS.body]: 'Answering Carol.',
      [COMMENT_FIELDS.inReplyTo]: NOTE,
      [COMMENT_FIELDS.trap]: '',
      [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
    });
    assert.equal(response.status, 303);
    assert.deepEqual(replyPosts(cms), []);
    const stored = await storedComments(cms);
    assert.equal(stored.at(-1)?.['source'], 'comment');
  });

  it('an owner comment already on file stays a comment', async () => {
    const cms = await site({
      '_data/comments/hello-world.json': JSON.stringify({
        post: POST_URL,
        comments: [
          said('00000000-0000-4000-8000-0000000000d1', ADA.displayName, 5, {
            author: { name: ADA.displayName, url: '/author/ada/', email: null, avatar: null },
          }),
        ],
      }),
    });
    const html = await page(cms);
    assert.match(html, /comment-comment[\s\S]*Ada Lovelace says so\./);
    assert.deepEqual(replyPosts(cms), []);
  });
});

describe('a reply post in the comments feeds (AC #11)', () => {
  it('is in the post’s feed and the site’s once, linking to the reply post, even unlisted', async () => {
    const cms = await site();
    const { created } = await reply(cms, NATIVE);
    assert.equal(created.extra['visibility'], 'unlisted');
    const link = `<link>${BASE_URL}${created.permalink}</link>`;

    assert.equal(count(await page(cms, `${POST_URL}feed/`), link), 1);
    assert.equal(count(await page(cms, '/comments/feed/'), link), 1);
  });
});

describe('a reply post in the RSS feeds (AC #12)', () => {
  it('carries source:inReplyTo naming what it answers', async () => {
    const cms = await site();
    await reply(cms, NATIVE, { [COMMENT_FIELDS.listed]: '1' });

    const rss = await page(cms, '/feed/');
    assert.ok(
      rss.includes(`<source:inReplyTo>${BASE_URL}/comment/${NATIVE}/</source:inReplyTo>`),
      rss,
    );
  });
});
