import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { findUser } from './accounts.ts';
import { CITED_SLUG_TIMEOUT_MS } from '../webmention/reply-contexts.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';
import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import type { HostLookup } from '../webmention/public-address.ts';
import { csrfField, FIRST_ADMIN, sandbox, signedIn } from './__testing__/harness.ts';

const box = sandbox();
remoteHostsDoNotExist();

const BASE = 'https://blog.example';
const NOW = new Date('2026-10-03T12:00:00.000Z');

const VIDEO = 'https://video.example/watch?v=dQw4w9WgXcQ';
const VIDEO_OEMBED = 'https://video.example/oembed?v=dQw4w9WgXcQ';
const TITLED = 'http://scripting.example/';
const ENTRY = 'https://them.example/2026/09/tomatoes/';
const NOTE = 'https://social.example/@pat/117249870148068466';
const DOWN = 'https://down.example/watch?v=1';
const UNTITLED = 'https://bare.example/a-page';
const SLOW = 'https://slow.example/watch?v=2';

const PAGES: Record<string, { type: string; body: string }> = {
  [VIDEO]: {
    type: 'text/html',
    body: `<title>- Video</title>
      <link rel="alternate" type="application/json+oembed" href="/oembed?v=dQw4w9WgXcQ">`,
  },
  [VIDEO_OEMBED]: {
    type: 'application/json',
    body: JSON.stringify({
      title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
      author_name: 'Rick Astley',
    }),
  },
  [TITLED]: { type: 'text/html', body: '<title>Scripting News</title>' },
  [ENTRY]: {
    type: 'text/html',
    body: `<article class="h-entry">
      <h1 class="p-name">Growing tomatoes in a cold spring</h1>
      <div class="e-content"><p>Tomatoes want sun.</p></div>
    </article>`,
  },
  [NOTE]: {
    type: 'text/html',
    body: `<article class="h-entry"><div class="e-content p-name">Just a note.</div></article>`,
  },
  [UNTITLED]: { type: 'text/html', body: '<p>Nothing to call it.</p>' },
};

const contextFetches: string[] = [];
const lookup: HostLookup = () => Promise.resolve(['203.0.113.7']);

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new Request(input).url;
  if (init?.redirect === 'manual') contextFetches.push(url);
  if (url === SLOW) {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation timed out.', 'TimeoutError'));
      });
    });
  }
  const page = PAGES[url];
  if (page === undefined) return Promise.reject(new TypeError('fetch failed'));
  return Promise.resolve(new Response(page.body, { headers: { 'content-type': page.type } }));
}) as typeof fetch;

const warn = console.warn;
console.warn = () => undefined;

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
  console.warn = warn;
});

beforeEach(() => {
  contextFetches.length = 0;
});

async function site(): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await box.dir('geekity-cited-title-slug-content-');
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-cited-title-slug-data-'),
    baseUrl: BASE,
    now: () => NOW,
    hostLookup: lookup,
  });
  return { cms, contentDir };
}

async function editorSlug(cms: Cms, fields: Record<string, string>): Promise<string> {
  const agent = await signedIn(cms);
  const html = await (await agent.get('/admin/posts/new')).text();
  const csrf = csrfField(html);
  assert.ok(csrf !== undefined);
  const response = await agent.post('/admin/posts/new', {
    csrf_token: csrf,
    action: 'publish',
    ...fields,
  });
  assert.equal(response.status, 303, await response.clone().text());
  const location = response.headers.get('location') ?? '';
  return location.replace('/admin/posts/', '');
}

async function micropubSlug(cms: Cms, fields: [string, string][]): Promise<string> {
  await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined);
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create'],
    },
    NOW,
  );
  const response = await cms.app.request('/_geekity/micropub', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams([['h', 'entry'], ...fields]).toString(),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const location = response.headers.get('location') ?? '';
  return location.replace(`${BASE}/2026/10/`, '').replace(/\/$/, '');
}

