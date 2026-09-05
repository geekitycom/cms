import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { createUser } from '../admin/accounts.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { PostComment } from '../admin/store.ts';
import type { CommentSubmission, CommentVerdict } from '../comments/submission.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import { WEBMENTION_PATH } from './routes.ts';

/**
 * Webmentions as somebody else's server meets them: an endpoint advertised on
 * every post, a 202 for something worth checking, a 400 for something that is
 * not, and a comment in the queue once the source has been read and found to
 * really link here.
 *
 * The cases below include the ones webmention.rocks puts a receiver through —
 * the link in an `<a>`, an `<img>`, a `<video>`, behind a redirect, written
 * relative, only in the text, gone from a page that used to have it, and a
 * source that answers 410 — run against a make-believe web rather than the
 * live one, because the test suite reaches no network.
 */

const BASE_URL = 'https://blog.example';
const POST_URL = `${BASE_URL}/2026/09/hello-world/`;

/** The post everything below points at. */
const POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

/** The moment the site's clock is stopped at. */
const NOW = new Date('2026-09-20T12:00:00.000Z');

/** What the make-believe web answers for one URL. */
interface Page {
  status?: number;
  body?: string;
  redirectTo?: string;
  contentType?: string;
}

const pages = new Map<string, Page>();
const started: Cms[] = [];
const temporaryDirs: string[] = [];

const restoreFetch = routeTheWeb();

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  pages.clear();
});

function routeTheWeb(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(answer(input))) as typeof fetch;

  /** What the make-believe web answers, with no network anywhere near it. */
  function answer(input: string | URL | Request): Response {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    for (let hop = 0; hop < 5; hop += 1) {
      const page = pages.get(url);
      if (page?.redirectTo === undefined) break;
      url = new URL(page.redirectTo, url).href;
    }

    const page = pages.get(url);
    if (page === undefined) return new Response('missing', { status: 404 });

    const response = new Response(page.status === 410 ? 'gone' : (page.body ?? ''), {
      status: page.status ?? 200,
      headers: { 'content-type': page.contentType ?? 'text/html; charset=utf-8' },
    });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  }

  return () => {
    globalThis.fetch = original;
  };
}

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** A CMS over one post. */
async function site(
  config: GeekityConfig = {},
  settings: { webmentionsReceive?: boolean } = {},
): Promise<Cms> {
  const contentDir = await temporaryDir('geekity-wm-in-content-');
  const dataDir = await temporaryDir('geekity-wm-in-data-');

  const file = path.join(contentDir, 'posts', '2026-09-19-hello-world.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, POST, 'utf8');

  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      baseUrl: BASE_URL,
      notifyServer: '',
      webmentionsSend: false,
      webmentionsReceive: settings.webmentionsReceive ?? true,
    },
  });

  const instance = createCms({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    ...config,
  });
  started.push(instance);
  await instance.sync();
  return instance;
}

