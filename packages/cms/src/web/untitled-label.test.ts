import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';

const box = sandbox();

const VIDEO = 'https://www.youtube.com/watch?v=teaser';
const THREAD = 'https://them.example/2026/10/thread/';
const UNREAD = 'https://unread.example/2026/10/post/';
const CITED_NAME = 'RuneScape <Official> & "4th" MMO teaser';
const CITED_ESCAPED = 'RuneScape &lt;Official&gt; &amp; &quot;4th&quot; MMO teaser';

const PHOTO_ALT = 'Greg <the> "dog" & cat';
const PHOTO_ALT_ESCAPED = 'Greg &lt;the&gt; &quot;dog&quot; &amp; cat';

const STORED = {
  [VIDEO]: { url: VIDEO, name: CITED_NAME },
  [THREAD]: { url: THREAD, name: 'A thread' },
};

const lookup: HostLookup = () => Promise.resolve(['203.0.113.7']);

const original = globalThis.fetch;
globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
const warn = console.warn;

before(() => {
  console.warn = () => undefined;
});

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
  console.warn = warn;
});

function post(slug: string, lines: string[], body = ''): string {
  return [
    '---',
    "date: '2026-10-01T09:00:00Z'",
    `permalink: /2026/10/${slug}/`,
    ...lines,
    '---',
    '',
    body,
  ].join('\n');
}

const POSTS: Record<string, string> = {
  liked: post('liked', [`like-of: ${VIDEO}`]),
  reposted: post('reposted', [`repost-of: ${VIDEO}`]),
  bookmarked: post('bookmarked', [`bookmark-of: ${UNREAD}`]),
  replied: post('replied', [`in-reply-to: ${THREAD}`]),
  photo: post('photo', ['photo: /uploads/2026/10/a.jpg']),
  described: post('described', [
    'photo:',
    '  - url: /uploads/2026/10/a.jpg',
    `    alt: '${PHOTO_ALT}'`,
    '  - url: /uploads/2026/10/b.jpg',
    '    alt: The second photo',
  ]),
  worded: post('worded', [`like-of: ${VIDEO}`], 'So good.'),
  empty: post('empty', []),
};

async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-untitled-label-content-');
  const files: Record<string, string> = {
    '_data/site.json': JSON.stringify({ title: 'Shll.me', timezone: 'UTC' }),
    '_data/replyContexts.json': JSON.stringify(STORED),
    ...Object.fromEntries(
      Object.entries(POSTS).map(([slug, text]) => [`posts/2026-10-01-${slug}.md`, text]),
    ),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-untitled-label-data-'),
    hostLookup: lookup,
  });
  await cms.replyContexts.settled();
  return cms;
}

function decode(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

interface Head {
  title: string;
  og: string;
  twitter: string;
  headline: unknown;
}

function head(html: string): Head {
  const raw = (pattern: RegExp): string => {
    const found = pattern.exec(html)?.[1];
    assert.ok(found !== undefined, `the page has ${String(pattern)}`);
    assert.doesNotMatch(found, /[<>"]/, 'printed escaped');
    return decode(found);
  };
  const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script !== undefined, 'the page has JSON-LD');
  assert.doesNotMatch(script, /<Official>/, 'the JSON-LD escapes markup');
  const graph = (JSON.parse(script) as { '@graph': Record<string, unknown>[] })['@graph'];
  return {
    title: raw(/<title>([^<]*) &middot; Shll\.me<\/title>/),
    og: raw(/<meta property="og:title" content="([^"]*)">/),
    twitter: raw(/<meta name="twitter:title" content="([^"]*)">/),
    headline: graph.find((node) => node['@type'] === 'BlogPosting')?.['headline'],
  };
}

