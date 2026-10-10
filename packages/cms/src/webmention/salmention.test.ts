import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { resolveNothing } from '../admin/__testing__/harness.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { PostComment } from '../admin/store.ts';
import { addComment, rebuildCommentIndexes, updateComment } from '../comments/records.ts';
import type { NewComment } from '../comments/records.ts';
import { seedActorKeys } from '../federation/__testing__/keys.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import type { CommentChecker } from '../comments/submission.ts';
import { sourceEntry } from './microformats.ts';
import { WEBMENTION_PATH } from './routes.ts';
import { SALMENTION_LIMIT } from './service.ts';

/**
 * Salmention (TASK-320), both halves, against a make-believe web: a source
 * page sent again brings the replies nested in its h-entry into the thread,
 * and a reply post of this site's tells what it answers when the replies under
 * it change.
 */

const BASE_URL = 'https://blog.example';
const POST_URL = `${BASE_URL}/2026/09/hello-world/`;
const NOW = new Date('2026-09-20T12:00:00.000Z');

const POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

/** A remote post this site's reply post answers, and its endpoint. */
const UPSTREAM = 'https://them.example/2026/09/upstream/';
const UPSTREAM_ENDPOINT = 'https://them.example/webmention';

const REPLY_POST = `---
title: ''
date: '2026-09-19T11:00:00Z'
permalink: /2026/09/re-upstream/
in-reply-to: ${UPSTREAM}
---

Answering them.
`;
const REPLY_POST_URL = `${BASE_URL}/2026/09/re-upstream/`;

const SOURCE = 'https://ada.example/2026/09/reply/';

interface Page {
  status?: number;
  body?: string;
}

const pages = new Map<string, Page>();
/** The site the upstream page sends its own webmention back to, as a salmention site would. */
let echoTo: Cms | undefined;
const sent: { source: string; target: string }[] = [];
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
  sent.length = 0;
  echoTo = undefined;
});

function routeTheWeb(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === 'POST') {
      if (request.url !== UPSTREAM_ENDPOINT) return new Response('missing', { status: 404 });
      const body = new URLSearchParams(await request.text());
      sent.push({ source: body.get('source') ?? '', target: body.get('target') ?? '' });
      const echo = echoTo;
      if (echo !== undefined) {
        setImmediate(() => {
          void echo.app.request(WEBMENTION_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ source: UPSTREAM, target: REPLY_POST_URL }).toString(),
          });
        });
      }
      return new Response('', { status: 202 });
    }
    if (request.url === UPSTREAM) {
      const response = html(
        `<link rel="webmention" href="${UPSTREAM_ENDPOINT}">${pages.get(UPSTREAM)?.body ?? '<p>Upstream.</p>'}`,
      );
      Object.defineProperty(response, 'url', { value: UPSTREAM });
      return response;
    }
    const page = pages.get(request.url);
    if (page === undefined) return new Response('missing', { status: 404 });
    const response = html(page.body ?? '', page.status ?? 200);
    Object.defineProperty(response, 'url', { value: request.url });
    return response;
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

async function site(
  options: { webmentionsSend?: boolean; checker?: CommentChecker; migrated?: boolean } = {},
): Promise<Cms> {
  const contentDir = await temporaryDir('geekity-salmention-content-');
  const dataDir = await temporaryDir('geekity-salmention-data-');
  seedActorKeys(dataDir, 'admin');

  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(path.join(contentDir, 'posts', '2026-09-19-hello-world.md'), POST, 'utf8');
  await writeFile(
    path.join(contentDir, 'posts', '2026-09-19-re-upstream.md'),
    options.migrated === true ? REPLY_POST.replace('---\n', '---\nmigrated: true\n') : REPLY_POST,
    'utf8',
  );
  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      baseUrl: BASE_URL,
      notifyServer: '',
      webmentionsSend: options.webmentionsSend ?? false,
      webmentionsReceive: true,
    },
  });

  const instance = createCms({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    hostLookup: resolveNothing,
    ...(options.checker === undefined ? {} : { commentChecker: options.checker }),
  });
  started.push(instance);
  await instance.sync();
  return instance;
}

