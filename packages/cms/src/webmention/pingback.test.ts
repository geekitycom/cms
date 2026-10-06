import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { PostComment } from '../admin/store.ts';
import { updateComment } from '../comments/records.ts';
import type { CommentVerdict } from '../comments/submission.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { PINGBACK_MAX_BYTES, PINGBACK_PATH } from './pingback.ts';
import { WEBMENTION_PATH } from './routes.ts';

/**
 * Pingbacks as a WordPress site sends them: an XML-RPC `pingback.ping` posted
 * to the endpoint a post advertises, answered there and then with a string or
 * one of the fault codes the Pingback 1.0 spec defines, and filed exactly as
 * the same link sent as a webmention would be.
 */

const BASE_URL = 'https://blog.example';
const ENDPOINT = `${BASE_URL}${PINGBACK_PATH}`;
const POST_URL = `${BASE_URL}/2026/09/hello-world/`;
const OPEN_PAGE_URL = `${BASE_URL}/about/`;
const CLOSED_PAGE_URL = `${BASE_URL}/colophon/`;
const NOW = new Date('2026-09-20T12:00:00.000Z');

const FILES: Record<string, string> = {
  'posts/2026-09-19-hello-world.md': `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`,
  'pages/about.md': `---
title: About
permalink: /about/
comments: true
---

Who this is.
`,
  'pages/colophon.md': `---
title: Colophon
permalink: /colophon/
---

How this is made.
`,
};

interface Page {
  status?: number;
  body?: string;
}

const pages = new Map<string, Page>();
const fetched: string[] = [];
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
  fetched.length = 0;
});