describe('an untitled post is labelled by what it is (TASK-261)', () => {
  let cms: Cms;
  let agent: Browser;

  before(async () => {
    cms = await site();
    agent = await signedIn(cms);
  });

  async function pageHead(slug: string): Promise<Head> {
    const response = await cms.app.request(`/2026/10/${slug}/`);
    assert.equal(response.status, 200);
    return head(await response.text());
  }

  function every(label: string): Head {
    return { title: label, og: label, twitter: label, headline: label };
  }

  it('heads an untitled like, repost or reply with the verb and the cited title (AC #1)', async () => {
    assert.deepEqual(await pageHead('liked'), every(`Liked ${CITED_NAME}`));
    assert.deepEqual(await pageHead('reposted'), every(`Reposted ${CITED_NAME}`));
    assert.deepEqual(await pageHead('replied'), every('Reply to A thread'));
  });

  it('heads an untitled bookmark of an unread page with its host (AC #1)', async () => {
    assert.deepEqual(await pageHead('bookmarked'), every('Bookmarked a page on unread.example'));
  });

  it('heads a photo post Photo, a post with words by them, and an empty one Untitled (AC #2)', async () => {
    assert.deepEqual(await pageHead('photo'), every('Photo'));
    assert.deepEqual(await pageHead('worded'), every('So good.'));
    assert.deepEqual(await pageHead('empty'), every('Untitled'));
  });

  it('heads a photo post with no words by its first photo’s alt text (TASK-264)', async () => {
    assert.deepEqual(await pageHead('described'), every(PHOTO_ALT));
  });

  it('shows no heading for that alt text, and the kicker still reads Photo (TASK-264)', async () => {
    const html = await (await cms.app.request('/2026/10/described/')).text();
    assert.match(html, /<span class="kicker-kind">Photo<\/span>/);
    assert.doesNotMatch(html, /<h1 class="p-name"/);
    assert.ok(!html.includes('<the>'), 'the alt text is printed escaped');
  });

  it('names a photo post by its alt text in the admin list (TASK-264)', async () => {
    const list = await (await agent.get('/admin/posts')).text();
    assert.ok(list.includes(PHOTO_ALT_ESCAPED), 'the list labels the photo post');
    assert.ok(!list.includes('<the>'), 'the list escapes the alt text');
  });

  it('names a saved photo post by its alt text in the flash (TASK-264)', async () => {
    const token = csrfField(await (await agent.get('/admin/posts/new')).text());
    assert.ok(token !== undefined);
    const response = await agent.post('/admin/posts/new', {
      csrf_token: token,
      'photo-url-0': 'https://peer.example/a.jpg',
      'photo-alt-0': PHOTO_ALT,
      date: '2026-10-02T09:00:00Z',
      action: 'publish',
    });
    assert.equal(response.status, 303);
    const editor = response.headers.get('location');
    assert.equal(editor, '/admin/posts/greg-the-dog-cat');

    const html = await (await agent.get(editor)).text();
    assert.ok(html.includes(`Published: ${PHOTO_ALT_ESCAPED}`), 'the flash labels the photo post');
  });

  it('names the post the same way in the admin list and the editor heading (AC #3)', async () => {
    const list = await (await agent.get('/admin/posts')).text();
    const escaped = `Liked ${CITED_ESCAPED}`;
    assert.ok(list.includes(escaped), 'the list labels the like');
    assert.ok(list.includes('Bookmarked a page on unread.example'));
    assert.ok(list.includes('Reply to A thread'));
    assert.doesNotMatch(list, /<Official>/);

    const editor = await (await agent.get('/admin/posts/liked')).text();
    assert.ok(editor.includes(`Edit post: ${escaped}`), 'the editor heading labels the like');
  });

  it('names a saved like the same way in the flash (AC #3)', async () => {
    const token = csrfField(await (await agent.get('/admin/posts/new')).text());
    assert.ok(token !== undefined);
    const response = await agent.post('/admin/posts/new', {
      csrf_token: token,
      'like-of': VIDEO,
      date: '2026-10-02T09:00:00Z',
      action: 'publish',
    });
    assert.equal(response.status, 303);
    const editor = response.headers.get('location');
    assert.ok(editor !== null);

    const html = await (await agent.get(editor)).text();
    assert.ok(
      html.includes(`Published: Liked ${CITED_ESCAPED}`),
      'the flash labels the like it saved',
    );
  });

  it('names the post the same way in a flash message (AC #3)', async () => {
    const token = csrfField(await (await agent.get('/admin/posts')).text());
    assert.ok(token !== undefined);
    const response = await agent.post('/admin/posts/reposted', {
      csrf_token: token,
      action: 'trash',
    });
    assert.equal(response.status, 303);

    const listing = await (await agent.get('/admin/posts?status=trash')).text();
    assert.ok(
      listing.includes(`Moved to the trash: Reposted ${CITED_ESCAPED}`),
      'the flash labels the repost',
    );
  });
});