async function sendAndSettle(cms: Cms, source: string, target = POST_URL): Promise<void> {
  const response = await cms.app.request(WEBMENTION_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ source, target }).toString(),
  });
  assert.equal(response.status, 202);
  await cms.webmentions.settled();
}

function records(cms: Cms) {
  return { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir };
}

function held(cms: Cms, slug = 'hello-world'): PostComment[] {
  return cms.admin.listCommentsFor(slug);
}

function byUrl(cms: Cms, url: string): PostComment | undefined {
  return held(cms).find((one) => one.url === url);
}

async function approveAll(cms: Cms, slug = 'hello-world'): Promise<void> {
  for (const one of held(cms, slug)) {
    await updateComment(records(cms), one.id, { status: 'approved' });
  }
}

/** A nested reply as a salmention source prints it inside its entry. */
function cite(url: string, name: string, words: string, inside = ''): string {
  return `<div class="p-comment h-cite">
    <a class="p-author h-card" href="https://${name.toLowerCase()}.example/">${name}</a>
    <a class="u-url" href="${url}"><time class="dt-published" datetime="2026-09-20T10:00:00Z">then</time></a>
    <div class="e-content"><p>${words}</p></div>
    ${inside}
  </div>`;
}

/** A source page answering the post, carrying these nested replies. */
function source(...nested: string[]): string {
  return `<html><body><article class="h-entry">
    <a class="p-author h-card" href="https://ada.example/">Ada</a>
    <a class="u-url" href="${SOURCE}">permalink</a>
    <a class="u-in-reply-to" href="${POST_URL}">re</a>
    <div class="e-content"><p>Ada replies.</p></div>
    ${nested.join('')}
  </article></body></html>`;
}

const CAROL = 'https://carol.example/1';
const DAN = 'https://dan.example/2';

