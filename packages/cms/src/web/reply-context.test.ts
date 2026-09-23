/**
 * A reply shows a preview of the post it answers (TASK-123): an embedded
 * `u-in-reply-to h-cite`, filled in from what the target said about itself
 * when the reply was synced or saved, and drawn without touching the network.
 * Asserted over HTTP against both themes, because the markup is the behaviour.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';

const box = sandbox();

const ENTRY = 'https://them.example/2026/09/tomatoes/';
const PLAIN = 'https://plain.example/page';
const DOWN = 'https://down.example/post';
const PRIVATE = 'http://127.0.0.1:8080/secret';
const HOSTILE = 'https://hostile.example/post';
const MOVED = 'https://other.example/2026/09/beans/';
const SLOW = 'https://slow.example/post';

const PAGES: Record<string, string> = {
  [ENTRY]: `<article class="h-entry">
    <h1 class="p-name">Growing tomatoes</h1>
    <a class="p-author h-card" href="https://them.example/">Pat Them</a>
    <time class="dt-published" datetime="2026-09-01T12:00:00Z">1 September</time>
    <div class="e-content"><p>Tomatoes want sun, water and patience.</p></div>
  </article>`,
  [PLAIN]: `<title>Just a page</title><meta name="description" content="About it.">`,
  [HOSTILE]: `<article class="h-entry">
    <h1 class="p-name">&lt;script&gt;alert(1)&lt;/script&gt;</h1>
    <a class="p-author h-card" href="javascript:alert(2)">&quot;&gt;&lt;img src=x onerror=alert(3)&gt;</a>
    <div class="e-content"><p>Hi <img src=x onerror="alert(4)"></p></div>
  </article>`,
  [MOVED]: `<article class="h-entry"><h1 class="p-name">Growing beans</h1>
    <div class="e-content">Beans climb.</div></article>`,
};

const lookedUp: string[] = [];
const fetched: string[] = [];
const everFetched = new Set<string>();
let slowAnswer: ((response: Response) => void) | undefined;

const lookup: HostLookup = (hostname) => {
  lookedUp.push(hostname);
  return Promise.resolve(['203.0.113.7']);
};

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  const url = new Request(input).url;
  fetched.push(url);
  everFetched.add(url);
  if (url === SLOW) {
    return new Promise<Response>((resolve) => {
      slowAnswer = resolve;
    });
  }
  const page = PAGES[url];
  if (page === undefined) return Promise.reject(new TypeError('fetch failed'));
  return Promise.resolve(new Response(page, { headers: { 'content-type': 'text/html' } }));
}) as typeof fetch;

after(async () => {
  slowAnswer?.(new Response('', { status: 503 }));
  await box.cleanup();
  globalThis.fetch = original;
});

beforeEach(() => {
  lookedUp.length = 0;
  fetched.length = 0;
});

function post(name: string, inReplyTo: string | undefined, title?: string): string {
  return [
    '---',
    ...(title === undefined ? [] : [`title: ${title}`]),
    "date: '2026-09-10T09:00:00Z'",
    `permalink: /2026/09/${name}/`,
    ...(inReplyTo === undefined ? [] : [`in-reply-to: ${inReplyTo}`]),
    '---',
    '',
    `The reply called ${name}.`,
    '',
  ].join('\n');
}

async function site(
  files: Record<string, string>,
  themesDir?: string,
): Promise<{
  cms: Cms;
  contentDir: string;
}> {
  const contentDir = await box.dir('geekity-reply-context-content-');
  const dataDir = await box.dir('geekity-reply-context-data-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const cms = await box.open({
      contentDir,
      dataDir,
      hostLookup: lookup,
      ...(themesDir === undefined ? {} : { themesDir }),
    });
    await cms.replyContexts.settled();
    return { cms, contentDir };
  } finally {
    console.warn = warn;
  }
}

async function get(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** The embedded citation on a page, or `undefined` when there is none. */
function cite(html: string): string | undefined {
  return /<div class="[^"]*\bu-in-reply-to h-cite\b[^"]*">[\s\S]*?<\/div>/.exec(html)?.[0];
}

