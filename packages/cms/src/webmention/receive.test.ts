import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const PAGE = `---
title: About
permalink: /about/
comments: true
---

Who this is.
`;
const PAGE_URL = `${BASE_URL}/about/`;

const EVENT = `---
title: IndieWeb Camp
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/camp/
start: '2026-10-10T14:00:00Z'
location: Chicago Public Library
---

Two days of building.
`;
const EVENT_URL = `${BASE_URL}/2026/09/camp/`;

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
  await writeFile(path.join(contentDir, 'posts', '2026-09-19-camp.md'), EVENT, 'utf8');
  await mkdir(path.join(contentDir, 'pages'), { recursive: true });
  await writeFile(path.join(contentDir, 'pages', 'about.md'), PAGE, 'utf8');

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
    await updateComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      held.id,
      {
        status: 'approved',
      },
    );

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

describe('an RSVP webmention (TASK-198 AC #4)', () => {
  function rsvp(value: string): string {
    return reply(
      `<a class="u-in-reply-to" href="${POST_URL}">the event</a>` +
        `<data class="p-rsvp" value="${value}">${value}</data>` +
        '<div class="e-content"><p>See you there.</p></div>',
    );
  }

  it('is stored as an RSVP, and shown as one in the thread once approved', async () => {
    const cms = await site();
    pages.set('https://them.example/rsvp', { body: rsvp('yes') });
    await sendAndSettle(cms, 'https://them.example/rsvp');

    const [held] = stored(cms);
    assert.ok(held !== undefined);
    assert.equal(held.kind, 'reply');
    assert.equal(held.rsvp, 'yes');

    const { updateComment } = await import('../comments/records.ts');
    await updateComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      held.id,
      { status: 'approved' },
    );

    const page = await (await cms.app.request('/2026/09/hello-world/')).text();
    const comment = /<li id="comment-[^"]*" class="comment h-entry[\s\S]*?<\/li>/.exec(page)?.[0];
    assert.ok(comment !== undefined, 'the RSVP is in the thread');
    assert.match(comment, /<data class="p-rsvp" value="yes">Going<\/data>/);
    assert.match(comment, /See you there\./);
  });

  it('follows the page when it sends again with another answer, or none', async () => {
    const cms = await site();
    pages.set('https://them.example/rsvp', { body: rsvp('yes') });
    await sendAndSettle(cms, 'https://them.example/rsvp');

    pages.set('https://them.example/rsvp', { body: rsvp('no') });
    await sendAndSettle(cms, 'https://them.example/rsvp');
    assert.deepEqual(
      stored(cms).map((one) => one.rsvp),
      ['no'],
    );

    pages.set('https://them.example/rsvp', { body: rsvp('') });
    await sendAndSettle(cms, 'https://them.example/rsvp');
    const [plain] = stored(cms);
    assert.ok(plain !== undefined);
    assert.equal('rsvp' in plain, false);
  });

  it('keeps being an RSVP when the index is rebuilt from the comment file', async () => {
    const cms = await site();
    pages.set('https://them.example/rsvp', { body: rsvp('maybe') });
    await sendAndSettle(cms, 'https://them.example/rsvp');

    const rebuilt = createCms({
      contentDir: cms.config.contentDir,
      dataDir: await temporaryDir('geekity-wm-in-rebuilt-'),
      baseUrl: BASE_URL,
      watch: false,
      now: () => NOW,
    });
    started.push(rebuilt);
    await rebuilt.sync();

    assert.deepEqual(
      rebuilt.admin.listCommentsFor('hello-world').map((one) => one.rsvp),
      ['maybe'],
    );
  });

  it('is a plain reply when its rsvp is none of the four, or there is none', async () => {
    const cms = await site();
    pages.set('https://them.example/rsvp', { body: rsvp('perhaps') });
    pages.set('https://them.example/note', {
      body: reply(
        `<a class="u-in-reply-to" href="${POST_URL}">re</a>` +
          '<div class="e-content"><p>Good post.</p></div>',
      ),
    });
    await sendAndSettle(cms, 'https://them.example/rsvp');
    await sendAndSettle(cms, 'https://them.example/note');

    for (const comment of stored(cms)) {
      assert.equal(comment.kind, 'reply');
      assert.equal('rsvp' in comment, false, `${comment.url ?? ''} carries no rsvp`);
    }
    const file = await readFile(
      path.join(cms.config.contentDir, '_data', 'comments', 'hello-world.json'),
      'utf8',
    );
    assert.doesNotMatch(file, /"rsvp":/);
  });
});