/** Send one webmention the way a remote server would. */
async function send(cms: Cms, fields: Record<string, string>): Promise<Response> {
  return await cms.app.request(WEBMENTION_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

/** Send one and wait for the verification behind it. */
async function sendAndSettle(cms: Cms, source: string, target = POST_URL): Promise<Response> {
  const response = await send(cms, { source, target });
  await cms.webmentions.settled();
  return response;
}

/** The webmentions stored against the post. */
function stored(cms: Cms): PostComment[] {
  return cms.admin.listCommentsFor('hello-world').filter((one) => one.source === 'webmention');
}

/** A source page whose h-entry answers the post. */
function reply(body: string): string {
  return `<html><head><title>A reply</title></head><body>
    <article class="h-entry">
      <a class="p-author h-card" href="https://them.example/">Ada Lovelace
        <img class="u-photo" src="/me.jpg" alt=""></a>
      ${body}
      <time class="dt-published" datetime="2026-09-20T09:00:00Z">20 September</time>
    </article></body></html>`;
}

describe('advertising the endpoint', () => {
  it('puts it on a post’s Link header and in its head', async () => {
    const cms = await site();

    const response = await cms.app.request('/2026/09/hello-world/');
    const html = await response.text();

    assert.match(
      response.headers.get('link') ?? '',
      /<\/_geekity\/webmention>;\s*rel="webmention"/,
      'the Link header advertises the endpoint',
    );
    assert.match(html, /<link rel="webmention" href="\/_geekity\/webmention">/);
  });

  it('advertises nothing when the site does not take them', async () => {
    const cms = await site({}, { webmentionsReceive: false });

    const response = await cms.app.request('/2026/09/hello-world/');
    const html = await response.text();

    assert.doesNotMatch(response.headers.get('link') ?? '', /webmention/);
    assert.doesNotMatch(html, /rel="webmention"/);
    assert.equal(
      (await send(cms, { source: 'https://them.example/x', target: POST_URL })).status,
      404,
    );
  });
});

describe('what the endpoint refuses', () => {
  it('refuses a request that leaves out source or target', async () => {
    const cms = await site();

    assert.equal((await send(cms, { target: POST_URL })).status, 400);
    assert.equal((await send(cms, { source: 'https://them.example/a' })).status, 400);
  });

  it('refuses a source or target that is not an http URL', async () => {
    const cms = await site();

    assert.equal(
      (await send(cms, { source: 'ftp://them.example/a', target: POST_URL })).status,
      400,
    );
    assert.equal(
      (await send(cms, { source: 'https://them.example/a', target: 'nonsense' })).status,
      400,
    );
  });

  it('refuses a source and target that are the same page', async () => {
    const cms = await site();

    assert.equal((await send(cms, { source: POST_URL, target: POST_URL })).status, 400);
  });

  it('refuses a target that is not on this site', async () => {
    const cms = await site();

    const response = await send(cms, {
      source: 'https://them.example/a',
      target: 'https://elsewhere.example/post/',
    });
    assert.equal(response.status, 400);
  });

  it('refuses a target that is no page of this site', async () => {
    const cms = await site();

    const response = await send(cms, {
      source: 'https://them.example/a',
      target: `${BASE_URL}/2026/09/nothing-here/`,
    });
    assert.equal(response.status, 400);
  });

  it('refuses a source on a private address, which is not somebody else’s page', async () => {
    const cms = await site();

    const response = await send(cms, { source: 'http://127.0.0.1/x', target: POST_URL });
    assert.equal(response.status, 400);
  });
});

describe('verifying a webmention', () => {
  it('stores a reply, held for moderation, with its author and content', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(
        `<a class="u-in-reply-to" href="${POST_URL}">re</a>` +
          '<div class="e-content"><p>Good <em>post</em>.</p></div>',
      ),
    });

    const response = await sendAndSettle(cms, 'https://them.example/note');
    assert.equal(response.status, 202, 'a webmention worth checking is accepted');

    const held = stored(cms);
    assert.equal(held.length, 1);
    const one = held[0];
    assert.equal(one?.kind, 'reply');
    assert.equal(one?.status, 'pending', 'held for a moderator like any comment');
    assert.equal(one?.author.name, 'Ada Lovelace');
    assert.equal(one?.author.url, 'https://them.example/');
    assert.equal(one?.author.email, null);
    assert.equal(one?.author.avatar, 'https://them.example/me.jpg');
    assert.equal(one?.url, 'https://them.example/note');
    assert.equal(one?.content.html, '<p>Good <em>post</em>.</p>');
    assert.equal(one?.submitted, '2026-09-20T09:00:00.000Z');
  });

  it('stores a like, a repost and a plain mention as what they are', async () => {
    const cms = await site();
    pages.set('https://them.example/like', {
      body: reply(`<a class="u-like-of" href="${POST_URL}">liked</a>`),
    });
    pages.set('https://them.example/repost', {
      body: reply(`<a class="u-repost-of" href="${POST_URL}">boosted</a>`),
    });
    pages.set('https://them.example/mention', {
      body: reply(`<div class="e-content"><p>See <a href="${POST_URL}">this</a>.</p></div>`),
    });

    await sendAndSettle(cms, 'https://them.example/like');
    await sendAndSettle(cms, 'https://them.example/repost');
    await sendAndSettle(cms, 'https://them.example/mention');

    assert.deepEqual(
      stored(cms)
        .map((one) => one.kind)
        .sort(),
      ['like', 'mention', 'repost'],
    );
  });

  it('accepts a link in an image, a video and a relative href', async () => {
    const cms = await site();
    pages.set('https://them.example/img', { body: `<img src="${POST_URL}" alt="">` });
    pages.set('https://them.example/video', { body: `<video src="${POST_URL}"></video>` });
    pages.set(`${BASE_URL}/elsewhere/`, { body: '<a href="/2026/09/hello-world/">mine</a>' });

    await sendAndSettle(cms, 'https://them.example/img');
    await sendAndSettle(cms, 'https://them.example/video');
    await sendAndSettle(cms, `${BASE_URL}/elsewhere/`);

    assert.equal(stored(cms).length, 3, 'all three link to the target');
  });

  it('accepts a link element in the head, which is a link like any other', async () => {
    const cms = await site();
    pages.set('https://them.example/head', {
      body: `<html><head><link rel="related" href="${POST_URL}"></head><body>x</body></html>`,
    });

    await sendAndSettle(cms, 'https://them.example/head');

    assert.equal(stored(cms).length, 1);
  });

  it('accepts a plain text or JSON source that names the target', async () => {
    const cms = await site();
    pages.set('https://them.example/note.txt', {
      body: `I liked ${POST_URL} a lot.`,
      contentType: 'text/plain; charset=utf-8',
    });
    pages.set('https://them.example/note.json', {
      body: JSON.stringify({ url: POST_URL }),
      contentType: 'application/json',
    });

    await sendAndSettle(cms, 'https://them.example/note.txt');
    await sendAndSettle(cms, 'https://them.example/note.json');

    // Nothing about either says what kind of mention it is or who wrote it, so
    // both are a plain mention under the host that sent them.
    assert.deepEqual(
      stored(cms).map((one) => [one.kind, one.author.name]),
      [
        ['mention', 'them.example'],
        ['mention', 'them.example'],
      ],
    );
  });

  it('follows a redirect and verifies the page it lands on', async () => {
    const cms = await site();
    pages.set('https://them.example/old', { redirectTo: 'https://them.example/new' });
    pages.set('https://them.example/new', { body: reply(`<a href="${POST_URL}">there</a>`) });

    await sendAndSettle(cms, 'https://them.example/old');

    assert.equal(stored(cms).length, 1);
  });

  it('stores nothing when the source only writes the target out as text', async () => {
    const cms = await site();
    pages.set('https://them.example/text', { body: `<p>${POST_URL}</p>` });

    const response = await sendAndSettle(cms, 'https://them.example/text');

    assert.equal(response.status, 202, 'the check happens after the answer');
    assert.deepEqual(stored(cms), []);
  });

  it('stores nothing when the source is not there at all', async () => {
    const cms = await site();

    await sendAndSettle(cms, 'https://them.example/never');

    assert.deepEqual(stored(cms), []);
  });
});

