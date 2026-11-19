import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import type { ConversationSite } from '../comments/conversation.ts';
import type { Document } from '../content/document.ts';
import { openAdminStore } from '../store/admin-store.ts';
import type { AdminStore, PostComment } from '../store/admin-store.ts';
import type { CommentSubmission, CommentVerdict } from '../forms/checker.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import { DEFAULT_SITE_SETTINGS } from '../site/settings.ts';
import { writeSiteSettings } from '../__testing__/site-settings.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { nextEvent } from '../__testing__/wait.ts';
import type { HostLookup } from '../util/public-address.ts';
import { WEBMENTION_PATH } from './endpoint.ts';
import { verifyWebmention } from './receive.ts';
import {
  addComment,
  commentsFile,
  rebuildCommentIndexes,
  updateComment,
} from '../comments/records.ts';

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
  body?: string | Uint8Array;
  redirectTo?: string;
  contentType?: string;
  /** The answer waits until this settles, or the request is aborted. */
  gate?: Promise<void>;
}

const pages = new Map<string, Page>();
const requested: string[] = [];

const lookup: HostLookup = (hostname) =>
  Promise.resolve(hostname.endsWith('.internal.example') ? ['127.0.0.1'] : ['203.0.113.7']);

const started: Cms[] = [];
const temporaryDirs: string[] = [];
const gates: (() => void)[] = [];
const hearing = new Set<() => void>();

const restoreFetch = routeTheWeb();

after(async () => {
  for (const open of gates) open();
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  pages.clear();
  requested.length = 0;
});

function routeTheWeb(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    answer(input, init?.signal ?? undefined)) as typeof fetch;

  /** What the make-believe web answers, with no network anywhere near it. */
  async function answer(input: string | URL | Request, signal?: AbortSignal): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    for (const hear of hearing) hear();

    const page = pages.get(url.split('#')[0] ?? url);
    if (page === undefined) return new Response('missing', { status: 404 });
    if (page.gate !== undefined) {
      await new Promise<void>((resolve, reject) => {
        void page.gate?.then(resolve);
        signal?.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      });
    }
    if (page.redirectTo !== undefined) {
      return new Response(null, { status: 302, headers: { location: page.redirectTo } });
    }

    return new Response(page.status === 410 ? 'gone' : (page.body ?? ''), {
      status: page.status ?? 200,
      headers: { 'content-type': page.contentType ?? 'text/html; charset=utf-8' },
    });
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

  await writeSiteSettings({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      base_url: BASE_URL,
      notify_server: '',
      webmentions_send: false,
      webmentions_receive: settings.webmentionsReceive ?? true,
    },
  });

  const instance = createCms({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    hostLookup: lookup,
    ...config,
  });
  started.push(instance);
  await instance.sync();
  return instance;
}

/** Another CMS on the directories `cms` uses, as the next process would be. */
async function nextProcess(cms: Cms, config: GeekityConfig = {}): Promise<Cms> {
  const instance = createCms({
    contentDir: cms.config.contentDir,
    dataDir: cms.config.dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    hostLookup: lookup,
    port: 0,
    ...config,
  });
  started.push(instance);
  await instance.sync();
  return instance;
}

/** A gate that opens when `open` is called, or once the file has run. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  gates.push(open);
  return { promise, open };
}

/** Resolve once `url` has been fetched `times` times. */
function fetched(url: string, times = 1): Promise<void> {
  return nextEvent(`fetch ${String(times)} of ${url}`, (done) => {
    const hear = (): void => {
      if (requested.filter((one) => one === url).length >= times) done();
    };
    hearing.add(hear);
    hear();
    return () => hearing.delete(hear);
  });
}

/** Resolve once a webmention from `url` is stored on the post. */
function storedFrom(cms: Cms, url: string, timeoutMs?: number): Promise<void> {
  return nextEvent(
    `a webmention from ${url}`,
    (done) => {
      const look = (): void => {
        if (stored(cms).some((one) => one.url === url)) done();
      };
      look();
      return cms.admin.onConversationWrite(look);
    },
    timeoutMs,
  );
}