describe('receiving a salmention (TASK-320)', () => {
  it('updates the source it already holds rather than adding a second (AC #2)', async () => {
    const cms = await site();
    pages.set(SOURCE, { body: source() });
    await sendAndSettle(cms, SOURCE);
    const first = byUrl(cms, SOURCE);

    pages.set(SOURCE, { body: source(cite(CAROL, 'Carol', 'Carol answers.')) });
    await sendAndSettle(cms, SOURCE);

    assert.equal(held(cms).filter((one) => one.url === SOURCE).length, 1);
    assert.equal(byUrl(cms, SOURCE)?.id, first?.id, 'the same comment');
  });

  it('threads the replies nested in the source under it, and drops them when the source does (AC #3)', async () => {
    const cms = await site();
    pages.set(SOURCE, {
      body: source(cite(CAROL, 'Carol', 'Carol answers.', cite(DAN, 'Dan', 'Dan answers Carol.'))),
    });
    await sendAndSettle(cms, SOURCE);

    const ada = byUrl(cms, SOURCE);
    const carol = byUrl(cms, CAROL);
    const dan = byUrl(cms, DAN);
    assert.ok(ada !== undefined && carol !== undefined && dan !== undefined);
    assert.equal(carol.source, 'webmention');
    assert.equal(carol.kind, 'reply');
    assert.equal(carol.status, 'pending', 'held for a moderator as any webmention is');
    assert.equal(carol.inReplyTo, ada.id, 'under the source that carried it');
    assert.equal(carol.via, SOURCE, 'naming the page that carried it');
    assert.equal(carol.author.name, 'Carol');
    assert.equal(dan.inReplyTo, carol.id, 'and a reply to it under it');
    rebuildCommentIndexes(records(cms));
    assert.equal(byUrl(cms, CAROL)?.via, SOURCE, 'which the comment file keeps through a rebuild');

    await approveAll(cms);
    const page = await (await cms.app.request('/2026/09/hello-world/')).text();
    assert.match(page, /Carol answers\./);
    assert.match(page, /Dan answers Carol\./);
    assert.match(page, new RegExp(`href="${CAROL}"`), 'with its own URL');

    pages.set(SOURCE, { body: source(cite(CAROL, 'Carol', 'Carol answers again.')) });
    await sendAndSettle(cms, SOURCE);
    assert.equal(byUrl(cms, DAN), undefined, 'one the source no longer carries is gone');
    assert.equal(byUrl(cms, CAROL)?.content.html, '<p>Carol answers again.</p>');
    assert.equal(byUrl(cms, CAROL)?.status, 'approved', 'the moderator’s decision stands');

    pages.set(SOURCE, { status: 410 });
    await sendAndSettle(cms, SOURCE);
    assert.deepEqual(held(cms), [], 'and the source going takes what it carried with it');
  });

  it('leaves out a nested reply that is one of this site’s own, or already held on its own (AC #4)', async () => {
    const cms = await site();
    const native = await addComment(records(cms), nativeComment());
    const ownPage = `${BASE_URL}/comment/${native.id}/`;
    pages.set(DAN, {
      body: `<article class="h-entry"><a class="u-in-reply-to" href="${POST_URL}">re</a>
        <div class="e-content"><p>Dan on his own.</p></div></article>`,
    });
    await sendAndSettle(cms, DAN);
    const direct = byUrl(cms, DAN);
    await updateComment(records(cms), direct?.id ?? '', { status: 'approved' });

    pages.set(SOURCE, {
      body: source(
        cite(ownPage, 'Bob', 'Bob says so.'),
        cite(REPLY_POST_URL, 'Me', 'Answering them.'),
        cite(DAN, 'Dan', 'Dan as Ada quotes him.', cite(CAROL, 'Carol', 'Carol answers Dan.')),
      ),
    });
    await sendAndSettle(cms, SOURCE);

    assert.equal(held(cms).length, 4, 'the native comment, Dan, Ada and Carol');
    assert.equal(byUrl(cms, ownPage), undefined, 'this site’s own comment is not copied');
    assert.equal(byUrl(cms, REPLY_POST_URL), undefined, 'nor is its own reply post');
    const dan = byUrl(cms, DAN);
    assert.equal(dan?.id, direct?.id, 'Dan is the one held from his own webmention');
    assert.equal(dan?.via, undefined);
    assert.equal(dan?.content.html, '<p>Dan on his own.</p>', 'and keeps his own words');
    assert.equal(
      byUrl(cms, CAROL)?.inReplyTo,
      dan?.id,
      'a reply nested under him threads under him',
    );

    pages.set(SOURCE, { status: 410 });
    await sendAndSettle(cms, SOURCE);
    assert.ok(byUrl(cms, DAN) !== undefined, 'what the source did not bring, it does not take');
  });

  it('hands a nested reply over to its own webmention when that page sends one', async () => {
    const cms = await site();
    pages.set(SOURCE, { body: source(cite(CAROL, 'Carol', 'Carol answers.')) });
    await sendAndSettle(cms, SOURCE);
    const nested = byUrl(cms, CAROL);

    pages.set(CAROL, {
      body: `<article class="h-entry"><a class="u-in-reply-to" href="${SOURCE}">re</a>
        <a class="u-in-reply-to" href="${POST_URL}">re</a>
        <div class="e-content"><p>Carol on her own.</p></div></article>`,
    });
    await sendAndSettle(cms, CAROL);

    const carol = held(cms).filter((one) => one.url === CAROL);
    assert.equal(carol.length, 1, 'still one Carol');
    assert.equal(carol[0]?.id, nested?.id);
    assert.equal(carol[0]?.via, undefined, 'held from her own page now');

    pages.set(SOURCE, { body: source() });
    await sendAndSettle(cms, SOURCE);
    assert.ok(byUrl(cms, CAROL) !== undefined, 'so the source dropping her does not delete her');
  });
});

function nativeComment(values: Partial<NewComment> = {}): NewComment {
  return {
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
    ...values,
  };
}

/** Wait until neither half of the service has anything left to do. */
async function quiet(cms: Cms): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await cms.webmentions.settled();
  }
}

const TO_UPSTREAM = { source: REPLY_POST_URL, target: UPSTREAM };