function routeTheWeb(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    const page = pages.get(url);
    const response =
      page === undefined
        ? new Response('missing', { status: 404 })
        : new Response(page.body ?? '', {
            status: page.status ?? 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
    Object.defineProperty(response, 'url', { value: url });
    return Promise.resolve(response);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

async function site(
  config: GeekityConfig = {},
  settings: { webmentionsReceive?: boolean } = {},
): Promise<Cms> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-pingback-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-pingback-data-'));
  temporaryDirs.push(contentDir, dataDir);

  for (const [name, body] of Object.entries(FILES)) {
    const file = path.join(contentDir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, 'utf8');
  }

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

/** A call in the exact envelope WordPress's IXR client writes. */
function call(method: string, ...params: string[]): string {
  const values = params
    .map((param) => `<param><value><string>${param}</string></value></param>\n`)
    .join('');
  return `<?xml version="1.0"?>\n<methodCall>\n<methodName>${method}</methodName>\n<params>\n${values}</params></methodCall>`;
}

async function post(cms: Cms, body: string): Promise<Response> {
  return await cms.app.request(PINGBACK_PATH, {
    method: 'POST',
    headers: { 'content-type': 'text/xml' },
    body,
  });
}

async function ping(cms: Cms, source: string, target = POST_URL): Promise<Response> {
  return await post(cms, call('pingback.ping', source, target));
}

/** The fault code an XML-RPC response carries, or `undefined` for a success. */
async function faultOf(response: Response): Promise<number | undefined> {
  assert.equal(response.status, 200, 'XML-RPC answers every call with a 200');
  assert.match(response.headers.get('content-type') ?? '', /^text\/xml/);
  const text = await response.text();
  assert.match(text, /^<\?xml version="1.0"\?>\s*<methodResponse>/);
  const code = /<name>faultCode<\/name>\s*<value><int>(-?\d+)<\/int><\/value>/.exec(text)?.[1];
  return code === undefined ? undefined : Number(code);
}

function mentionsOf(cms: Cms, slug = 'hello-world'): PostComment[] {
  return cms.admin.listCommentsFor(slug).filter((one) => one.source === 'webmention');
}

function linkingTo(target: string, words = 'Good post.'): string {
  return `<html><body><article class="h-entry">
    <a class="p-author h-card" href="https://them.example/">Ada Lovelace</a>
    <div class="e-content"><p>${words} <a href="${target}">this</a></p></div>
    <time class="dt-published" datetime="2026-09-20T09:00:00Z">20 September</time>
  </article></body></html>`;
}

describe('advertising the pingback endpoint', () => {
  it('puts it on a post in an X-Pingback header and a link in its head', async () => {
    const cms = await site();

    const response = await cms.app.request('/2026/09/hello-world/');

    assert.equal(response.headers.get('x-pingback'), ENDPOINT);
    assert.match(await response.text(), new RegExp(`<link rel="pingback" href="${ENDPOINT}">`));
  });

  it('puts it on a page that takes comments, and not on one that does not', async () => {
    const cms = await site();

    const open = await cms.app.request('/about/');
    assert.equal(open.headers.get('x-pingback'), ENDPOINT);
    assert.match(await open.text(), /<link rel="pingback"/);

    const closed = await cms.app.request('/colophon/');
    assert.equal(closed.headers.get('x-pingback'), null);
    assert.doesNotMatch(await closed.text(), /rel="pingback"/);
  });

  it('advertises nothing, and has no endpoint, when the site takes no webmentions', async () => {
    const cms = await site({}, { webmentionsReceive: false });

    const response = await cms.app.request('/2026/09/hello-world/');
    assert.equal(response.headers.get('x-pingback'), null);
    assert.doesNotMatch(await response.text(), /rel="pingback"/);

    assert.equal((await ping(cms, 'https://them.example/a')).status, 404);
  });
});

describe('a valid pingback', () => {
  it('is filed exactly as the same link sent as a webmention is', async () => {
    const source = 'https://them.example/note';
    pages.set(source, { body: linkingTo(POST_URL) });

    const pinged = await site();
    assert.equal(await faultOf(await ping(pinged, source)), undefined);

    const mentioned = await site();
    await mentioned.app.request(WEBMENTION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ source, target: POST_URL }).toString(),
    });
    await mentioned.webmentions.settled();

    const [fromPing] = mentionsOf(pinged);
    const [fromMention] = mentionsOf(mentioned);
    assert.ok(fromPing !== undefined && fromMention !== undefined);
    assert.equal(fromPing.status, 'pending', 'held for a moderator');
    const { id: _a, addressHash: _b, ...pingedFields } = fromPing;
    const { id: _c, addressHash: _d, ...mentionedFields } = fromMention;
    assert.deepEqual(pingedFields, mentionedFields);
  });

  it('answers with a string once the source has been checked', async () => {
    const cms = await site();
    pages.set('https://them.example/note', { body: linkingTo(POST_URL) });

    const text = await (await ping(cms, 'https://them.example/note')).text();

    assert.match(text, /<params><param><value><string>[^<]+<\/string><\/value><\/param><\/params>/);
  });

  it('goes past the spam checker, which is told it is a webmention', async () => {
    const verdicts: CommentVerdict[] = ['spam'];
    const sources: string[] = [];
    const cms = await site({
      commentChecker: {
        check(submission): CommentVerdict {
          sources.push(submission.comment.source);
          return verdicts.shift() ?? 'unknown';
        },
      },
    });
    pages.set('https://them.example/note', { body: linkingTo(POST_URL) });

    await ping(cms, 'https://them.example/note');

    assert.deepEqual(sources, ['webmention']);
    assert.equal(mentionsOf(cms)[0]?.status, 'spam');
  });

  it('is among the page’s mentions once a moderator approves it', async () => {
    const cms = await site();
    pages.set('https://them.example/note', { body: linkingTo(OPEN_PAGE_URL, 'Good page.') });

    assert.equal(
      await faultOf(await ping(cms, 'https://them.example/note', OPEN_PAGE_URL)),
      undefined,
    );
    const [held] = mentionsOf(cms, 'about');
    assert.doesNotMatch(await (await cms.app.request('/about/')).text(), /them\.example\/note/);

    await updateComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      held?.id ?? '',
      { status: 'approved' },
    );

    const page = await (await cms.app.request('/about/')).text();
    assert.match(page, /class="reaction-group p-mention"[^]*href="https:\/\/them\.example\/note"/);
  });

  it('updates what it left when it is sent again, and says it was already registered', async () => {
    const cms = await site();
    pages.set('https://them.example/note', { body: linkingTo(POST_URL, 'First thought.') });
    await ping(cms, 'https://them.example/note');
    const first = mentionsOf(cms)[0];

    pages.set('https://them.example/note', { body: linkingTo(POST_URL, 'Second thought.') });
    const again = await ping(cms, 'https://them.example/note');

    assert.equal(await faultOf(again), 0x0030);
    const held = mentionsOf(cms);
    assert.equal(held.length, 1, 'still one');
    assert.equal(held[0]?.id, first?.id, 'the same one');
    assert.match(held[0]?.content.html ?? '', /Second thought\./);
  });
});