describe('RSVP webmentions to an event (TASK-200 AC #2)', () => {
  function answer(value: string, name: string): string {
    return `<html><body><article class="h-entry">
      <a class="p-author h-card" href="https://${name}.example/">${name}</a>
      <a class="u-in-reply-to" href="${EVENT_URL}">IndieWeb Camp</a>
      <data class="p-rsvp" value="${value}">${value}</data>
      <time class="dt-published" datetime="2026-09-20T09:00:00Z">20 September</time>
    </article></body></html>`;
  }

  function groups(page: string): Record<string, string[]> {
    const found: Record<string, string[]> = {};
    for (const [, kind, body] of page.matchAll(
      /<div class="reaction-group rsvp-(\w+)">([\s\S]*?)<\/div>\s*<\/div>/g,
    )) {
      found[kind ?? ''] = [...(body ?? '').matchAll(/title="([^"]+)"/g)].map((m) => m[1] ?? '');
    }
    return found;
  }

  it('holds each one for the moderator, then shows it in its group once approved', async () => {
    const cms = await site();
    const answers = { ada: 'yes', bea: 'maybe', cy: 'interested', dee: 'no' };
    for (const [name, value] of Object.entries(answers)) {
      pages.set(`https://${name}.example/rsvp`, { body: answer(value, name) });
      await sendAndSettle(cms, `https://${name}.example/rsvp`, EVENT_URL);
    }
    pages.set('https://eve.example/rsvp', {
      body: '<html><body><p class="h-entry">Not a link to the event.</p></body></html>',
    });
    await sendAndSettle(cms, 'https://eve.example/rsvp', EVENT_URL);

    const held = cms.admin.listCommentsFor('camp');
    assert.deepEqual(
      held.map((one) => [one.status, one.rsvp]).sort(),
      [
        ['pending', 'interested'],
        ['pending', 'maybe'],
        ['pending', 'no'],
        ['pending', 'yes'],
      ],
      'four verified and held; the page that does not link the event is not stored',
    );
    assert.deepEqual(groups(await (await cms.app.request('/2026/09/camp/')).text()), {});

    const { updateComment } = await import('../comments/records.ts');
    for (const one of held) {
      await updateComment(
        { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
        one.id,
        { status: 'approved' },
      );
    }

    const page = await (await cms.app.request('/2026/09/camp/')).text();
    assert.deepEqual(groups(page), {
      yes: ['ada'],
      maybe: ['bea'],
      interested: ['cy'],
      no: ['dee'],
    });
    assert.match(
      page,
      /<h2 class="reaction-title">Going <span class="reaction-count">1<\/span><\/h2>/,
    );
    assert.match(page, /<h2 class="reaction-title">Not going <span/);
    assert.doesNotMatch(page, /class="comment h-entry/, 'and none of them is in the thread');
  });
});

describe('a webmention to a page (TASK-196)', () => {
  it('is held, then shown on the page once a moderator approves it, as on a post', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(
        `<a class="u-in-reply-to" href="${PAGE_URL}">re</a>` +
          '<div class="e-content"><p>Good page.</p></div>',
      ),
    });

    const response = await sendAndSettle(cms, 'https://them.example/note', PAGE_URL);
    assert.equal(response.status, 202);

    const held = cms.admin.listCommentsFor('about').filter((one) => one.source === 'webmention');
    assert.equal(held.length, 1);
    assert.equal(held[0]?.status, 'pending', 'held for a moderator like one to a post');

    const before = await (await cms.app.request('/about/')).text();
    assert.doesNotMatch(before, /Good page\./, 'a pending webmention is on no page');

    const { updateComment } = await import('../comments/records.ts');
    await updateComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      held[0]?.id ?? '',
      { status: 'approved' },
    );

    const after = await (await cms.app.request('/about/')).text();
    assert.match(after, /comment-webmention/);
    assert.match(after, /Good page\./);
    assert.match(after, /href="https:\/\/them\.example\/note"/);
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

describe('a webmention that answers a reply on the post (TASK-319)', () => {
  const NOTE = 'https://remote.example/notes/1';
  const NOTE_URL = 'https://remote.example/@ada/1';
  const IMPORTED = 'https://old.example/?p=7#comment-5';

  function records(cms: Cms) {
    return { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir };
  }

  async function comment(
    cms: Cms,
    values: { id?: string; slug?: string; permalink?: string; status?: PostComment['status'] } = {},
  ): Promise<PostComment> {
    const { addComment } = await import('../comments/records.ts');
    return await addComment(records(cms), {
      id: values.id,
      slug: values.slug ?? 'hello-world',
      permalink: values.permalink ?? '/2026/09/hello-world/',
      source: 'comment',
      kind: 'reply',
      status: values.status ?? 'approved',
      author: { name: 'Bob', url: null, email: null, avatar: null },
      content: { markdown: 'Bob says so.', html: '<p>Bob says so.</p>' },
      submitted: '2026-09-19T10:00:00.000Z',
      addressHash: null,
      inReplyTo: null,
      url: null,
      notify: false,
    });
  }

  function pageOf(id: string): string {
    return `${BASE_URL}/comment/${encodeURIComponent(id)}/`;
  }

  function answering(...urls: string[]): string {
    return reply(
      urls.map((url) => `<a class="u-in-reply-to" href="${url}">re</a>`).join('') +
        '<div class="e-content"><p>An answer.</p></div>',
    );
  }

  function federatedNote(cms: Cms): void {
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
          inReplyTo: POST_URL,
          published: '2026-09-19T09:30:00Z',
          url: NOTE_URL,
        },
      }),
    });
  }

  it('threads under a comment its source answers by the comment’s own page (AC #1, #4)', async () => {
    const cms = await site();
    const parent = await comment(cms);
    pages.set('https://them.example/note', { body: answering(pageOf(parent.id)) });

    const response = await sendAndSettle(cms, 'https://them.example/note', pageOf(parent.id));
    assert.equal(response.status, 202, 'a webmention aimed at a comment page is accepted');

    const held = stored(cms);
    assert.equal(held.length, 1, 'it lands on the comment’s post');
    assert.equal(held[0]?.kind, 'reply');
    assert.equal(held[0]?.inReplyTo, parent.id);
    assert.equal(held[0]?.url, 'https://them.example/note', 'its URL stays its sender’s page');

    const { updateComment } = await import('../comments/records.ts');
    await updateComment(records(cms), held[0]?.id ?? '', { status: 'approved' });
    const page = await (await cms.app.request(`/comment/${encodeURIComponent(parent.id)}/`)).text();
    assert.match(page, /An answer\./, 'and once approved it is under that comment on its page');
  });

  it('finds a comment whose id is a URL by its percent-encoded page (AC #1)', async () => {
    const cms = await site();
    await comment(cms, { id: IMPORTED });
    pages.set('https://them.example/note', { body: answering(pageOf(IMPORTED)) });

    assert.equal(
      (await sendAndSettle(cms, 'https://them.example/note', pageOf(IMPORTED))).status,
      202,
    );
    assert.equal(stored(cms)[0]?.inReplyTo, IMPORTED);
  });

  it('threads under a comment its source answers by the post’s #comment- anchor (AC #1)', async () => {
    const cms = await site();
    const parent = await comment(cms);
    const anchored = `${POST_URL}#comment-${parent.id}`;
    pages.set('https://them.example/note', { body: answering(anchored) });

    await sendAndSettle(cms, 'https://them.example/note', anchored);
    assert.equal(stored(cms)[0]?.inReplyTo, parent.id);
  });

  it('threads under a comment still waiting for a moderator', async () => {
    const cms = await site();
    const parent = await comment(cms, { status: 'pending' });
    const anchored = `${POST_URL}#comment-${parent.id}`;
    pages.set('https://them.example/note', { body: answering(anchored) });

    await sendAndSettle(cms, 'https://them.example/note', anchored);
    assert.equal(stored(cms)[0]?.inReplyTo, parent.id);
  });

  it('threads under an earlier webmention reply its source answers by its sender URL (AC #2)', async () => {
    const cms = await site();
    pages.set('https://first.example/reply', { body: answering(POST_URL) });
    await sendAndSettle(cms, 'https://first.example/reply');
    const first = stored(cms)[0];
    assert.ok(first !== undefined);

    pages.set('https://them.example/note', {
      body: reply(
        '<a class="u-in-reply-to" href="https://first.example/reply">re</a>' +
          `<div class="e-content"><p>On <a href="${POST_URL}">this post</a>.</p></div>`,
      ),
    });
    await sendAndSettle(cms, 'https://them.example/note');

    const second = stored(cms).find((one) => one.url === 'https://them.example/note');
    assert.equal(second?.inReplyTo, first.id);
    assert.equal(second?.kind, 'reply', 'a reply here though it never names the post itself');
  });

  it('threads under a fediverse reply its source answers by the note’s url or id (AC #2)', async () => {
    const cms = await site();
    federatedNote(cms);

    pages.set('https://them.example/by-url', { body: answering(NOTE_URL, POST_URL) });
    pages.set('https://them.example/by-id', { body: answering(NOTE, POST_URL) });
    await sendAndSettle(cms, 'https://them.example/by-url');
    await sendAndSettle(cms, 'https://them.example/by-id');

    const byUrl = stored(cms).find((one) => one.url === 'https://them.example/by-url');
    const byId = stored(cms).find((one) => one.url === 'https://them.example/by-id');
    assert.equal(byUrl?.inReplyTo, NOTE);
    assert.equal(byId?.inReplyTo, NOTE);
  });

  it('stays top-level when it answers only the post, another post’s comment, or nothing (AC #3)', async () => {
    const cms = await site();
    const elsewhere = await comment(cms, { slug: 'camp', permalink: '/2026/09/camp/' });

    pages.set('https://them.example/post-only', { body: answering(POST_URL) });
    pages.set('https://them.example/other-post', {
      body: answering(pageOf(elsewhere.id), POST_URL),
    });
    pages.set('https://them.example/nothing', {
      body: reply(`<a href="${POST_URL}">a link</a>`),
    });
    await sendAndSettle(cms, 'https://them.example/post-only');
    await sendAndSettle(cms, 'https://them.example/other-post');
    await sendAndSettle(cms, 'https://them.example/nothing');

    const held = stored(cms);
    assert.equal(held.length, 3);
    for (const one of held) assert.equal(one.inReplyTo, null, `${one.url ?? ''} is top-level`);
  });

  it('moves to its new parent when the source is edited and sent again (AC #5)', async () => {
    const cms = await site();
    const one = await comment(cms);
    const two = await comment(cms);

    pages.set('https://them.example/note', { body: answering(pageOf(one.id), POST_URL) });
    await sendAndSettle(cms, 'https://them.example/note');
    assert.equal(stored(cms)[0]?.inReplyTo, one.id);

    pages.set('https://them.example/note', { body: answering(pageOf(two.id), POST_URL) });
    await sendAndSettle(cms, 'https://them.example/note');
    assert.equal(stored(cms).length, 1, 'still one comment');
    assert.equal(stored(cms)[0]?.inReplyTo, two.id, 'under the comment it answers now');

    pages.set('https://them.example/note', { body: answering(POST_URL) });
    await sendAndSettle(cms, 'https://them.example/note');
    assert.equal(stored(cms)[0]?.inReplyTo, null, 'and back at the top once it answers the post');
  });
});