describe('sending a salmention (TASK-320)', () => {
  const onReplyPost = (values: Partial<NewComment> = {}): NewComment =>
    nativeComment({ slug: 're-upstream', permalink: '/2026/09/re-upstream/', ...values });

  it('re-sends a reply post’s webmention when a reply under it comes, changes or goes (AC #1)', async () => {
    const cms = await site({ webmentionsSend: true });
    await quiet(cms);
    assert.deepEqual(sent, [], 'a boot is not news');

    const reply = await addComment(records(cms), onReplyPost());
    await quiet(cms);
    assert.deepEqual(sent, [TO_UPSTREAM], 'a reply came');

    const page = await (await cms.app.request('/2026/09/re-upstream/')).text();
    const carried = sourceEntry(page, REPLY_POST_URL, UPSTREAM).replies;
    assert.deepEqual(
      carried.map((one) => one.url),
      [`${BASE_URL}/comment/${reply.id}/`],
      'and its page carries the reply inside its h-entry, as a receiver reads it',
    );

    await updateComment(records(cms), reply.id, { status: 'approved' });
    await quiet(cms);
    assert.equal(sent.length, 1, 'nothing a reader sees changed, so nothing is sent');

    await updateComment(records(cms), reply.id, {
      content: { markdown: 'Bob thinks again.', html: '<p>Bob thinks again.</p>' },
    });
    await quiet(cms);
    assert.equal(sent.length, 2, 'it changed');

    await updateComment(records(cms), reply.id, { status: 'spam' });
    await quiet(cms);
    assert.deepEqual(sent.at(-1), TO_UPSTREAM);
    assert.equal(sent.length, 3, 'it went');
  });

  it('re-sends from a comment’s page to the webmention reply it answers', async () => {
    const cms = await site({ webmentionsSend: true });
    const webmention = await addComment(
      records(cms),
      nativeComment({ source: 'webmention', url: UPSTREAM }),
    );
    const native = await addComment(records(cms), nativeComment({ inReplyTo: webmention.id }));
    await quiet(cms);
    assert.deepEqual(sent, [], 'a comment with no replies under it has nothing to tell');

    await addComment(records(cms), nativeComment({ inReplyTo: native.id }));
    await quiet(cms);
    assert.deepEqual(sent, [{ source: `${BASE_URL}/comment/${native.id}/`, target: UPSTREAM }]);
  });

  it('starts a post brought over from another site at the replies it arrived with', async () => {
    const cms = await site({ webmentionsSend: true, migrated: true });
    await addComment(records(cms), onReplyPost());
    await quiet(cms);
    assert.deepEqual(sent, [], 'what it arrived with is not news');

    await addComment(records(cms), onReplyPost({ submitted: '2026-09-20T11:00:00.000Z' }));
    await quiet(cms);
    assert.deepEqual(sent, [TO_UPSTREAM], 'a reply after that is');
  });

  it('sends nothing when the setting is off', async () => {
    const cms = await site({ webmentionsSend: false });
    await addComment(records(cms), onReplyPost());
    await quiet(cms);
    assert.deepEqual(sent, []);
  });

  it('stops when two salmention sites answer each other (AC #5)', async () => {
    const cms = await site({
      webmentionsSend: true,
      checker: { check: () => Promise.resolve('ham') },
    });
    echoTo = cms;
    const reply = await addComment(records(cms), onReplyPost());
    // The upstream page answers this site's reply post in turn, shows it with
    // the reply under it, and sends its webmention back each time it is told.
    pages.set(UPSTREAM, {
      body: `<article class="h-entry"><a class="u-url" href="${UPSTREAM}">up</a>
        <a class="u-in-reply-to" href="${REPLY_POST_URL}">answering it back</a>
        ${cite(REPLY_POST_URL, 'Me', 'Answering them.', cite(`${BASE_URL}/comment/${reply.id}/`, 'Bob', 'Bob says so.'))}
        <div class="e-content"><p>Upstream.</p></div></article>`,
    });
    await quiet(cms);

    assert.equal(
      sent.length,
      2,
      'once for the reply, once for the upstream page’s answer appearing under it',
    );
    assert.equal(
      cms.admin.listCommentsFor('re-upstream').length,
      2,
      'and nothing of its own was copied back',
    );
  });

  it('sends no more than a few times an hour, however often the replies change (AC #5)', async () => {
    const cms = await site({ webmentionsSend: true });
    const reply = await addComment(records(cms), onReplyPost());
    for (let edit = 0; edit < SALMENTION_LIMIT * 2; edit += 1) {
      await updateComment(records(cms), reply.id, {
        content: { markdown: `Edit ${String(edit)}`, html: `<p>Edit ${String(edit)}</p>` },
      });
      await quiet(cms);
    }
    assert.equal(sent.length, SALMENTION_LIMIT);
  });
});