describe('the faults a pingback is answered with', () => {
  it('0x0010 for a source that does not exist or is not somebody else’s page', async () => {
    const cms = await site();

    assert.equal(await faultOf(await ping(cms, 'https://them.example/missing')), 0x0010);
    assert.equal(await faultOf(await ping(cms, 'ftp://them.example/a')), 0x0010);
    assert.equal(await faultOf(await ping(cms, 'http://127.0.0.1/a')), 0x0010);
    assert.equal(mentionsOf(cms).length, 0);
  });

  it('0x0011 for a source that does not link to the target', async () => {
    const cms = await site();
    pages.set('https://them.example/note', { body: '<p>Nothing to see.</p>' });

    assert.equal(await faultOf(await ping(cms, 'https://them.example/note')), 0x0011);
    assert.equal(mentionsOf(cms).length, 0);
  });

  it('0x0020 for a target that does not exist here', async () => {
    const cms = await site();

    const response = await ping(cms, 'https://them.example/a', `${BASE_URL}/nothing-here/`);
    assert.equal(await faultOf(response), 0x0020);
    assert.equal(await faultOf(await ping(cms, 'https://them.example/a', 'nonsense')), 0x0020);
  });

  it('0x0021 for a target elsewhere, or a page here that takes no comments', async () => {
    const cms = await site();

    const elsewhere = await ping(cms, 'https://them.example/a', 'https://other.example/post/');
    assert.equal(await faultOf(elsewhere), 0x0021);

    pages.set('https://them.example/a', { body: linkingTo(CLOSED_PAGE_URL) });
    assert.equal(await faultOf(await ping(cms, 'https://them.example/a', CLOSED_PAGE_URL)), 0x0021);
    assert.equal(mentionsOf(cms, 'colophon').length, 0);
    assert.deepEqual(fetched, [], 'nothing was fetched for a target that cannot be pinged');
  });

  it('a generic fault for a source that cannot be read this time', async () => {
    const cms = await site();
    pages.set('https://them.example/note', { status: 503 });

    assert.equal(await faultOf(await ping(cms, 'https://them.example/note')), 0);
  });

  it('the XML-RPC interop codes for an unknown method or the wrong arguments', async () => {
    const cms = await site();

    assert.equal(await faultOf(await post(cms, call('pingback.extensions.getPingbacks'))), -32601);
    assert.equal(await faultOf(await post(cms, call('pingback.ping', POST_URL))), -32602);
  });
});

describe('what is refused before it is parsed', () => {
  it('refuses XML that is not well formed', async () => {
    const cms = await site();

    assert.equal(await faultOf(await post(cms, '<methodCall><methodName>')), -32700);
    assert.equal(await faultOf(await post(cms, 'source=a&target=b')), -32700);
  });

  it('refuses a document type, so no external entity is ever resolved', async () => {
    const cms = await site();
    const hostile = `<?xml version="1.0"?>
<!DOCTYPE methodCall [<!ENTITY src SYSTEM "https://attacker.example/secret">]>
<methodCall><methodName>pingback.ping</methodName><params>
<param><value><string>&src;</string></value></param>
<param><value><string>${POST_URL}</string></value></param>
</params></methodCall>`;

    assert.equal(await faultOf(await post(cms, hostile)), -32700);
    assert.deepEqual(fetched, [], 'nothing was fetched');
  });

  it('refuses an entity it does not know rather than guessing', async () => {
    const cms = await site();

    assert.equal(await faultOf(await post(cms, call('pingback.ping', '&nope;', POST_URL))), -32700);
  });

  it('refuses a body larger than a pingback could ever be', async () => {
    const cms = await site();
    const padding = ' '.repeat(PINGBACK_MAX_BYTES);

    const response = await post(
      cms,
      call('pingback.ping', 'https://them.example/a', POST_URL) + padding,
    );
    assert.equal(await faultOf(response), -32700);
    assert.deepEqual(fetched, []);
  });

  it('reads an untyped value and the predefined entities as the strings they are', async () => {
    const cms = await site();
    const source = 'https://them.example/note?a=1&b=2';
    pages.set(source, { body: linkingTo(POST_URL) });
    const body = `<?xml version="1.0"?>
<methodCall><methodName>pingback.ping</methodName><params>
<param><value>https://them.example/note?a=1&amp;b=2</value></param>
<param><value><string>${POST_URL}</string></value></param>
</params></methodCall>`;

    assert.equal(await faultOf(await post(cms, body)), undefined);
    assert.equal(mentionsOf(cms)[0]?.url, source);
  });

  it('answers a GET with what the endpoint is for', async () => {
    const cms = await site();

    const response = await cms.app.request(PINGBACK_PATH);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  });
});