/** The checks the site has accepted and not finished, as its data file holds them. */
async function waitingChecks(cms: Cms): Promise<unknown[]> {
  try {
    return JSON.parse(
      await readFile(path.join(cms.config.dataDir, 'webmention-checks.json'), 'utf8'),
    ) as unknown[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
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
function reply(body: string, author = 'Ada Lovelace'): string {
  return `<html><head><title>A reply</title></head><body>
    <article class="h-entry">
      <a class="p-author h-card" href="https://them.example/">${author}
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
    assert.equal((await send(cms, { source: `${POST_URL}#x`, target: POST_URL })).status, 400);
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

  it('refuses a source on this site, and stores nothing from it', async () => {
    const cms = await site();
    pages.set(`${BASE_URL}/`, {
      body: `<div class="h-card"><a class="u-url p-name" href="${BASE_URL}/">Site Owner</a></div>
        <a href="${POST_URL}">Hello world</a>`,
    });
    pages.set(POST_URL, {
      body: `<article class="h-entry"><a class="u-url" href="${POST_URL}">self</a></article>`,
    });

    assert.equal((await sendAndSettle(cms, `${BASE_URL}/`)).status, 400);
    assert.equal((await sendAndSettle(cms, `${POST_URL}#x`)).status, 400);
    assert.equal((await sendAndSettle(cms, `${BASE_URL}/2026/09/camp/#top`)).status, 400);
    assert.deepEqual(stored(cms), []);
    assert.deepEqual(requested, []);
  });

  it('refuses a body of megabytes with 413 and queues nothing', async () => {
    const cms = await site();
    pages.set('https://them.example/big', { body: reply(`<a href="${POST_URL}">yes</a>`) });
    const body =
      new URLSearchParams({ source: 'https://them.example/big', target: POST_URL }).toString() +
      '&pad=' +
      'x'.repeat(4 * 1024 * 1024);

    const response = await cms.app.request(WEBMENTION_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(body.length),
      },
      body,
    });
    await cms.webmentions.settled();

    assert.equal(response.status, 413);
    assert.deepEqual(requested, []);
    assert.deepEqual(stored(cms), []);
  });

  it('refuses a body over the limit that does not say its length', async () => {
    const cms = await site();
    pages.set('https://them.example/big', { body: reply(`<a href="${POST_URL}">yes</a>`) });
    const form = new URLSearchParams({ source: 'https://them.example/big', target: POST_URL });
    const chunks = [form.toString(), '&pad=', 'x'.repeat(64 * 1024)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next === undefined) controller.close();
        else controller.enqueue(new TextEncoder().encode(next));
      },
    });

    const response = await cms.app.request(WEBMENTION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      duplex: 'half',
    } as RequestInit);
    await cms.webmentions.settled();

    assert.equal(response.status, 413);
    assert.deepEqual(requested, []);
  });

  it('refuses a malformed multipart body with 400', async () => {
    const cms = await site();

    const response = await cms.app.request(WEBMENTION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
      body: '--xyz\r\nnot a part at all',
    });

    assert.equal(response.status, 400);
  });

  it('refuses a multipart form, which is not the type a webmention is sent as', async () => {
    const cms = await site();
    const form = new FormData();
    form.set('source', 'https://them.example/a');
    form.set('target', POST_URL);

    const response = await cms.app.request(WEBMENTION_PATH, { method: 'POST', body: form });
    await cms.webmentions.settled();

    assert.equal(response.status, 400);
    assert.deepEqual(requested, []);
  });

  it('refuses a source on a private address, which is not somebody else’s page', async () => {
    const cms = await site();

    const response = await send(cms, { source: 'http://127.0.0.1/x', target: POST_URL });
    assert.equal(response.status, 400);
  });
});

