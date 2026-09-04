import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, signedIn } from './admin/__testing__/harness.ts';
import type { Browser } from './admin/__testing__/harness.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteSettings } from './admin/settings.ts';
import { openAdminStore } from './admin/store.ts';
import { createCms } from './index.ts';
import type { Cms } from './index.ts';

/** The site under test. */
const BASE_URL = 'https://blog.example';

/** The notify server under test. It exists only in the fetch stub. */
const NOTIFY_SERVER = 'https://cloud.example';
const PING_URL = `${NOTIFY_SERVER}/ping`;

/** A host whose ping endpoint answers every POST with a server error. */
const BROKEN_SERVER = 'https://broken.example';

/** One ping this site made. */
interface Ping {
  /** Where it went. */
  url: string;
  /** The `url` field of its form body: the feed that changed. */
  feed: string;
  /** What it was labelled as on the wire. */
  contentType: string | null;
}

const started: Cms[] = [];
const temporaryDirs: string[] = [];
const pings: Ping[] = [];

const restoreFetch = routeNotifyServers();

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Route the make-believe notify servers through memory: a POST to one is
 * recorded rather than sent, and the broken one fails every time. Anything
 * else reaches the real `fetch` untouched.
 */
function routeNotifyServers(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(requestUrl(input));
    if (url.origin === BROKEN_SERVER) {
      return new Response('The cloud is having a bad day.', { status: 500 });
    }
    if (url.origin !== NOTIFY_SERVER) return await original(input, init);

    const request = new Request(input, init);
    const body = new URLSearchParams(await request.text());
    pings.push({
      url: request.url,
      feed: body.get('url') ?? '',
      contentType: request.headers.get('content-type'),
    });
    return new Response('{"success":true,"msg":"Thanks for the ping."}', {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

/** The URL a `fetch` argument names, without reading the body a Request holds. */
function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** A CMS whose settings name a notify server, over a content directory of its own. */
async function site(
  options: {
    notifyServer?: string;
    files?: Record<string, string>;
    now?: () => Date;
  } = {},
): Promise<{ cms: Cms; contentDir: string }> {
  const dataDir = await temporaryDir('geekity-notify-data-');
  const contentDir = await temporaryDir('geekity-notify-content-');

  for (const [relative, source] of Object.entries(options.files ?? {})) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source, 'utf8');
  }

  const seed = openAdminStore({ dataDir });
  writeSiteSettings(seed, {
    ...DEFAULT_SITE_SETTINGS,
    baseUrl: BASE_URL,
    notifyServer: options.notifyServer ?? NOTIFY_SERVER,
  });
  seed.close();

  pings.length = 0;
  const cms = createCms({
    dataDir,
    contentDir,
    port: 0,
    watch: false,
    baseUrl: BASE_URL,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  started.push(cms);
  await cms.sync();
  return { cms, contentDir };
}

/** A post file. */
function post(options: {
  title: string;
  slug: string;
  tags?: string[];
  categories?: string[];
  draft?: boolean;
}): string {
  const lines = [
    `title: ${options.title}`,
    `date: '2026-09-02T09:00:00Z'`,
    `permalink: /${options.slug}/`,
  ];
  if (options.tags !== undefined) lines.push('tags:', ...options.tags.map((tag) => `  - ${tag}`));
  if (options.categories !== undefined) {
    lines.push('categories:', ...options.categories.map((name) => `  - ${name}`));
  }
  if (options.draft === true) lines.push('draft: true');
  return `---\n${lines.join('\n')}\n---\n\nA post.\n`;
}

/** Publish a new post through the editor, the way a browser would. */
async function publish(agent: Browser, fields: Record<string, string> = {}): Promise<Response> {
  const html = await (await agent.get('/admin/posts/new')).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the editor carried a CSRF token');

  return agent.post('/admin/posts/new', {
    csrf_token: token,
    title: 'Hello, world',
    slug: 'hello-world',
    permalink: '',
    date: '2026-03-04T10:00:00.000Z',
    tags: 'essays',
    categories: '',
    description: '',
    body: 'The first post.',
    hash: '',
    action: 'publish',
    ...fields,
  });
}

/** Fill in the editor for an existing post and submit it, keeping what it came with. */
async function submitEditor(
  agent: Browser,
  url: string,
  changes: Record<string, string>,
): Promise<Response> {
  const html = await (await agent.get(url)).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, `the editor at ${url} carried a CSRF token`);

  const fields: Record<string, string> = { csrf_token: token, action: 'publish' };
  for (const name of ['title', 'slug', 'permalink', 'date', 'tags', 'categories', 'hash']) {
    fields[name] = field(html, name) ?? '';
  }
  fields['body'] = /<textarea[^>]*name="body"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '';

  return agent.post(url, { ...fields, ...changes });
}

/** The value of a form field in a rendered editor. */
function field(html: string, name: string): string | undefined {
  return new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html)?.[1];
}

/** Every feed pinged since the last reset, sorted so order is not asserted. */
function pingedFeeds(): string[] {
  return [...pings.map((ping) => ping.feed)].sort();
}

/** The three feeds under one listing root, absolute. */
function feedsUnder(root: string): string[] {
  return [
    `${BASE_URL}${root}feed/`,
    `${BASE_URL}${root}feed/atom/`,
    `${BASE_URL}${root}feed/json/`,
  ];
}

describe('pinging the notify server', () => {
  it('tells it about every feed a published post appears in', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    const response = await publish(agent, { tags: 'web, essays', categories: 'general' });
    assert.equal(response.status, 303, 'the post was published');
    await cms.notifier.settled();

    assert.deepEqual(
      pingedFeeds(),
      [
        ...feedsUnder('/'),
        ...feedsUnder('/tag/web/'),
        ...feedsUnder('/tag/essays/'),
        ...feedsUnder('/category/general/'),
      ].sort(),
    );

    // https://rpc.rsscloud.io/docs/quick-start: a form post to /ping with the
    // feed's address in `url`.
    const first = pings[0] as Ping;
    assert.equal(first.url, PING_URL);
    assert.match(first.contentType ?? '', /application\/x-www-form-urlencoded/);
  });

  it('says nothing while a post is scheduled, and everything when it comes due', async () => {
    let now = new Date('2026-09-03T12:00:00Z');
    const { cms } = await site({ now: () => now });
    const agent = await signedIn(cms);
    await cms.scheduler.start();

    await publish(agent, { date: '2026-09-04T09:00:00.000Z', tags: 'web', categories: 'general' });
    await cms.notifier.settled();

    assert.deepEqual(pingedFeeds(), [], 'a feed nobody can see has not changed');

    now = new Date('2026-09-04T09:00:00Z');
    await cms.scheduler.run();
    await cms.notifier.settled();

    assert.deepEqual(
      pingedFeeds(),
      [...feedsUnder('/'), ...feedsUnder('/tag/web/'), ...feedsUnder('/category/general/')].sort(),
    );
  });

  it('tells it about the feeds a post left as well as the ones it joined', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    await publish(agent, { tags: 'before' });
    await cms.notifier.settled();
    pings.length = 0;

    const edited = await submitEditor(agent, '/admin/posts/hello-world', { tags: 'after' });
    assert.equal(edited.status, 303);
    await cms.notifier.settled();

    assert.deepEqual(
      pingedFeeds(),
      [...feedsUnder('/'), ...feedsUnder('/tag/before/'), ...feedsUnder('/tag/after/')].sort(),
    );
  });

  it('tells it when a post is withdrawn, using the feeds it was in', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    await publish(agent, { tags: 'web' });
    await cms.notifier.settled();
    pings.length = 0;

    const drafted = await submitEditor(agent, '/admin/posts/hello-world', { action: 'save-draft' });
    assert.equal(drafted.status, 303);
    await cms.notifier.settled();

    assert.deepEqual(pingedFeeds(), [...feedsUnder('/'), ...feedsUnder('/tag/web/')].sort());
  });

  it('says nothing for a full scan, which is a rebuilt index rather than news', async () => {
    const { cms } = await site({
      files: {
        'posts/2026-09-02-one.md': post({ title: 'One', slug: 'one', tags: ['web'] }),
        'posts/2026-09-03-two.md': post({ title: 'Two', slug: 'two' }),
      },
    });

    await cms.sync();
    await cms.notifier.settled();

    assert.deepEqual(pings, []);
  });

  it('says nothing about a draft, which is in no feed', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    const saved = await publish(agent, { action: 'save-draft', tags: 'web' });
    assert.equal(saved.status, 303);
    await cms.notifier.settled();

    assert.deepEqual(pings, []);
  });

  it('says nothing at all when the site names no notify server', async () => {
    const { cms } = await site({ notifyServer: '' });
    const agent = await signedIn(cms);

    await publish(agent, { tags: 'web' });
    await cms.notifier.settled();

    assert.deepEqual(pings, []);
  });

  it('logs a refusal and leaves the post published', async () => {
    const { cms } = await site({ notifyServer: BROKEN_SERVER });
    const agent = await signedIn(cms);

    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));

    try {
      const response = await publish(agent);
      assert.equal(response.status, 303, 'the save succeeded anyway');
      await cms.notifier.settled();
    } finally {
      console.warn = warn;
    }

    assert.ok(warnings.length > 0, 'the failure was reported');
    assert.match(warnings[0] ?? '', /500/);
    assert.match(await (await cms.app.request('/feed/')).text(), /Hello, world/);
  });

  it('is a hook a site can call for whatever it likes', async () => {
    const { cms } = await site();

    const report = await cms.notifyFeeds([
      'https://blog.example/feed/',
      'https://blog.example/feed/',
      'https://blog.example/feed/json/',
    ]);

    // The same URL twice is one ping: the server re-fetches the feed either way.
    assert.deepEqual(pingedFeeds(), [
      'https://blog.example/feed/',
      'https://blog.example/feed/json/',
    ]);
    assert.deepEqual(
      report.pings.map((ping) => ping.ok),
      [true, true],
    );
  });
});
