import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import type { PostComment } from '../store/admin-store.ts';
import { commentsDirectory, updateComment } from '../comments/records.ts';
import type { CommentVerdict } from '../forms/checker.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { DEFAULT_SITE_SETTINGS } from '../site/settings.ts';
import { writeSiteSettings } from '../__testing__/site-settings.ts';
import {
  PINGBACK_FAULTS,
  PINGBACK_MAX_BYTES,
  PINGBACK_PATH,
  readPingbackCall,
} from './pingback.ts';
import type { HostLookup } from '../util/public-address.ts';
import { WEBMENTION_PATH } from './endpoint.ts';

const BASE_URL = 'https://blog.example';
const ENDPOINT = `${BASE_URL}${PINGBACK_PATH}`;
const POST_URL = `${BASE_URL}/2026/09/hello-world/`;
const OPEN_PAGE_URL = `${BASE_URL}/about/`;
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
  'posts/2026-09-19-cafe.md': `---
title: Café
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/café/
---

Coffee.
`,
  'posts/2026-09-18-copied.md': `---
title: Copied
date: '2026-09-18T09:00:00Z'
permalink: /2026/09/copied/
syndication:
  - https://social.example/@me/1
---

Shared elsewhere too.
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
  /** The answer waits until this settles, or the request is aborted. */
  gate?: Promise<void>;
}

const pages = new Map<string, Page>();

const lookup: HostLookup = (hostname) =>
  Promise.resolve(hostname.endsWith('.internal.example') ? ['10.0.0.5'] : ['203.0.113.7']);

const fetched: string[] = [];
const started: Cms[] = [];
const temporaryDirs: string[] = [];
const gates: (() => void)[] = [];

const restoreFetch = routeTheWeb();

after(async () => {
  for (const open of gates) open();
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

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    const page = pages.get(url);
    if (page?.gate !== undefined) {
      const signal = init?.signal;
      await new Promise<void>((resolve, reject) => {
        void page.gate?.then(resolve);
        signal?.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      });
    }
    const response =
      page === undefined
        ? new Response('missing', { status: 404 })
        : new Response(page.body ?? '', {
            status: page.status ?? 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
    Object.defineProperty(response, 'url', { value: url });
    return response;
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

async function faultOf(response: Response): Promise<number | undefined> {
  assert.equal(response.status, 200, 'XML-RPC answers every call with a 200');
  assert.match(response.headers.get('content-type') ?? '', /^text\/xml/);
  const text = await response.text();
  assert.match(text, /^<\?xml version="1.0"\?>\s*<methodResponse>/);
  const code = /<name>faultCode<\/name>\s*<value><int>(-?\d+)<\/int><\/value>/.exec(text)?.[1];
  return code === undefined ? undefined : Number(code);
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

function faultStringOf(text: string): string {
  return (
    /<name>faultString<\/name>\s*<value><string>([^<]*)<\/string><\/value>/.exec(text)?.[1] ?? ''
  );
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

  it('puts it on a page, whether or not it takes comments', async () => {
    const cms = await site();

    const open = await cms.app.request('/about/');
    assert.equal(open.headers.get('x-pingback'), ENDPOINT);
    assert.match(await open.text(), /<link rel="pingback"/);

    const closed = await cms.app.request('/colophon/');
    assert.equal(closed.headers.get('x-pingback'), ENDPOINT);
    assert.match(await closed.text(), /<link rel="pingback"/);
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

  it('is filed against a post whose target is the encoded spelling of its permalink', async () => {
    const cms = await site();
    const target = `${BASE_URL}/2026/09/caf%C3%A9/`;
    pages.set('https://them.example/note', { body: linkingTo(target) });

    assert.equal(await faultOf(await ping(cms, 'https://them.example/note', target)), undefined);

    assert.deepEqual(
      mentionsOf(cms, 'café').map((one) => one.url),
      ['https://them.example/note'],
    );
  });

  it('is filed on the original post when the target is a recorded syndicated copy', async () => {
    const cms = await site();
    const copy = 'https://social.example/@me/1';
    pages.set('https://them.example/note', { body: linkingTo(copy) });

    assert.equal(await faultOf(await ping(cms, 'https://them.example/note', copy)), undefined);

    assert.deepEqual(
      mentionsOf(cms, 'copied').map((one) => one.url),
      ['https://them.example/note'],
    );
  });

  it('leaves an approved entry alone when sent again with a query on the target', async () => {
    const cms = await site();
    pages.set('https://them.example/note', { body: linkingTo(POST_URL) });
    await ping(cms, 'https://them.example/note');
    const first = mentionsOf(cms)[0];
    await updateComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      first?.id ?? '',
      { status: 'approved' },
    );

    const again = await ping(cms, 'https://them.example/note', `${POST_URL}?x=1`);

    assert.equal(await faultOf(again), 0x0020);
    const held = mentionsOf(cms);
    assert.equal(held.length, 1, 'still there');
    assert.equal(held[0]?.id, first?.id);
    assert.equal(held[0]?.status, 'approved');
  });
});

describe('a pingback while another source is being checked', () => {
  it('is answered without waiting for the other source', async () => {
    const cms = await site();
    const slow = gate();
    pages.set('https://slow.example/c', { body: linkingTo(POST_URL), gate: slow.promise });
    pages.set('https://fast.example/d', { body: linkingTo(POST_URL) });

    const waiting = ping(cms, 'https://slow.example/c');
    const started = Date.now();
    const answered = await ping(cms, 'https://fast.example/d');
    assert.ok(Date.now() - started < 2_000, 'the pingback waited on the other check');
    assert.equal(await faultOf(answered), undefined);

    slow.open();
    await waiting;
    await cms.webmentions.settled();
  });

  it('answers a generic fault once its deadline passes, and files the pingback when the check ends', async () => {
    const cms = await site({ webmentions: { pingbackAnswerMs: 100 } });
    const slow = gate();
    pages.set('https://slow.example/e', { body: linkingTo(POST_URL), gate: slow.promise });

    const started = Date.now();
    const text = await (await ping(cms, 'https://slow.example/e')).text();
    assert.ok(Date.now() - started < 2_000, 'the pingback waited past its deadline');
    assert.match(text, /<int>0<\/int>/);
    assert.match(text, /still being checked/);

    slow.open();
    await cms.webmentions.settled();
    assert.ok(mentionsOf(cms).some((one) => one.url === 'https://slow.example/e'));
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

  it('0x0010, and nothing fetched, for a source on this site', async () => {
    const cms = await site();
    pages.set(`${BASE_URL}/`, { body: `<a href="${POST_URL}">Hello world</a>` });

    assert.equal(await faultOf(await ping(cms, `${BASE_URL}/`)), 0x0010);
    assert.deepEqual(fetched, []);
    assert.equal(mentionsOf(cms).length, 0);
  });

  it('0x0000 for a source that refuses to be read but has not gone', async () => {
    const cms = await site();
    pages.set('https://them.example/locked', { status: 403, body: 'no' });

    assert.equal(await faultOf(await ping(cms, 'https://them.example/locked')), 0x0000);
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

  it('0x0021 for a target elsewhere', async () => {
    const cms = await site();

    const elsewhere = await ping(cms, 'https://them.example/a', 'https://other.example/post/');
    assert.equal(await faultOf(elsewhere), 0x0021);
    assert.deepEqual(fetched, [], 'nothing was fetched for a target that cannot be pinged');
  });

  it('a generic fault for a source that cannot be read this time', async () => {
    const cms = await site();
    pages.set('https://them.example/note', { status: 503 });

    assert.equal(await faultOf(await ping(cms, 'https://them.example/note')), 0);
  });

  it('0x0010, and nothing fetched or stored, for a source on a port other than the default', async () => {
    const cms = await site();
    pages.set('https://them.example:8443/note', { body: linkingTo(POST_URL) });

    assert.equal(await faultOf(await ping(cms, 'https://them.example:8443/note')), 0x0010);
    assert.deepEqual(fetched, []);
    assert.equal(mentionsOf(cms).length, 0);
  });

  it('a generic fault, and nothing fetched, for a source that resolves to a private address', async () => {
    const cms = await site();
    pages.set('https://wiki.internal.example/note', { body: linkingTo(POST_URL) });

    assert.equal(await faultOf(await ping(cms, 'https://wiki.internal.example/note')), 0);
    assert.deepEqual(fetched, []);
    assert.equal(mentionsOf(cms).length, 0);
  });

  it('the XML-RPC interop codes for an unknown method or the wrong arguments', async () => {
    const cms = await site();

    assert.equal(await faultOf(await post(cms, call('pingback.extensions.getPingbacks'))), -32601);
    assert.equal(await faultOf(await post(cms, call('pingback.ping', POST_URL))), -32602);
  });
});

describe('the words of a fault for a source that could not be read', () => {
  it('say nothing of how the source answered', async () => {
    const cms = await site();
    pages.set('https://them.example/note', { status: 503 });

    const message = faultStringOf(await (await ping(cms, 'https://them.example/note')).text());

    assert.doesNotMatch(message, /503|answered/);
  });

  it('say nothing of an error the site hit while filing it', async () => {
    const cms = await site();
    pages.set('https://them.example/note', { body: linkingTo(POST_URL) });
    const directory = commentsDirectory(cms.config.contentDir);
    await mkdir(directory, { recursive: true });
    await chmod(directory, 0o500);
    try {
      const message = faultStringOf(await (await ping(cms, 'https://them.example/note')).text());

      assert.notEqual(message, '');
      assert.ok(!message.includes('/'), `fault string: ${message}`);
    } finally {
      await chmod(directory, 0o700);
    }
  });
});

describe('one address sending many pings', () => {
  it('is answered with a fault once it has sent too many, and the webmention endpoint shares the count', async () => {
    const cms = await site({
      trustProxy: true,
      webmentions: { rateLimit: { requests: 2, windowSeconds: 600 } },
    });
    pages.set('https://them.example/note', { body: linkingTo(POST_URL) });
    const from = async (body: string, type: string): Promise<Response> =>
      await cms.app.request(PINGBACK_PATH, {
        method: 'POST',
        headers: { 'content-type': type, 'x-forwarded-for': '198.51.100.9' },
        body,
      });
    const pingFrom = (source: string): Promise<Response> =>
      from(call('pingback.ping', source, POST_URL), 'text/xml');

    assert.equal(await faultOf(await pingFrom('https://them.example/note')), undefined);
    const webmention = await cms.app.request('/_geekity/webmention', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': '198.51.100.9',
      },
      body: new URLSearchParams({
        source: 'https://them.example/other',
        target: POST_URL,
      }).toString(),
    });
    assert.equal(webmention.status, 202);
    await cms.webmentions.settled();
    fetched.length = 0;

    assert.equal(await faultOf(await pingFrom('https://them.example/again')), 0);
    assert.deepEqual(fetched, [], 'a refused ping reads nothing');
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

describe('what the endpoint answers, word for word', () => {
  it('thanks the sender in an XML-RPC string once the pingback is held', async () => {
    const source = 'https://them.example/note';
    pages.set(source, { body: linkingTo(POST_URL) });
    const cms = await site();

    const response = await ping(cms, source);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/xml; charset=utf-8');
    assert.equal(
      await response.text(),
      '<?xml version="1.0"?>\n<methodResponse><params><param><value><string>' +
        'Thanks. The pingback is waiting for a moderator.' +
        '</string></value></param></params></methodResponse>\n',
    );
  });

  it('spells a fault out as the struct the spec defines', async () => {
    const cms = await site();

    const response = await post(cms, call('pingback.extensions.getPingbacks'));

    assert.equal(response.headers.get('content-type'), 'text/xml; charset=utf-8');
    assert.equal(
      await response.text(),
      '<?xml version="1.0"?>\n<methodResponse><fault><value><struct>\n' +
        '<member><name>faultCode</name><value><int>-32601</int></value></member>\n' +
        '<member><name>faultString</name><value><string>Only pingback.ping is served here.</string></value></member>\n' +
        '</struct></value></fault></methodResponse>\n',
    );
  });

  it('has no endpoint on a site that takes no webmentions', async () => {
    const cms = await site({}, { webmentionsReceive: false });

    const response = await ping(cms, 'https://them.example/a');

    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'This site does not take pingbacks.');
  });

  it('says what it takes when somebody GETs it', async () => {
    const cms = await site();

    const response = await cms.app.request(PINGBACK_PATH);

    assert.equal(await response.text(), 'Send a pingback here as an XML-RPC pingback.ping POST.');
  });
});

describe('reading a pingback call', () => {
  for (const name of ['constructor', 'toString', 'valueOf', '__proto__']) {
    it(`refuses a param holding &${name}; as an unknown reference`, () => {
      const xml =
        '<?xml version="1.0"?><methodCall><methodName>pingback.ping</methodName><params>' +
        `<param><value><string>https://them.example/&${name};</string></value></param>` +
        '<param><value><string>https://blog.example/2026/09/hello/</string></value></param>' +
        '</params></methodCall>';

      assert.deepEqual(readPingbackCall(xml), {
        code: PINGBACK_FAULTS.notWellFormed,
        message: 'The call is not well formed.',
      });
    });
  }
});