describe('a webmention that comes again', () => {
  it('updates the one it made before rather than adding a second', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(
        `<a class="u-in-reply-to" href="${POST_URL}">re</a>` +
          '<div class="e-content"><p>First thought.</p></div>',
      ),
    });
    await sendAndSettle(cms, 'https://them.example/note');
    const first = stored(cms)[0];

    pages.set('https://them.example/note', {
      body: reply(
        `<a class="u-in-reply-to" href="${POST_URL}">re</a>` +
          '<div class="e-content"><p>Second thought.</p></div>',
      ),
    });
    await sendAndSettle(cms, 'https://them.example/note');

    const held = stored(cms);
    assert.equal(held.length, 1, 'still one comment');
    assert.equal(held[0]?.id, first?.id, 'the same one');
    assert.equal(held[0]?.content.html, '<p>Second thought.</p>');
  });

  it('deletes it when the source no longer links here', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');
    assert.equal(stored(cms).length, 1);

    pages.set('https://them.example/note', { body: reply('<p>Changed my mind.</p>') });
    await sendAndSettle(cms, 'https://them.example/note');

    assert.deepEqual(stored(cms), [], 'the mention is gone from the file and the index');
  });

  it('deletes it when the source answers 404', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');

    pages.delete('https://them.example/note');
    await sendAndSettle(cms, 'https://them.example/note');

    assert.deepEqual(stored(cms), []);
  });

  it('keeps it when the source is only having a bad afternoon', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');

    pages.set('https://them.example/note', { status: 503 });
    await sendAndSettle(cms, 'https://them.example/note');

    assert.equal(stored(cms).length, 1, 'a 5xx is not a page saying it never linked here');
  });

  it('deletes it when the source has gone', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');

    pages.set('https://them.example/note', { status: 410 });
    await sendAndSettle(cms, 'https://them.example/note');

    assert.deepEqual(stored(cms), []);
  });
});