describe('verifying a webmention', () => {
  it('stores a reply whose source links to an anchor on the post', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}#comments">re</a>`),
    });

    assert.equal((await sendAndSettle(cms, 'https://them.example/note')).status, 202);
    assert.equal(stored(cms).length, 1);
    assert.equal(stored(cms)[0]?.kind, 'reply');
  });

  it('stores a webmention sent to an anchor on the post from a source that links the post', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });

    const response = await sendAndSettle(cms, 'https://them.example/note', `${POST_URL}#comments`);
    assert.equal(response.status, 202);
    assert.equal(stored(cms)[0]?.kind, 'reply');
  });

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
    pages.set('https://them.example/relative', {
      body: '<a href="//blog.example/2026/09/hello-world/">yours</a>',
    });

    await sendAndSettle(cms, 'https://them.example/img');
    await sendAndSettle(cms, 'https://them.example/video');
    await sendAndSettle(cms, 'https://them.example/relative');

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

  it('stores nothing for a text source that names only a longer URL', async () => {
    const cms = await site();
    pages.set('https://them.example/note.txt', {
      body: `See ${POST_URL}more for details.`,
      contentType: 'text/plain; charset=utf-8',
    });

    await sendAndSettle(cms, 'https://them.example/note.txt');

    assert.deepEqual(stored(cms), []);
  });

  it('accepts a text source that names the target at the end of a sentence', async () => {
    const cms = await site();
    pages.set('https://them.example/note.txt', {
      body: `Read (${POST_URL}), then "${POST_URL}#comments".\nOr just ${POST_URL}.`,
      contentType: 'text/plain; charset=utf-8',
    });

    await sendAndSettle(cms, 'https://them.example/note.txt');

    assert.equal(stored(cms).length, 1);
  });

  it('stores nothing for a JSON source that has the target only inside a longer string', async () => {
    const cms = await site();
    pages.set('https://them.example/note.json', {
      body: JSON.stringify({ q: `${POST_URL}?echo=1`, text: `I liked ${POST_URL} a lot.` }),
      contentType: 'application/json',
    });

    await sendAndSettle(cms, 'https://them.example/note.json');

    assert.deepEqual(stored(cms), []);
  });

  it('accepts a JSON source that writes the target with escaped slashes', async () => {
    const cms = await site();
    pages.set('https://them.example/note.json', {
      body: `{"items":[{"url":"${POST_URL.replaceAll('/', '\\/')}"}]}`,
      contentType: 'application/activity+json',
    });

    await sendAndSettle(cms, 'https://them.example/note.json');

    assert.equal(stored(cms).length, 1);
  });

  it('accepts a JSON source whose array holds hundreds of thousands of values', async () => {
    const cms = await site();
    pages.set('https://them.example/note.json', {
      body: `[${'0,'.repeat(300_000)}"${POST_URL}"]`,
      contentType: 'application/json',
    });

    await sendAndSettle(cms, 'https://them.example/note.json');

    assert.equal(stored(cms).length, 1);
  });

  it('follows a redirect and verifies the page it lands on', async () => {
    const cms = await site();
    pages.set('https://them.example/old', { redirectTo: 'https://them.example/new' });
    pages.set('https://them.example/new', { body: reply(`<a href="${POST_URL}">there</a>`) });

    await sendAndSettle(cms, 'https://them.example/old');

    assert.equal(stored(cms).length, 1);
  });

  it('fetches nothing from a source whose name resolves to a private address', async () => {
    const cms = await site();
    pages.set('https://wiki.internal.example/note', {
      body: reply(`<a href="${POST_URL}">there</a>`),
    });

    const response = await sendAndSettle(cms, 'https://wiki.internal.example/note');

    assert.equal(response.status, 202);
    assert.deepEqual(requested, []);
    assert.equal(stored(cms).length, 0);
  });

  it('stops at a redirect to a private address', async () => {
    const cms = await site();
    pages.set('https://them.example/moved', { redirectTo: 'http://wiki.internal.example/note' });
    pages.set('http://wiki.internal.example/note', {
      body: reply(`<a href="${POST_URL}">there</a>`),
    });

    await sendAndSettle(cms, 'https://them.example/moved');

    assert.deepEqual(requested, ['https://them.example/moved']);
    assert.equal(stored(cms).length, 0);
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

  it('takes the source with a fragment as the same page', async () => {
    const cms = await site();
    const note = 'https://them.example/note';
    pages.set(note, {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a><p>Hi.</p>`),
    });

    await sendAndSettle(cms, note);
    await sendAndSettle(cms, `${note}#one`);
    await sendAndSettle(cms, `${note}#two`);

    const held = stored(cms);
    assert.equal(held.length, 1, 'one comment');
    assert.equal(held[0]?.url, note);
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

  it('keeps it when the page grows past the read limit with the link after the cut', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');
    assert.equal(stored(cms).length, 1);

    const padding = `<!-- ${'x'.repeat(1_200_000)} -->`;
    pages.set('https://them.example/note', {
      body: reply(`${padding}<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');

    assert.equal(stored(cms).length, 1, 'a page read only in part is not proof the link is gone');
  });

  for (const status of [401, 403, 408, 429, 451]) {
    it(`keeps an approved one when the source answers ${status}`, async () => {
      const cms = await site();
      pages.set('https://them.example/note', {
        body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
      });
      await sendAndSettle(cms, 'https://them.example/note');
      const first = stored(cms)[0];
      assert.ok(first !== undefined);
      await updateComment(
        { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
        first.id,
        { status: 'approved' },
      );

      pages.set('https://them.example/note', { status, body: 'no' });
      await sendAndSettle(cms, 'https://them.example/note');

      const held = stored(cms);
      assert.equal(held.length, 1, `a ${status} is not the page saying it is gone`);
      assert.equal(held[0]?.status, 'approved');
    });
  }
});

describe('an accepted webmention that has not been checked yet', () => {
  const SOURCE = 'https://them.example/late';
  const linking = (): Page => ({
    body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
  });

  it('is checked by the next process on the same directories without being sent again', async () => {
    const first = await site();
    const hang = gate();
    pages.set(SOURCE, { ...linking(), gate: hang.promise });

    assert.equal((await send(first, { source: SOURCE, target: POST_URL })).status, 202);
    await fetched(SOURCE);

    pages.set(SOURCE, linking());
    const second = await nextProcess(first);
    await second.serve();
    await storedFrom(second, SOURCE);

    pages.set(SOURCE, { status: 503 });
    hang.open();
    await first.webmentions.settled();
    await second.webmentions.settled();

    assert.ok(stored(second).some((one) => one.url === SOURCE));
    assert.deepEqual(await waitingChecks(second), [], 'nothing is left waiting once it is stored');
  });

  it('is forgotten once its check is done', async () => {
    const cms = await site();
    pages.set(SOURCE, linking());

    await sendAndSettle(cms, SOURCE);

    assert.equal(stored(cms).length, 1);
    assert.deepEqual(await waitingChecks(cms), []);
  });

  it('is checked again later when its source could not be read the first time', async () => {
    const cms = await site({ webmentions: { retryDelaysMs: [50, 50] } });
    pages.set(SOURCE, { status: 503 });

    await sendAndSettle(cms, SOURCE);
    assert.deepEqual(stored(cms), []);
    assert.equal((await waitingChecks(cms)).length, 1, 'it waits for another try');

    pages.set(SOURCE, linking());
    await storedFrom(cms, SOURCE);
    await cms.webmentions.settled();
    assert.deepEqual(await waitingChecks(cms), []);
  });

  it('is given up on after the last try', async () => {
    const cms = await site({ webmentions: { retryDelaysMs: [20, 20] } });
    pages.set(SOURCE, { status: 503 });

    await sendAndSettle(cms, SOURCE);

    await fetched(SOURCE, 3);
    await cms.webmentions.settled();

    assert.deepEqual(await waitingChecks(cms), [], 'nothing is left to try again');
    assert.equal(requested.filter((url) => url === SOURCE).length, 3);
  });

  it('is filed on the post as the index has it when the check runs', async () => {
    const cms = await site();
    const hang = gate();
    pages.set('https://them.example/first', { ...linking(), gate: hang.promise });
    pages.set(SOURCE, linking());

    await send(cms, { source: 'https://them.example/first', target: POST_URL });
    assert.equal((await send(cms, { source: SOURCE, target: POST_URL })).status, 202);

    await rm(path.join(cms.config.contentDir, 'posts', '2026-09-19-hello-world.md'));
    await cms.sync();
    hang.open();
    await cms.webmentions.settled();

    assert.ok(
      !cms.admin.listCommentsFor('hello-world').some((one) => one.url === SOURCE),
      'a post gone before the check gets nothing from it',
    );
    assert.deepEqual(await waitingChecks(cms), []);
  });
});

describe('checks waiting their turn', () => {
  const SLOW = 'https://slow.example/a';
  const FAST = 'https://fast.example/b';
  const linking = (words = 'Good post.'): Page => ({
    body: reply(
      `<p class="e-content">${words} <a class="u-in-reply-to" href="${POST_URL}">re</a></p>`,
    ),
  });

  it('stores a source that answers at once while another source is still answering', async () => {
    const cms = await site();
    const slow = gate();
    pages.set(SLOW, { ...linking(), gate: slow.promise });
    pages.set(FAST, linking());

    await send(cms, { source: SLOW, target: POST_URL });
    await fetched(SLOW);
    assert.equal((await send(cms, { source: FAST, target: POST_URL })).status, 202);
    await storedFrom(cms, FAST, 3000);

    slow.open();
    await cms.webmentions.settled();
    assert.equal(stored(cms).length, 2);
  });

  it('fetches a source once for twenty sends of the same pair while its check waits for its host', async () => {
    const cms = await site();
    const slow = gate();
    const same = 'https://slow.example/same';
    pages.set(SLOW, { ...linking(), gate: slow.promise });
    pages.set(same, linking());

    await send(cms, { source: SLOW, target: POST_URL });
    await fetched(SLOW);
    for (let n = 0; n < 20; n += 1) {
      assert.equal((await send(cms, { source: same, target: POST_URL })).status, 202);
    }
    assert.equal((await waitingChecks(cms)).length, 2, 'one record for the twenty');

    slow.open();
    await cms.webmentions.settled();
    assert.equal(requested.filter((url) => url === same).length, 1);
    assert.deepEqual(await waitingChecks(cms), []);
  });

  it('reads the source once more after twenty sends that arrive while it is being read', async () => {
    const cms = await site();
    const slow = gate();
    pages.set(SLOW, { ...linking('First words.'), gate: slow.promise });

    await send(cms, { source: SLOW, target: POST_URL });
    await fetched(SLOW);
    pages.set(SLOW, linking('Edited words.'));
    for (let n = 0; n < 20; n += 1) {
      assert.equal((await send(cms, { source: SLOW, target: POST_URL })).status, 202);
    }

    slow.open();
    await cms.webmentions.settled();
    assert.equal(requested.filter((url) => url === SLOW).length, 2);
    assert.match(stored(cms)[0]?.content.html ?? '', /Edited words/);
    assert.deepEqual(await waitingChecks(cms), []);
  });

  it('leaves a source waiting for another try to that try when it is sent again', async () => {
    const cms = await site({ webmentions: { retryDelaysMs: [60_000] } });
    pages.set(SLOW, { status: 503 });

    await sendAndSettle(cms, SLOW);
    assert.equal((await sendAndSettle(cms, SLOW)).status, 202);

    assert.equal(requested.filter((url) => url === SLOW).length, 1);
    assert.equal((await waitingChecks(cms)).length, 1);
  });

  it('answers 503 for a new pair once the waiting checks are full, and still takes a repeat', async () => {
    const cms = await site({ webmentions: { maxWaiting: 2 } });
    const slow = gate();
    pages.set(SLOW, { ...linking(), gate: slow.promise });
    pages.set(FAST, linking());
    pages.set('https://other.example/c', linking());

    await send(cms, { source: SLOW, target: POST_URL });
    await fetched(SLOW);
    await send(cms, { source: 'https://slow.example/next', target: POST_URL });

    const full = await send(cms, { source: FAST, target: POST_URL });
    assert.equal(full.status, 503);
    assert.ok(Number(full.headers.get('retry-after')) > 0, 'it says when to try again');
    assert.equal((await send(cms, { source: SLOW, target: POST_URL })).status, 202);

    slow.open();
    await cms.webmentions.settled();
    assert.equal((await send(cms, { source: FAST, target: POST_URL })).status, 202);
    await cms.webmentions.settled();
    assert.ok(stored(cms).some((one) => one.url === FAST));
  });
});

describe('a source in another character encoding', () => {
  const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

  it('reads it by the charset in its content type', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: latin1(reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`, 'René')),
      contentType: 'text/html; charset=windows-1252',
    });
    await sendAndSettle(cms, 'https://them.example/note');

    assert.equal(stored(cms)[0]?.author.name, 'René');
  });

  it('reads it by a meta charset when the content type names none', async () => {
    const cms = await site();
    const html = reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`, 'René').replace(
      '<head>',
      '<head><meta charset="iso-8859-1">',
    );
    pages.set('https://them.example/note', { body: latin1(html), contentType: 'text/html' });
    await sendAndSettle(cms, 'https://them.example/note');

    assert.equal(stored(cms)[0]?.author.name, 'René');
  });

  it('reads it as UTF-8 when the charset is not one it knows', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`, 'René'),
      contentType: 'text/html; charset=no-such-encoding',
    });
    await sendAndSettle(cms, 'https://them.example/note');

    assert.equal(stored(cms)[0]?.author.name, 'René');
  });
});

