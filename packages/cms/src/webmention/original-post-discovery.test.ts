import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { csrfField, FIRST_ADMIN, signedIn } from '../admin/__testing__/harness.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import { updateComment } from '../comments/records.ts';
import { seedActorKeys } from '../federation/__testing__/keys.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from './public-address.ts';
import { fetchReplyContext } from './reply-context.ts';
import type { FediverseLookup } from './reply-context.ts';
import { WEBMENTION_PATH } from './routes.ts';

/**
 * Original-post-discovery (TASK-197): a reply to a silo copy of a post answers
 * the IndieWeb original the copy links to, and a response to one of this
 * site's own copies lands on the post it is a copy of. Every host below is
 * make-believe; nothing leaves the process.
 */

const BASE_URL = 'https://blog.example';

/** A silo's copy of somebody's post, whose h-entry names the original as its `u-url`. */
const SILO = 'https://silo.example/@them/1001';
/** The original, which lists the copy as its `u-syndication`. */
const ORIGINAL = 'https://them.example/2026/10/beans/';
const ORIGINAL_ENDPOINT = 'https://them.example/webmention';

/** A copy whose original never claims it back. */
const CLAIMING = 'https://silo.example/@liar/7';

/** This site's own copy of its post, on a silo. */
const OWN_COPY = 'https://silo.example/@me/42';
/** A copy a syndication target answered with, kept in the copies file. */
const TARGET_COPY = 'https://news.example/en/blog.example/2026/09/hello-world';

const publicLookup: HostLookup = () => Promise.resolve(['203.0.113.9']);

function siloPage(original: string, words: string): string {
  return `<!doctype html><title>them on silo</title>
    <link rel="canonical" href="${SILO}">
    <article class="h-entry">
      <a class="u-url" href="${original}">permalink</a>
      <span class="p-author h-card">them</span>
      <div class="e-content"><p>${words}</p></div>
    </article>`;
}

function originalPage(syndication: readonly string[]): string {
  return `<!doctype html><title>Beans | them</title>
    <link rel="webmention" href="${ORIGINAL_ENDPOINT}">
    <article class="h-entry">
      <h1 class="p-name">Growing beans</h1>
      <a class="p-author h-card" href="https://them.example/">Them Person</a>
      <div class="e-content"><p>Beans climb poles.</p></div>
      ${syndication.map((url) => `<a class="u-syndication" href="${url}">copy</a>`).join('')}
    </article>`;
}

let pages: Record<string, string> = {};
const fetched: string[] = [];
const sent: { source: string; target: string; linked: boolean }[] = [];
let verifyingAgainst: Cms | undefined;

const original = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  fetched.push(request.url);
  if (request.method === 'POST' && request.url === ORIGINAL_ENDPOINT) {
    const body = new URLSearchParams(await request.text());
    const source = body.get('source') ?? '';
    const target = body.get('target') ?? '';
    const page =
      verifyingAgainst === undefined
        ? ''
        : await (await verifyingAgainst.app.request(new Request(source))).text();
    sent.push({ source, target, linked: page.includes(`href="${target}"`) });
    return new Response('', { status: 202 });
  }
  const page = pages[request.url];
  if (page === undefined) return new Response('missing', { status: 404 });
  const response = new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  Object.defineProperty(response, 'url', { value: request.url });
  return response;
}) as typeof fetch;

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  globalThis.fetch = original;
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  pages = {};
  fetched.length = 0;
  sent.length = 0;
  verifyingAgainst = undefined;
});