describe('the spam checker seam', () => {
  it('is asked about a webmention, and is told it is one', async () => {
    const seen: CommentSubmission[] = [];
    const cms = await site({
      commentChecker: {
        check(submission: CommentSubmission): CommentVerdict {
          seen.push(submission);
          return 'unknown';
        },
      },
    });
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });

    await sendAndSettle(cms, 'https://them.example/note');

    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.comment.source, 'webmention');
    assert.equal(seen[0]?.post.slug, 'hello-world');
    assert.equal(seen[0]?.post.url, POST_URL);
    assert.equal(seen[0]?.baseUrl, BASE_URL);
  });

  it('files one it calls spam as spam, and never stores one it says to discard', async () => {
    const verdicts: CommentVerdict[] = ['spam', 'discard'];
    const cms = await site({
      commentChecker: {
        check(): CommentVerdict {
          return verdicts.shift() ?? 'unknown';
        },
      },
    });
    pages.set('https://them.example/one', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });
    pages.set('https://them.example/two', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });

    await sendAndSettle(cms, 'https://them.example/one');
    await sendAndSettle(cms, 'https://them.example/two');

    assert.deepEqual(
      stored(cms).map((one) => [one.url, one.status]),
      [['https://them.example/one', 'spam']],
    );
  });
});

describe('a webmention on the page', () => {
  it('is nowhere until a moderator approves it, and then it is in the thread', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(
        `<a class="u-in-reply-to" href="${POST_URL}">re</a>` +
          '<div class="e-content"><p>Good post.</p></div>',
      ),
    });
    await sendAndSettle(cms, 'https://them.example/note');

    const before = await (await cms.app.request('/2026/09/hello-world/')).text();
    assert.doesNotMatch(before, /Good post\./, 'a pending webmention is on no page');

    const held = stored(cms)[0];
    assert.ok(held !== undefined);
    const { updateComment } = await import('../comments/records.ts');
    await updateComment({ admin: cms.admin, contentDir: cms.config.contentDir }, held.id, {
      status: 'approved',
    });

    const after = await (await cms.app.request('/2026/09/hello-world/')).text();
    assert.match(after, /comment-webmention/, 'and an approved one says where it came from');
    assert.match(after, /Good post\./);
    assert.match(
      after,
      /href="https:\/\/them\.example\/note"/,
      'its permalink is the page it was sent from, not an anchor on this one',
    );
    assert.doesNotMatch(after, /reply_to=/, 'and it offers no Reply link, which would go nowhere');
  });
});

describe('telling the moderators about it (TASK-55)', () => {
  /** The site above, with an admin who has an address and mail in a list. */
  async function siteWithMail(): Promise<{ cms: Cms; provider: MemoryMailProvider }> {
    const provider = createMemoryMailProvider();
    const cms = await site({
      mail: { provider, backoffMs: () => 0, logger: { info: () => {}, warn: () => {} } },
    });
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'ada',
      password: 'correct horse battery',
      email: 'ada@example.com',
    });
    return { cms, provider };
  }

  it('emails them once, when the webmention is first stored', async () => {
    const { cms, provider } = await siteWithMail();
    pages.set('https://them.example/note', {
      body: reply(
        `<a class="u-in-reply-to" href="${POST_URL}">re</a>` +
          '<div class="e-content"><p>First thought.</p></div>',
      ),
    });

    await sendAndSettle(cms, 'https://them.example/note');
    await cms.mail.settled();

    assert.equal(provider.sent.length, 1);
    assert.match(provider.sent[0]?.text ?? '', /https:\/\/them\.example\/note/);
    assert.match(provider.sent[0]?.subject ?? '', /Hello world/);
  });

  it('says nothing the second time the same page sends one', async () => {
    const { cms, provider } = await siteWithMail();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');
    await cms.mail.settled();
    provider.clear();

    await sendAndSettle(cms, 'https://them.example/note');
    await cms.mail.settled();

    assert.equal(provider.sent.length, 0, 'an edited page re-sending is not new news');
  });
});