describe('an approved webmention that comes again', () => {
  const NOTE = 'https://them.example/note';
  const LOVELY = `<a class="u-in-reply-to" href="${POST_URL}">re</a><div class="e-content"><p>Lovely post.</p></div>`;

  async function approvedReply(cms: Cms, page = reply(LOVELY)): Promise<PostComment> {
    pages.set(NOTE, { body: page });
    await sendAndSettle(cms, NOTE);
    const held = stored(cms)[0];
    assert.ok(held !== undefined);
    return (
      (await updateComment(
        { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
        held.id,
        { status: 'approved' },
      )) ?? held
    );
  }

  it('waits for a moderator again when its words and author have changed', async () => {
    const cms = await site();
    const first = await approvedReply(cms);

    pages.set(NOTE, {
      body: reply(
        `<a class="u-in-reply-to" href="${POST_URL}">re</a>` +
          '<div class="e-content"><p>Buy cheap pills.</p></div>',
      ).replace('Ada Lovelace', 'Spam Bot'),
    });
    await sendAndSettle(cms, NOTE);

    const [after] = stored(cms);
    assert.equal(after?.id, first.id, 'the same entry');
    assert.equal(after?.status, 'pending');
    assert.equal(after?.content.html, '<p>Buy cheap pills.</p>');
    const page = await (await cms.app.request('/2026/09/hello-world/')).text();
    assert.doesNotMatch(page, /Buy cheap pills|Spam Bot/, 'the new version is not on the post');
  });

  it('waits for a moderator again when it now says it is something else', async () => {
    const cms = await site();
    await approvedReply(cms);

    pages.set(NOTE, { body: reply(`<a class="u-like-of" href="${POST_URL}">liked</a>`) });
    await sendAndSettle(cms, NOTE);

    assert.deepEqual(
      stored(cms).map((one) => [one.kind, one.status]),
      [['like', 'pending']],
    );
  });

  it('stays approved when the page says the same thing', async () => {
    const cms = await site();
    await approvedReply(cms);

    await sendAndSettle(cms, NOTE);

    assert.equal(stored(cms)[0]?.status, 'approved');
  });

  it('keeps its first date when the page gives none', async () => {
    let now = new Date('2026-09-20T12:00:00.000Z');
    const cms = await site({ now: () => now });
    const undated = reply(LOVELY).replace(/<time class="dt-published"[^>]*>[^<]*<\/time>/, '');
    const first = await approvedReply(cms, undated);
    assert.equal(first.submitted, '2026-09-20T12:00:00.000Z');

    now = new Date('2026-10-20T12:00:00.000Z');
    await sendAndSettle(cms, NOTE);

    assert.equal(stored(cms)[0]?.submitted, first.submitted);
  });

  it('takes the site’s clock, then keeps it, when the page gives a date far in the future', async () => {
    let now = new Date('2026-09-20T12:00:00.000Z');
    const cms = await site({ now: () => now });
    const future = reply(LOVELY).replace(
      /<time class="dt-published"[^>]*>/,
      '<time class="dt-published" datetime="9999-01-01T00:00:00Z">',
    );
    const first = await approvedReply(cms, future);
    assert.equal(first.submitted, '2026-09-20T12:00:00.000Z');

    now = new Date('2026-10-20T12:00:00.000Z');
    await sendAndSettle(cms, NOTE);

    assert.equal(stored(cms)[0]?.submitted, first.submitted);
  });
});

describe('a webmention sent again to another URL of the same post', () => {
  const LIKE = 'https://them.example/like';

  async function approvedLike(cms: Cms): Promise<PostComment> {
    pages.set(LIKE, { body: reply(`<a class="u-like-of" href="${POST_URL}">liked</a>`) });
    await sendAndSettle(cms, LIKE);
    const like = stored(cms)[0];
    assert.ok(like !== undefined);
    await updateComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      like.id,
      { status: 'approved' },
    );
    return like;
  }

  function assertKept(cms: Cms, like: PostComment): void {
    const held = stored(cms).filter((one) => one.url === LIKE);
    assert.equal(held.length, 1, 'the like is still stored');
    assert.equal(held[0]?.id, like.id);
    assert.equal(held[0]?.status, 'approved');
  }

  it('refuses a target with a query string and keeps the like', async () => {
    const cms = await site();
    const like = await approvedLike(cms);

    const response = await sendAndSettle(cms, LIKE, `${POST_URL}?x=1`);

    assert.equal(response.status, 400);
    assertKept(cms, like);
  });

  it('keeps the like when the target is the post with a fragment', async () => {
    const cms = await site();
    const like = await approvedLike(cms);

    const response = await sendAndSettle(cms, LIKE, `${POST_URL}#elsewhere`);

    assert.equal(response.status, 202);
    assertKept(cms, like);
  });

  async function commentPage(cms: Cms): Promise<string> {
    const note = await addComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      {
        slug: 'hello-world',
        permalink: '/2026/09/hello-world/',
        source: 'comment',
        kind: 'reply',
        status: 'approved',
        author: { name: 'Bob', url: null, email: null, avatar: null },
        content: { markdown: 'Bob says so.', html: '<p>Bob says so.</p>' },
        submitted: '2026-09-19T10:00:00.000Z',
        addressHash: null,
        inReplyTo: null,
        url: null,
        notify: false,
      },
    );
    return `${BASE_URL}/comment/${note.id}/`;
  }

  it('keeps the like when the target is a comment page on the post', async () => {
    const cms = await site();
    const like = await approvedLike(cms);

    const response = await sendAndSettle(cms, LIKE, await commentPage(cms));

    assert.equal(response.status, 202);
    assertKept(cms, like);
  });

  it('keeps a JSON mention sent to a comment page when its escaped URL names the post', async () => {
    const cms = await site();
    const source = 'https://them.example/note.json';
    pages.set(source, {
      body: `{"url":"${POST_URL.replaceAll('/', '\\/')}"}`,
      contentType: 'application/json',
    });
    await sendAndSettle(cms, source);
    assert.equal(stored(cms).length, 1);

    const response = await sendAndSettle(cms, source, await commentPage(cms));

    assert.equal(response.status, 202);
    assert.deepEqual(
      stored(cms).map((one) => one.url),
      [source],
    );
  });

  it('reads a like that also links a comment page as a like whichever is the target', async () => {
    const cms = await site();
    const comment = await commentPage(cms);
    const page = reply(
      `<a class="u-like-of" href="${POST_URL}">liked</a> <a href="${comment}">see Bob</a>`,
    );

    const kinds: string[] = [];
    for (const target of [comment, POST_URL]) {
      pages.set(LIKE, { body: page });
      await sendAndSettle(cms, LIKE, target);
      kinds.push(stored(cms).find((one) => one.url === LIKE)?.kind ?? 'none');
    }

    assert.deepEqual(kinds, ['like', 'like']);
  });

  it('keeps an approved like approved when it is sent again to a comment page it links', async () => {
    const cms = await site();
    const comment = await commentPage(cms);
    pages.set(LIKE, {
      body: reply(
        `<a class="u-like-of" href="${POST_URL}">liked</a> <a href="${comment}">see Bob</a>`,
      ),
    });
    await sendAndSettle(cms, LIKE);
    const like = stored(cms).find((one) => one.url === LIKE);
    assert.ok(like !== undefined);
    await updateComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      like.id,
      { status: 'approved' },
    );

    await sendAndSettle(cms, LIKE, comment);

    assertKept(cms, like);
    assert.equal(stored(cms).find((one) => one.url === LIKE)?.kind, 'like');
  });

  it('keeps the like when the target is a syndicated copy of the post', async () => {
    const cms = await site();
    const copy = 'https://social.example/@me/1';
    await writeFile(
      path.join(cms.config.contentDir, 'posts', '2026-09-19-hello-world.md'),
      POST.replace('---\n\nWords.', `syndication:\n  - ${copy}\n---\n\nWords.`),
      'utf8',
    );
    await cms.sync();
    const like = await approvedLike(cms);

    const response = await sendAndSettle(cms, LIKE, copy);

    assert.equal(response.status, 202);
    assertKept(cms, like);
  });

  it('still deletes the like when its source links to no URL of the post', async () => {
    const cms = await site();
    await approvedLike(cms);

    pages.set(LIKE, { body: reply('<p>Changed my mind.</p>') });
    await sendAndSettle(cms, LIKE, `${POST_URL}#elsewhere`);

    assert.deepEqual(stored(cms), []);
  });
});