async function stored(contentDir: string): Promise<Record<string, unknown>> {
  const text = await readFile(path.join(contentDir, '_data', 'replyContexts.json'), 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

describe('a reply’s preview of the post it answers, in the default theme', () => {
  let cms: Cms;
  let contentDir: string;

  before(async () => {
    ({ cms, contentDir } = await site({
      '_data/site.json': JSON.stringify({ title: 'A Site', timezone: 'UTC' }),
      'posts/2026-09-10-entry.md': post('entry', ENTRY),
      'posts/2026-09-10-plain.md': post('plain', PLAIN),
      'posts/2026-09-10-down.md': post('down', DOWN),
      'posts/2026-09-10-private.md': post('private', PRIVATE),
      'posts/2026-09-10-hostile.md': post('hostile', HOSTILE),
    }));
  });

  it('cites an h-entry target by its name, author and date, with its URL', async () => {
    const citation = cite(await get(cms, '/2026/09/entry/'));

    assert.ok(citation !== undefined, 'the page embeds an h-cite');
    assert.match(
      citation,
      new RegExp(`<a class="u-url p-name" href="${ENTRY}">Growing tomatoes</a>`),
    );
    assert.match(
      citation,
      /<span class="p-author h-card"><a class="u-url p-name" href="https:\/\/them.example\/">Pat Them<\/a><\/span>/,
    );
    assert.match(citation, /<time class="dt-published" datetime="2026-09-01T12:00:00(\.000)?Z">/);
    assert.match(
      citation,
      /<blockquote class="p-content">Tomatoes want sun, water and patience\.<\/blockquote>/,
    );
  });

  it('cites a target with no h-entry by its title and description', async () => {
    const citation = cite(await get(cms, '/2026/09/plain/'));

    assert.ok(citation !== undefined);
    assert.match(citation, new RegExp(`<a class="u-url p-name" href="${PLAIN}">Just a page</a>`));
    assert.match(citation, /<blockquote class="p-content">About it\.<\/blockquote>/);
    assert.doesNotMatch(citation, /p-author/);
  });

  it('cites an unreachable target by its URL alone', async () => {
    const citation = cite(await get(cms, '/2026/09/down/'));

    assert.ok(citation !== undefined);
    assert.match(citation, new RegExp(`<a class="u-url" href="${DOWN}">${DOWN}</a>`));
    assert.doesNotMatch(citation, /p-name|p-author|p-content|dt-published/);
  });

  it('never fetches a target on a private address, and cites it by its URL alone', async () => {
    const citation = cite(await get(cms, '/2026/09/private/'));

    assert.ok(citation !== undefined);
    assert.match(citation, /<a class="u-url" href="http:\/\/127\.0\.0\.1:8080\/secret">/);
    assert.equal(everFetched.has(PRIVATE), false, 'the private address was never fetched');
    assert.equal(PRIVATE in (await stored(contentDir)), false);
  });

  it('prints the target’s words as text, so its markup cannot reach the page', async () => {
    const citation = cite(await get(cms, '/2026/09/hostile/'));

    assert.ok(citation !== undefined);
    assert.match(citation, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(citation, /<script/);
    assert.doesNotMatch(citation, /<img/);
    assert.doesNotMatch(citation, /javascript:/);
    assert.match(citation, /&quot;&gt;&lt;img src=x onerror=alert\(3\)&gt;/);
  });

  it('keeps what it read in a file beside site.json, keyed by the target', async () => {
    assert.deepEqual(Object.keys(await stored(contentDir)).sort(), [HOSTILE, PLAIN, ENTRY].sort());
  });

  it('serves every reply without a lookup or a fetch', async () => {
    for (const name of ['entry', 'plain', 'down', 'private', 'hostile']) {
      await get(cms, `/2026/09/${name}/`);
    }

    assert.deepEqual(fetched, []);
    assert.deepEqual(lookedUp, []);
  });
});

describe('a reply whose target changes', () => {
  it('reads the new target, and forgets the old one when nothing replies to it', async () => {
    const { cms, contentDir } = await site({
      'posts/2026-09-10-entry.md': post('entry', ENTRY),
    });
    const file = path.join(contentDir, 'posts', '2026-09-10-entry.md');

    await writeFile(file, post('entry', MOVED), 'utf8');
    await cms.sync();
    await cms.replyContexts.settled();

    const citation = cite(await get(cms, '/2026/09/entry/'));
    assert.ok(citation !== undefined);
    assert.match(citation, new RegExp(`href="${MOVED}">Growing beans</a>`));
    assert.doesNotMatch(citation, /tomatoes/i);
    assert.deepEqual(Object.keys(await stored(contentDir)), [MOVED]);

    await writeFile(file, post('entry', undefined), 'utf8');
    await cms.sync();
    await cms.replyContexts.settled();

    const page = await get(cms, '/2026/09/entry/');
    assert.equal(cite(page), undefined, 'no preview once in-reply-to is cleared');
    assert.doesNotMatch(page, /Growing beans/);
    assert.deepEqual(await stored(contentDir), {});
  });

  it('keeps a target another reply still answers', async () => {
    const { cms, contentDir } = await site({
      'posts/2026-09-10-one.md': post('one', ENTRY),
      'posts/2026-09-10-two.md': post('two', ENTRY),
    });

    await writeFile(path.join(contentDir, 'posts', '2026-09-10-one.md'), post('one', undefined));
    await cms.sync();
    await cms.replyContexts.settled();

    assert.deepEqual(Object.keys(await stored(contentDir)), [ENTRY]);
    assert.match(cite(await get(cms, '/2026/09/two/')) ?? '', /Growing tomatoes/);
  });

  it('does not fetch again when the index is rebuilt from the same files', async () => {
    const { contentDir } = await site({ 'posts/2026-09-10-entry.md': post('entry', ENTRY) });
    fetched.length = 0;

    const dataDir = await box.dir('geekity-reply-context-rebuilt-');
    const rebuilt = await box.open({ contentDir, dataDir, hostLookup: lookup });
    await rebuilt.replyContexts.settled();

    assert.deepEqual(fetched, []);
    assert.match(cite(await get(rebuilt, '/2026/09/entry/')) ?? '', /Growing tomatoes/);
  });
});

describe('a site that starts with replies the file knows nothing about', () => {
  it('fetches them when it catches up, and not on a scan that finds nothing changed', async () => {
    const { cms, contentDir } = await site({ 'posts/2026-09-10-entry.md': post('entry', ENTRY) });
    await rm(path.join(contentDir, '_data', 'replyContexts.json'));
    fetched.length = 0;

    await cms.sync();
    await cms.replyContexts.settled();
    assert.deepEqual(fetched, [], 'an up-to-date index reports no change to act on');

    cms.replyContexts.catchUp();
    await cms.replyContexts.settled();

    assert.deepEqual(fetched, [ENTRY]);
    assert.deepEqual(Object.keys(await stored(contentDir)), [ENTRY]);
  });
});

describe('saving a reply', () => {
  it('does not wait on the target, and the preview arrives when it answers', async () => {
    const { cms, contentDir } = await site({
      'posts/2026-09-10-saved.md': post('saved', undefined, 'Saved'),
    });
    const agent = await signedIn(cms);

    const editor = await (await agent.get('/admin/posts/saved')).text();
    const action = /<form class="admin-editor" method="post" action="([^"]+)"/.exec(editor)?.[1];
    assert.ok(action !== undefined);
    const field = (name: string): string =>
      new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(editor)?.[1] ?? '';

    const response = await agent.post(action, {
      csrf_token: csrfField(editor) ?? '',
      hash: field('hash'),
      title: 'Saved',
      slug: field('slug'),
      permalink: field('permalink'),
      date: field('date'),
      tags: '',
      categories: '',
      description: '',
      'in-reply-to': SLOW,
      body: 'The reply called saved.',
      action: 'update',
    });

    assert.equal(response.status, 303, 'the save answered while the target had not');
    assert.match(
      await readFile(path.join(contentDir, 'posts', '2026-09-10-saved.md'), 'utf8'),
      new RegExp(`in-reply-to: ${SLOW}`),
    );
    assert.match(
      cite(await get(cms, '/2026/09/saved/')) ?? '',
      new RegExp(`<a class="u-url" href="${SLOW}">`),
      'a link-only preview until the target answers',
    );

    assert.ok(slowAnswer !== undefined, 'the target was asked');
    slowAnswer(
      new Response('<title>Finally</title>', { headers: { 'content-type': 'text/html' } }),
    );
    slowAnswer = undefined;
    await cms.replyContexts.settled();

    assert.match(cite(await get(cms, '/2026/09/saved/')) ?? '', />Finally<\/a>/);
  });
});

describe('a reply’s preview in the demo theme', () => {
  it('embeds the same h-cite inside the demo’s h-entry', async () => {
    const themesDir = path.resolve(import.meta.dirname, '../../../../apps/demo/themes');
    const { cms } = await site(
      {
        '_data/site.json': JSON.stringify({ title: 'Demo', theme: 'demo' }),
        'posts/2026-09-10-entry.md': post('entry', ENTRY),
      },
      themesDir,
    );

    const html = await get(cms, '/2026/09/entry/');
    const article = /<article class="post h-entry">[\s\S]*?<\/article>/.exec(html)?.[0] ?? '';

    assert.ok(article !== '', 'the demo layout drew the post');
    const citation = cite(article);
    assert.ok(citation !== undefined, 'the h-cite is inside the entry');
    assert.match(
      citation,
      new RegExp(`<a class="u-url p-name" href="${ENTRY}">Growing tomatoes</a>`),
    );
    assert.match(citation, /Pat Them/);
  });
});