describe('discovering the original a cited copy links to', () => {
  it('describes the original, confirmed by its u-syndication back to the copy', async () => {
    pages = { [SILO]: siloPage(ORIGINAL, 'Beans climb poles.'), [ORIGINAL]: originalPage([SILO]) };

    const found = await fetchReplyContext(SILO, { lookup: publicLookup });

    assert.ok(found.ok);
    assert.equal(found.context.url, SILO, 'the context stays keyed by what the post cites');
    assert.equal(found.context.original, ORIGINAL);
    assert.equal(found.context.name, 'Growing beans', 'the original’s title, not the copy’s');
    assert.deepEqual(found.context.author, { name: 'Them Person', url: 'https://them.example/' });
  });

  it('follows a rel=canonical on another host as it follows a u-url', async () => {
    pages = {
      [SILO]: `<!doctype html><title>copy</title><link rel="canonical" href="${ORIGINAL}"><p>Beans.</p>`,
      [ORIGINAL]: originalPage([SILO]),
    };

    const found = await fetchReplyContext(SILO, { lookup: publicLookup });

    assert.ok(found.ok);
    assert.equal(found.context.original, ORIGINAL);
  });

  it('follows the url of the ActivityPub object the copy names', async () => {
    const object = 'https://silo.example/users/them/statuses/1001';
    pages = {
      [SILO]: `<!doctype html><title>copy</title><link rel="alternate" type="application/activity+json" href="${object}">`,
      [ORIGINAL]: originalPage([SILO]),
    };
    const fediverse: FediverseLookup = (url) =>
      Promise.resolve(
        url === object ? { html: '<p>Beans climb poles.</p>', url: ORIGINAL } : undefined,
      );

    const found = await fetchReplyContext(SILO, { lookup: publicLookup, fediverse });

    assert.ok(found.ok);
    assert.equal(found.context.original, ORIGINAL);
    assert.equal(found.context.name, 'Growing beans');
  });

  it('keeps the copy when the page it names does not list it back', async () => {
    pages = {
      [CLAIMING]: siloPage(ORIGINAL, 'Not really theirs.'),
      [ORIGINAL]: originalPage([SILO]),
    };

    const found = await fetchReplyContext(CLAIMING, { lookup: publicLookup });

    assert.ok(found.ok);
    assert.equal(found.context.original, undefined, 'a copy cannot claim somebody else’s post');
    assert.equal(found.context.text, 'Not really theirs.', 'it is described as itself');
  });

  it('asks nothing more of a page whose u-url and canonical are on its own host', async () => {
    const own = 'https://them.example/2026/10/own/';
    pages = {
      [own]: `<!doctype html><link rel="canonical" href="${own}">
        <article class="h-entry"><a class="u-url" href="${own}#entry">#</a>
        <div class="e-content"><p>Just a post.</p></div></article>`,
    };

    const found = await fetchReplyContext(own, { lookup: publicLookup });

    assert.ok(found.ok);
    assert.equal(found.context.original, undefined);
    assert.deepEqual(fetched, [own], 'one fetch, the page itself');
  });
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

async function site(files: Record<string, string> = {}): Promise<Cms> {
  const dataDir = await temporaryDir('geekity-opd-data-');
  const contentDir = await temporaryDir('geekity-opd-content-');
  seedActorKeys(dataDir, FIRST_ADMIN.username);
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source, 'utf8');
  }
  await writeSiteJson({
    contentDir,
    settings: { ...DEFAULT_SITE_SETTINGS, baseUrl: BASE_URL, notifyServer: '' },
  });
  const cms = createCms({
    dataDir,
    contentDir,
    port: 0,
    watch: false,
    baseUrl: BASE_URL,
    hostLookup: publicLookup,
  });
  started.push(cms);
  await cms.sync();
  return cms;
}

async function publishReply(cms: Cms, inReplyTo: string): Promise<void> {
  const agent = await signedIn(cms);
  const html = await (await agent.get('/admin/posts/new')).text();
  const token = csrfField(html);
  assert.ok(token !== undefined);
  const response = await agent.post('/admin/posts/new', {
    csrf_token: token,
    title: 'Re beans',
    slug: 're-beans',
    permalink: '',
    date: '2026-10-04T09:00:00.000Z',
    tags: '',
    categories: '',
    description: '',
    body: 'Mine climb too.',
    hash: '',
    action: 'publish',
    'in-reply-to': inReplyTo,
  });
  assert.equal(response.status, 303, 'the reply was published');
  await cms.replyContexts.settled();
  await cms.webmentions.settled();
}

async function postFile(cms: Cms): Promise<string> {
  const dir = path.join(cms.config.contentDir, 'posts');
  const [name] = (await readdir(dir)).filter((file) => file.includes('re-beans'));
  assert.ok(name !== undefined);
  return await readFile(path.join(dir, name), 'utf8');
}