describe('a post whose permalink is not plain ASCII', () => {
  const CAFE_URL = `${BASE_URL}/2026/09/caf%C3%A9/`;
  const LIKE = 'https://them.example/like';

  async function cafeSite(): Promise<Cms> {
    const cms = await site();
    await writeFile(
      path.join(cms.config.contentDir, 'posts', '2026-09-19-cafe.md'),
      POST.replace('title: Hello world', 'title: Café').replace(
        'permalink: /2026/09/hello-world/',
        'permalink: /2026/09/café/',
      ),
      'utf8',
    );
    await cms.sync();
    return cms;
  }

  function onCafe(cms: Cms): PostComment[] {
    return cms.admin.listCommentsFor('café').filter((one) => one.source === 'webmention');
  }

  it('takes a webmention sent to the encoded spelling of the permalink', async () => {
    const cms = await cafeSite();
    assert.equal((await cms.app.request('/2026/09/caf%C3%A9/')).status, 200);
    pages.set(LIKE, { body: reply(`<a class="u-like-of" href="${CAFE_URL}">liked</a>`) });

    const response = await sendAndSettle(cms, LIKE, CAFE_URL);

    assert.equal(response.status, 202);
    assert.deepEqual(
      onCafe(cms).map((one) => [one.url, one.kind]),
      [[LIKE, 'like']],
    );
  });

  it('keeps a like sent again to a comment page when it names the post by its encoded URL', async () => {
    const cms = await cafeSite();
    pages.set(LIKE, { body: reply(`<a class="u-like-of" href="${CAFE_URL}">liked</a>`) });
    await sendAndSettle(cms, LIKE, CAFE_URL);
    const records = {
      admin: cms.admin,
      contentDir: cms.config.contentDir,
      dataDir: cms.config.dataDir,
    };
    const note = await addComment(records, {
      slug: 'café',
      permalink: '/2026/09/café/',
      source: 'comment',
      kind: 'reply',
      status: 'approved',
      author: { name: 'Bob', url: null, email: null, avatar: null },
      content: { markdown: 'Bob says so.', html: '<p>Bob says so.</p>' },
      submitted: '2026-09-19T10:00:00.000Z',
      addressHash: null,
      inReplyTo: null,
      url: null,
      notify: false,
    });

    const response = await sendAndSettle(cms, LIKE, `${BASE_URL}/comment/${note.id}/`);

    assert.equal(response.status, 202);
    assert.deepEqual(
      onCafe(cms).map((one) => one.url),
      [LIKE],
    );
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

  it('tells whoever a reply answers once, though it comes back changed and still approved', async () => {
    const cms = await site({
      commentChecker: {
        check(): CommentVerdict {
          return 'ham';
        },
      },
    });
    const approved: PostComment[] = [];
    cms.notifications.replyApproved = (reply) => {
      approved.push(reply);
    };
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a><p class="e-content">Hi.</p>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');
    assert.equal(stored(cms)[0]?.status, 'approved');

    pages.set('https://them.example/note', {
      body: reply(
        `<a class="u-in-reply-to" href="${POST_URL}">re</a><p class="e-content">Bye.</p>`,
      ),
    });
    await sendAndSettle(cms, 'https://them.example/note');

    assert.equal(stored(cms)[0]?.status, 'approved');
    assert.equal(stored(cms)[0]?.content.html.includes('Bye.'), true);
    assert.equal(approved.length, 1);
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

describe('an author link that is not a web address', () => {
  function records(cms: Cms) {
    return { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir };
  }

  it('is not stored, and the approved webmention links nowhere it does not go', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(
        `<a class="u-in-reply-to" href="${POST_URL}">re</a>` +
          '<div class="e-content"><p>Good post.</p></div>',
      )
        .replace('href="https://them.example/"', 'href="javascript:alert(document.domain)"')
        .replace('src="/me.jpg"', 'src="data:image/svg+xml,%3Csvg%2F%3E"'),
    });
    await sendAndSettle(cms, 'https://them.example/note');

    const held = stored(cms)[0];
    assert.ok(held !== undefined);
    assert.equal(held.author.url, null);
    assert.equal(held.author.avatar, null);
    const file = await readFile(commentsFile(cms.config.contentDir, 'hello-world'), 'utf8');
    assert.doesNotMatch(file, /javascript:|data:image/);

    await updateComment(records(cms), held.id, { status: 'approved' });
    const page = await (await cms.app.request('/2026/09/hello-world/')).text();
    assert.match(page, /Good post\./);
    assert.doesNotMatch(page, /href="javascript:/);
  });

  it('keeps an http author link and photo', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');

    assert.equal(stored(cms)[0]?.author.url, 'https://them.example/');
    assert.equal(stored(cms)[0]?.author.avatar, 'https://them.example/me.jpg');
  });

  it('in a comment file already on disk is linked from no page', async () => {
    const cms = await site();
    const author = { name: 'Mallory', url: 'javascript:alert(1)', avatar: 'javascript:alert(2)' };
    const file = commentsFile(cms.config.contentDir, 'hello-world');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({
        post: '/2026/09/hello-world/',
        comments: [
          {
            id: '0000000000000001',
            source: 'webmention',
            kind: 'reply',
            status: 'approved',
            author,
            content: { markdown: 'Mallory says hi.', html: '<p>Mallory says hi.</p>' },
            submitted: '2026-09-20T09:00:00.000Z',
            url: 'https://mallory.example/reply',
          },
          {
            id: '0000000000000002',
            source: 'webmention',
            kind: 'like',
            status: 'approved',
            author,
            content: { markdown: '', html: '' },
            submitted: '2026-09-20T09:00:00.000Z',
            url: null,
          },
        ],
      })}\n`,
    );
    rebuildCommentIndexes(records(cms));

    const page = await (await cms.app.request('/2026/09/hello-world/')).text();
    assert.match(page, /Mallory says hi\./);
    assert.doesNotMatch(page, /javascript:/);
    const markdown = await (await cms.app.request('/2026/09/hello-world/index.md')).text();
    assert.match(markdown, /Mallory/);
    assert.doesNotMatch(markdown, /javascript:/);
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
    writeUsers(cms.config.dataDir, [{ username: 'ada', email: 'ada@example.com' }]);
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
    await cms.notifications.settled();
    await cms.mail.settled();

    assert.equal(provider.sent.length, 1);
    assert.match(provider.sent[0]?.text ?? '', /https:\/\/them\.example\/note/);
    assert.match(provider.sent[0]?.subject ?? '', /Hello world/);
  });

  it('links no author address that is not a web address', async () => {
    const { cms, provider } = await siteWithMail();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`).replace(
        'href="https://them.example/"',
        'href="javascript:alert(1)"',
      ),
    });

    await sendAndSettle(cms, 'https://them.example/note');
    await cms.notifications.settled();
    await cms.mail.settled();

    assert.equal(provider.sent.length, 1);
    assert.doesNotMatch(provider.sent[0]?.html ?? '', /javascript:/);
    assert.doesNotMatch(provider.sent[0]?.text ?? '', /javascript:/);
  });

  it('emails them again when an approved one comes back saying something else', async () => {
    const { cms, provider } = await siteWithMail();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a><p class="e-content">Hi.</p>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');
    const [held] = stored(cms);
    assert.ok(held !== undefined);
    await updateComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      held.id,
      { status: 'approved' },
    );
    await cms.notifications.settled();
    await cms.mail.settled();
    provider.clear();

    pages.set('https://them.example/note', {
      body: reply(
        `<a class="u-in-reply-to" href="${POST_URL}">re</a><p class="e-content">Bye.</p>`,
      ),
    });
    await sendAndSettle(cms, 'https://them.example/note');
    await cms.notifications.settled();
    await cms.mail.settled();

    assert.equal(provider.sent.length, 1);
    assert.match(provider.sent[0]?.text ?? '', /Bye\./);
  });

  it('says nothing the second time the same page sends one', async () => {
    const { cms, provider } = await siteWithMail();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });
    await sendAndSettle(cms, 'https://them.example/note');
    await cms.notifications.settled();
    await cms.mail.settled();
    provider.clear();

    await sendAndSettle(cms, 'https://them.example/note');
    await cms.notifications.settled();
    await cms.mail.settled();

    assert.equal(provider.sent.length, 0, 'an edited page re-sending is not new news');
  });
});