async function stored(contentDir: string): Promise<Record<string, { name?: string }>> {
  const text = await readFile(path.join(contentDir, '_data', 'replyContexts.json'), 'utf8');
  return JSON.parse(text) as Record<string, { name?: string }>;
}

describe('a new untitled post that cites a page is named after its title (TASK-250)', () => {
  const cases = [
    ['like-of', VIDEO, 'liked-rick-astley-never-gonna-give'],
    ['repost-of', TITLED, 'reposted-scripting-news'],
    ['bookmark-of', ENTRY, 'bookmarked-growing-tomatoes-in-a-cold'],
    ['in-reply-to', TITLED, 'reply-to-scripting-news'],
  ] as const;

  for (const [property, target, slug] of cases) {
    it(`names a ${property} of ${target} ${slug} from the editor`, async () => {
      const { cms } = await site();
      assert.equal(await editorSlug(cms, { [property]: target }), slug);
    });

    it(`names a ${property} of ${target} ${slug} from Micropub`, async () => {
      const { cms } = await site();
      assert.equal(await micropubSlug(cms, [[property, target]]), slug);
    });
  }

  it('keeps the fetched context and does not fetch the target again after the save', async () => {
    const { cms, contentDir } = await site();
    assert.equal(
      await micropubSlug(cms, [['like-of', VIDEO]]),
      'liked-rick-astley-never-gonna-give',
    );
    await cms.replyContexts.settled();
    assert.deepEqual(contextFetches, [VIDEO, VIDEO_OEMBED], 'the page and its oEmbed, once each');
    assert.equal(
      (await stored(contentDir))[VIDEO]?.name,
      'Rick Astley - Never Gonna Give You Up (Official Video)',
    );
  });

  it('names a post from a context the file already holds without fetching', async () => {
    const { cms, contentDir } = await site();
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'replyContexts.json'),
      JSON.stringify({ [DOWN]: { name: 'Held over from before' } }),
    );
    assert.equal(await micropubSlug(cms, [['like-of', DOWN]]), 'liked-held-over-from-before');
  });

  const fallbacks = [
    ['a target that fails', DOWN, 'liked-down-example-watch'],
    ['a target with no title', UNTITLED, 'liked-bare-example-a-page'],
    ['a note with no name of its own', NOTE, 'liked-social-example-pat'],
  ] as const;

  for (const [what, target, slug] of fallbacks) {
    it(`falls back to the host and path for ${what}`, async () => {
      const { cms } = await site();
      assert.equal(await micropubSlug(cms, [['like-of', target]]), slug);
    });
  }

  it('waits no longer than the timeout for a target that does not answer', async () => {
    const { cms } = await site();
    const started = Date.now();
    assert.equal(await micropubSlug(cms, [['like-of', SLOW]]), 'liked-slow-example-watch');
    const waited = Date.now() - started;
    assert.ok(waited < CITED_SLUG_TIMEOUT_MS + 1000, `the save took ${String(waited)} ms`);
  });

  it('keeps an existing post at its slug', async () => {
    const { cms, contentDir } = await site();
    await mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await writeFile(
      path.join(contentDir, 'posts', '2026-10-03-untitled.md'),
      "---\ndate: '2026-10-03T09:00:00Z'\npermalink: /2026/10/untitled/\n---\n",
    );
    await cms.sync();
    const agent = await signedIn(cms);
    const html = await (await agent.get('/admin/posts/untitled')).text();
    const csrf = csrfField(html);
    assert.ok(csrf !== undefined);
    const hash = /name="hash" value="([^"]*)"/.exec(html)?.[1] ?? '';
    const response = await agent.post('/admin/posts/untitled', {
      csrf_token: csrf,
      hash,
      date: '2026-10-03T09:00:00Z',
      permalink: '/2026/10/untitled/',
      'like-of': VIDEO,
      action: 'update',
    });
    assert.equal(response.status, 303, await response.clone().text());
    assert.equal(response.headers.get('location'), '/admin/posts/untitled');
    assert.equal(cms.store.getBySlug('untitled')?.permalink, '/2026/10/untitled/');
  });
});