describe('replying to a silo copy that links to its original (TASK-197)', () => {
  it('sends the webmention to the original, from a page that links it', async () => {
    pages = { [SILO]: siloPage(ORIGINAL, 'Beans climb poles.'), [ORIGINAL]: originalPage([SILO]) };
    const cms = await site();
    verifyingAgainst = cms;

    await publishReply(cms, SILO);

    assert.deepEqual(sent, [
      { source: `${BASE_URL}/2026/10/re-beans/`, target: ORIGINAL, linked: true },
    ]);
  });

  it('shows the original in the reply context and keeps the copy as an in-reply-to', async () => {
    pages = { [SILO]: siloPage(ORIGINAL, 'Beans climb poles.'), [ORIGINAL]: originalPage([SILO]) };
    const cms = await site();

    await publishReply(cms, SILO);
    const page = await (await cms.app.request('/2026/10/re-beans/')).text();

    assert.match(
      page,
      new RegExp(`<a class="u-url p-name" href="${ORIGINAL}">Growing beans</a>`),
      'the citation names and links the original',
    );
    assert.match(
      page,
      new RegExp(`<a class="u-in-reply-to" href="${SILO}">`),
      'the copy is still what the post replies to, so the silo can thread it',
    );
    assert.match(
      await postFile(cms),
      new RegExp(`in-reply-to: '?${SILO}'?`),
      'the file is as written',
    );
  });

  it('tells the original nothing when it does not claim the copy', async () => {
    pages = {
      [CLAIMING]: siloPage(ORIGINAL, 'Not really theirs.'),
      [ORIGINAL]: originalPage([SILO]),
    };
    const cms = await site();

    await publishReply(cms, CLAIMING);

    assert.deepEqual(sent, []);
  });
});

const POST = (extra: string): string => `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
${extra}---

Words.
`;

function replyTo(target: string): string {
  return `<!doctype html><article class="h-entry">
    <a class="p-author h-card" href="https://reader.example/">Reader</a>
    <a class="u-in-reply-to" href="${target}">re</a>
    <div class="e-content"><p>Lovely post.</p></div>
  </article>`;
}

async function receive(cms: Cms, source: string, target: string): Promise<Response> {
  const response = await cms.app.request(WEBMENTION_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ source, target }).toString(),
  });
  await cms.webmentions.settled();
  return response;
}

async function approveAll(cms: Cms): Promise<void> {
  for (const comment of cms.admin.listCommentsFor('hello-world')) {
    await updateComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      comment.id,
      { status: 'approved' },
    );
  }
}

describe('a response to one of this site’s syndicated copies (TASK-197)', () => {
  it('is shown on the original post when the copy is in its front matter', async () => {
    const cms = await site({
      'posts/hello-world.md': POST(`syndication:\n  - ${OWN_COPY}\n`),
    });
    pages = { 'https://reader.example/re/1': replyTo(OWN_COPY) };

    const response = await receive(cms, 'https://reader.example/re/1', OWN_COPY);
    assert.equal(response.status, 202);
    await approveAll(cms);

    const comments = cms.admin.listCommentsFor('hello-world');
    assert.deepEqual(
      comments.map((one) => [one.source, one.kind]),
      [['webmention', 'reply']],
    );
    const page = await (await cms.app.request('/2026/09/hello-world/')).text();
    assert.match(page, /Lovely post\./);
  });

  it('is shown on the original post when a syndication target made the copy', async () => {
    const cms = await site({
      'posts/hello-world.md': POST(''),
      '_data/syndication.json': JSON.stringify({
        '/2026/09/hello-world/': { 'https://news.example/en': TARGET_COPY },
      }),
    });
    pages = { 'https://reader.example/re/2': replyTo(TARGET_COPY) };

    const response = await receive(cms, 'https://reader.example/re/2', TARGET_COPY);
    assert.equal(response.status, 202);
    await approveAll(cms);

    const page = await (await cms.app.request('/2026/09/hello-world/')).text();
    assert.match(page, /Lovely post\./);
  });

  it('still refuses a target elsewhere that is no copy of a post here', async () => {
    const cms = await site({ 'posts/hello-world.md': POST(`syndication:\n  - ${OWN_COPY}\n`) });

    const response = await receive(
      cms,
      'https://reader.example/re/3',
      'https://silo.example/@me/43',
    );

    assert.equal(response.status, 400);
  });
});