describe('a webmention that answers a reply on the post (TASK-319)', () => {
  const NOTE = 'https://remote.example/notes/1';
  const NOTE_URL = 'https://remote.example/@ada/1';

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
    return `${BASE_URL}/comment/${id}/`;
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
    const page = await (await cms.app.request(`/comment/${parent.id}/`)).text();
    assert.match(page, /An answer\./, 'and once approved it is under that comment on its page');
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

  it('threads under an approved plain mention its source answers', async () => {
    const cms = await site();
    pages.set('https://dan.example/2', {
      body: reply(`<div class="e-content"><p>See <a href="${POST_URL}">this</a>.</p></div>`),
    });
    await sendAndSettle(cms, 'https://dan.example/2');
    const mention = stored(cms)[0];
    assert.equal(mention?.kind, 'mention');
    const { updateComment } = await import('../comments/records.ts');
    await updateComment(records(cms), mention?.id ?? '', { status: 'approved' });

    pages.set('https://eli.example/3', {
      body: reply(
        '<a class="u-in-reply-to" href="https://dan.example/2">re</a>' +
          `<div class="e-content"><p>Eli answers <a href="${POST_URL}">Dan</a>.</p></div>`,
      ),
    });
    await sendAndSettle(cms, 'https://eli.example/3');

    const eli = stored(cms).find((one) => one.url === 'https://eli.example/3');
    assert.equal(eli?.inReplyTo, mention?.id);
    assert.equal(eli?.kind, 'reply');
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

describe('what the endpoint answers, word for word', () => {
  it('accepts a webmention worth checking with a 202 that says so', async () => {
    const cms = await site();
    pages.set('https://them.example/note', {
      body: reply(`<a class="u-in-reply-to" href="${POST_URL}">re</a>`),
    });

    const response = await sendAndSettle(cms, 'https://them.example/note');

    assert.equal(response.status, 202);
    assert.match(response.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(await response.text(), 'Accepted. The source will be checked shortly.');
  });

  it('refuses a malformed one with the reason the check gave', async () => {
    const cms = await site();

    const response = await send(cms, { target: POST_URL });

    assert.equal(response.status, 400);
    assert.equal(await response.text(), 'A webmention needs a source.');
  });

  it('has no endpoint on a site that takes no webmentions', async () => {
    const cms = await site({}, { webmentionsReceive: false });

    const response = await send(cms, { source: 'https://them.example/x', target: POST_URL });

    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'This site does not take webmentions.');
  });

  it('answers a GET with a 405 naming the method it takes', async () => {
    const cms = await site();

    const response = await cms.app.request(WEBMENTION_PATH);

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.equal(
      await response.text(),
      'Send a webmention here with a POST carrying source and target.',
    );
  });
});

describe('a source that answers many things', () => {
  const openStores: AdminStore[] = [];
  after(() => {
    for (const opened of openStores) opened.close();
  });

  it('asks the conversation about a few of them, not every one', async () => {
    const source = 'https://them.example/2026/09/reply/';
    const values = 2_000;
    const links = Array.from(
      { length: values },
      (_, i) => `<a class="u-in-reply-to" href="https://elsewhere.example/${i}">${i}</a>`,
    ).join('');
    pages.set(source, {
      body: `<article class="h-entry">
        <a class="u-in-reply-to" href="${POST_URL}">the post</a>${links}
        <p class="e-content">Hello.</p>
      </article>`,
    });
    const dataDir = await temporaryDir('geekity-webmention-answers-');
    const contentDir = await temporaryDir('geekity-webmention-answers-content-');
    const admin = openAdminStore({ dataDir });
    openStores.push(admin);
    let asked = 0;

    const outcome = await verifyWebmention({
      incoming: {
        source,
        target: POST_URL,
        document: {
          slug: 'hello-world',
          permalink: '/2026/09/hello-world/',
          title: 'Hello world',
          html: '<p>Words.</p>',
        } as unknown as Document,
      },
      records: { admin, contentDir, dataDir },
      dataDir,
      baseUrl: BASE_URL,
      conversation: {
        replyNamed: () => {
          asked += 1;
          return undefined;
        },
        comment: () => undefined,
      },
      site: {} as ConversationSite,
      now: NOW,
      lookup,
      logger: { warn: () => {} },
    });

    assert.equal(outcome.kind, 'stored');
    assert.ok(asked <= 10, `asked about ${asked} of ${values + 1} values`);
  });
});
