import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { mf2 } from 'microformats-parser';

import { gifWithMetadata, jpegWithMetadata, leakedSecrets } from '../__testing__/metadata.ts';
import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';

const box = sandbox();

const GIPHY = 'https://giphy.com/gifs/theinnernette-happy-dance-3o7TKSjRrfIPjeiVyM';
const GIPHY_OEMBED = 'https://giphy.com/services/oembed';
const GIF = 'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const YOUTUBE_OEMBED = 'https://www.youtube.com/oembed';
const THUMBNAIL = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
const ARTICLE = 'https://them.example/2026/09/beans/';
const ARTICLE_IMAGE = 'https://cdn.them.example/beans.jpg';
const BROKEN = 'https://broken.example/post';
const HUGE = 'https://huge.example/post';
const WORDS = 'https://words.example/post';

const UPLOAD_MAX_BYTES = 200_000;

let gif: Uint8Array;
let jpeg: Uint8Array;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

function html(body: string): Response {
  return new Response(body, { headers: { 'content-type': 'text/html' } });
}

function answer(url: URL): Response {
  const bare = `${url.origin}${url.pathname}`;
  switch (bare) {
    case GIPHY_OEMBED:
      return json({
        type: 'photo',
        title: 'Happy Dance GIF by Nette - Find & Share on GIPHY',
        author_name: 'Nette',
        author_url: 'https://giphy.com/theinnernette',
        url: GIF,
        width: 40,
        height: 20,
      });
    case YOUTUBE_OEMBED:
      return json({
        type: 'video',
        title: 'Never Gonna Give You Up',
        author_name: 'Rick Astley',
        thumbnail_url: THUMBNAIL,
        html: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      });
    case GIF:
      return new Response(gif, { headers: { 'content-type': 'image/gif' } });
    case THUMBNAIL:
    case ARTICLE_IMAGE:
      return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
    case ARTICLE:
      return html(
        `<title>Growing beans</title><meta property="og:image" content="${ARTICLE_IMAGE}">`,
      );
    case BROKEN:
      return html(
        '<title>Broken picture</title><meta property="og:image" content="https://broken.example/gone.jpg">',
      );
    case HUGE:
      return html(
        '<title>Huge picture</title><meta property="og:image" content="https://huge.example/huge.gif">',
      );
    case 'https://huge.example/huge.gif':
      return new Response(new Uint8Array([...gif, ...new Uint8Array(UPLOAD_MAX_BYTES)]), {
        headers: { 'content-type': 'image/gif' },
      });
    case WORDS:
      return html('<title>Only words</title>');
    default:
      return new Response('gone', { status: 404 });
  }
}

const fetched: string[] = [];
const lookup: HostLookup = () => Promise.resolve(['203.0.113.7']);

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  const url = new Request(input).url;
  fetched.push(url);
  return Promise.resolve(answer(new URL(url)));
}) as typeof fetch;

const warn = console.warn;

before(async () => {
  gif = await gifWithMetadata();
  jpeg = await jpegWithMetadata();
  console.warn = () => undefined;
});

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
  console.warn = warn;
});

beforeEach(() => {
  fetched.length = 0;
});

function post(name: string, property: string | undefined, target?: string, extra = ''): string {
  return [
    '---',
    "date: '2026-09-10T09:00:00Z'",
    `permalink: /2026/09/${name}/`,
    ...(property === undefined ? [] : [`${property}: ${target ?? ''}`]),
    ...(extra === '' ? [] : [extra]),
    '---',
    '',
    `The post called ${name}.`,
    '',
  ].join('\n');
}

async function site(files: Record<string, string>): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await box.dir('geekity-cited-picture-content-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-cited-picture-data-'),
    hostLookup: lookup,
    uploadMaxBytes: UPLOAD_MAX_BYTES,
  });
  await cms.replyContexts.settled();
  return { cms, contentDir };
}

async function get(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

function cite(page: string, property: string): string {
  const found = new RegExp(
    `<div class="reply-context cite u-${property} h-cite[^"]*">[\\s\\S]*?</div>`,
  ).exec(page)?.[0];
  assert.ok(found !== undefined, `the page cites under ${property}`);
  return found;
}

function entry(listing: string, name: string): string {
  const found = listing
    .split('<article class="feed-item h-entry"')
    .find((each) => each.includes(`href="/2026/09/${name}/"`));
  assert.ok(found !== undefined, `the listing has ${name}`);
  return found;
}

function images(fragment: string): string[] {
  return [...fragment.matchAll(/<(?:img|source)\b[^>]*>/g)].map((match) => match[0]);
}

function addressesIn(fragment: string): string[] {
  return [...fragment.matchAll(/\s(?:src|srcset)="([^"]*)"/g)].flatMap((match) =>
    (match[1] ?? '').split(',').map((candidate) => candidate.trim().split(' ')[0] ?? ''),
  );
}

async function cited(contentDir: string): Promise<string[]> {
  try {
    return (await readdir(path.join(contentDir, 'uploads', 'cited'))).sort();
  } catch {
    return [];
  }
}

async function stored(contentDir: string): Promise<Record<string, Record<string, unknown>>> {
  const text = await readFile(path.join(contentDir, '_data', 'replyContexts.json'), 'utf8');
  return JSON.parse(text) as Record<string, Record<string, unknown>>;
}

const POSTS = {
  'reposted-gif': ['repost-of', GIPHY],
  'liked-video': ['like-of', YOUTUBE],
  'reposted-video': ['repost-of', YOUTUBE],
  'liked-gif': ['like-of', GIPHY],
  'bookmarked-article': ['bookmark-of', ARTICLE],
  'replied-article': ['in-reply-to', ARTICLE],
  'liked-broken': ['like-of', BROKEN],
  'liked-huge': ['like-of', HUGE],
  'liked-words': ['like-of', WORDS],
  'hidden-gif': ['repost-of', GIPHY, 'preview: false'],
} as const;

describe('a cited page’s picture', () => {
  let cms: Cms;
  let contentDir: string;
  let front: string;
  const pages: Record<string, string> = {};

  before(async () => {
    ({ cms, contentDir } = await site({
      '_data/site.json': JSON.stringify({ title: 'A Site', timezone: 'UTC', postsPerPage: 20 }),
      ...Object.fromEntries(
        Object.entries(POSTS).map(([name, [property, target, extra]]) => [
          `posts/2026-09-10-${name}.md`,
          post(name, property, target, extra),
        ]),
      ),
    }));
    for (const name of Object.keys(POSTS)) pages[name] = await get(cms, `/2026/09/${name}/`);
    front = await get(cms, '/');
  });

  for (const where of ['page', 'listing'] as const) {
    const read = (name: string, property: string): string =>
      cite(where === 'page' ? (pages[name] ?? '') : entry(front, name), property);

    it(`shows a reposted GIF in full from the site’s own uploads, in the ${where}`, () => {
      const citation = read('reposted-gif', 'repost-of');

      const [img, ...rest] = images(citation);
      assert.deepEqual(rest, []);
      assert.match(img ?? '', /class="u-photo"/);
      assert.match(img ?? '', /src="\/uploads\/cited\/[0-9a-f]{16}\.gif"/);
      assert.match(img ?? '', /width="40" height="20"/);
      assert.match(img ?? '', /alt="Happy Dance GIF by Nette"/);
      assert.match(
        citation,
        new RegExp(`<a class="cite-photo" href="${GIPHY}"><img class="u-photo"`),
      );
      assert.doesNotMatch(citation, /cite-thumb/);
    });

    it(`shows a liked video’s thumbnail beside its title with a play mark, in the ${where}`, () => {
      const citation = read('liked-video', 'like-of');

      assert.match(
        citation,
        new RegExp(
          `<a class="cite-thumb cite-video" href="${YOUTUBE.replace('?', '\\?')}" tabindex="-1" aria-hidden="true">`,
        ),
      );
      assert.match(
        citation,
        /<img class="u-photo" src="\/uploads\/cited\/[0-9a-f]{16}\.jpg" alt=""/,
      );
      assert.match(
        citation,
        new RegExp(
          `Liked <a class="u-url p-name" href="${YOUTUBE.replace('?', '\\?')}">Never Gonna Give You Up</a>`,
        ),
      );
    });

    it(`shows a thumbnail with no play mark for a page that is not a video, in the ${where}`, () => {
      for (const [name, property] of [
        ['bookmarked-article', 'bookmark-of'],
        ['replied-article', 'in-reply-to'],
      ] as const) {
        const citation = read(name, property);

        assert.match(citation, new RegExp(`<a class="cite-thumb" href="${ARTICLE}"`), name);
        assert.match(citation, /src="\/uploads\/cited\/[0-9a-f]{16}\.jpg"/, name);
        assert.match(
          citation,
          new RegExp(`<a class="u-url p-name" href="${ARTICLE}">Growing beans</a>`),
          name,
        );
      }
    });

    it(`shows a thumbnail, not the full picture, for anything but a repost of a photo, in the ${where}`, () => {
      for (const [name, property] of [
        ['reposted-video', 'repost-of'],
        ['liked-gif', 'like-of'],
      ] as const) {
        const citation = read(name, property);

        assert.match(citation, /<a class="cite-thumb/, name);
        assert.doesNotMatch(citation, /cite-photo/, name);
      }
    });

    it(`leaves a citation as it was when its picture failed, was too big or was never named, in the ${where}`, () => {
      for (const [name, title] of [
        ['liked-broken', 'Broken picture'],
        ['liked-huge', 'Huge picture'],
        ['liked-words', 'Only words'],
      ] as const) {
        const citation = read(name, 'like-of');

        assert.deepEqual(images(citation), [], name);
        assert.match(
          citation,
          new RegExp(
            `^<div class="reply-context cite u-like-of h-cite">\\s*<p class="cite-line small">Liked <a class="u-url p-name" href="[^"]+">${title}</a>\\s*</p>\\s*</div>$`,
          ),
          name,
        );
      }
    });

    it(`shows the plain citation for a post whose preview was removed, in the ${where}`, () => {
      const citation = read('hidden-gif', 'repost-of');

      assert.deepEqual(images(citation), []);
      assert.doesNotMatch(citation, /cite-thumb|cite-photo|cite-with-thumb/);
      assert.equal(
        citation
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
        'Reposted Happy Dance GIF by Nette',
      );
    });
  }

  it('puts the picture inside the h-cite as its photo', () => {
    const items = mf2(pages['reposted-gif'] ?? '', { baseUrl: 'https://site.example/' }).items;
    const post = items.find((item) => item.type?.includes('h-entry'));
    const repost = post?.properties['repost-of']?.[0] as
      { properties: Record<string, unknown[]> } | undefined;

    assert.ok(repost !== undefined);
    assert.deepEqual(repost.properties['url'], [GIPHY]);
    const [photo] = repost.properties['photo'] ?? [];
    assert.match(JSON.stringify(photo), /site\.example\/uploads\/cited\/[0-9a-f]{16}\.gif/);
  });

  it('makes no page ask the cited site or its CDN for anything', async () => {
    const drawn = [await get(cms, '/')];
    for (const name of Object.keys(POSTS)) drawn.push(await get(cms, `/2026/09/${name}/`));
    for (const page of drawn) {
      for (const address of addressesIn(page)) {
        assert.ok(address.startsWith('/'), `${address} is the site’s own`);
      }
      assert.doesNotMatch(page, /<iframe|giphy\.gif|ytimg|cdn\.them\.example/);
    }
    assert.deepEqual(fetched, []);
  });

  it('keeps the copies under uploads/cited, stripped, and records them in the contexts file', async () => {
    const names = await cited(contentDir);
    assert.equal(names.length, 2, names.join(', '));
    for (const name of names) {
      assert.deepEqual(
        leakedSecrets(await readFile(path.join(contentDir, 'uploads', 'cited', name))),
        [],
      );
    }

    const contexts = await stored(contentDir);
    assert.deepEqual(contexts[GIPHY]?.['picture'], {
      src: `/uploads/cited/${names.find((name) => name.endsWith('.gif')) ?? ''}`,
      width: 40,
      height: 20,
      kind: 'photo',
    });
    assert.deepEqual(contexts[YOUTUBE]?.['picture'], {
      src: `/uploads/cited/${names.find((name) => name.endsWith('.jpg')) ?? ''}`,
      width: 40,
      height: 20,
      kind: 'thumbnail',
      video: true,
    });
    assert.equal(contexts[BROKEN]?.['picture'], undefined);
    assert.equal(contexts[HUGE]?.['picture'], undefined);
    assert.equal(contexts[GIPHY]?.['name'], 'Happy Dance GIF by Nette');
  });

  it('leaves the copies out of the media library', async () => {
    const agent = await signedIn(cms);
    const library = await (await agent.get('/admin/media')).text();

    assert.doesNotMatch(library, /uploads\/cited/);
  });

  it('carries the picture in every feed, with absolute addresses', async () => {
    const feeds = [
      await get(cms, '/feed/'),
      await get(cms, '/feed/atom/'),
      await get(cms, '/feed/json/'),
    ];
    for (const feed of feeds) {
      assert.match(feed, /https?:\/\/[^"&]+\/uploads\/cited\/[0-9a-f]{16}\.gif/);
      assert.doesNotMatch(feed, /media\.giphy\.com|ytimg/);
    }

    const items = (JSON.parse(feeds[2] ?? '') as { items: { url: string; content_html: string }[] })
      .items;
    const html = (name: string): string =>
      items.find((item) => item.url.endsWith(`/2026/09/${name}/`))?.content_html ?? '';

    assert.match(
      html('reposted-gif'),
      /Reposted <a href="https:\/\/giphy\.com\/gifs\/[^"]+">Happy Dance GIF by Nette<\/a><\/p>/,
    );
    assert.match(
      html('reposted-gif'),
      /<img src="http[^"]+\/uploads\/cited\/[0-9a-f]{16}\.gif" alt="Happy Dance GIF by Nette" width="40" height="20">/,
    );
    assert.match(
      html('liked-video'),
      /<img src="http[^"]+\/uploads\/cited\/[0-9a-f]{16}\.jpg" alt="" width="40" height="20">/,
    );
    assert.match(
      html('liked-words'),
      /^<p class="cite-line">Liked <a href="https:\/\/words\.example\/post">Only words<\/a><\/p>/,
    );
    assert.doesNotMatch(html('liked-words'), /<img/);
    assert.match(
      html('hidden-gif'),
      /^<p class="cite-line">Reposted <a href="[^"]+">Happy Dance GIF by Nette<\/a><\/p>\n<p>The post/,
    );
    assert.doesNotMatch(html('hidden-gif'), /<img/);
  });
});

describe('a cited picture nobody cites any more', () => {
  it('is deleted with its context, and kept while another post still cites the page', async () => {
    const { cms, contentDir } = await site({
      'posts/2026-09-10-one.md': post('one', 'repost-of', GIPHY),
      'posts/2026-09-10-two.md': post('two', 'like-of', GIPHY),
      'posts/2026-09-10-three.md': post('three', 'like-of', YOUTUBE),
    });
    const both = await cited(contentDir);
    assert.deepEqual(both.map((name) => path.extname(name)).sort(), ['.gif', '.jpg']);

    await writeFile(path.join(contentDir, 'posts', '2026-09-10-one.md'), post('one', undefined));
    await cms.sync();
    await cms.replyContexts.settled();
    assert.deepEqual(await cited(contentDir), both);

    await writeFile(path.join(contentDir, 'posts', '2026-09-10-two.md'), post('two', undefined));
    await writeFile(
      path.join(contentDir, 'posts', '2026-09-10-three.md'),
      post('three', undefined),
    );
    await cms.sync();
    await cms.replyContexts.settled();

    assert.deepEqual(await stored(contentDir), {});
    assert.deepEqual(await cited(contentDir), []);
  });

  it('is swept when the site catches up, when the file no longer names it', async () => {
    const { cms, contentDir } = await site({
      'posts/2026-09-10-one.md': post('one', 'repost-of', GIPHY),
    });
    await mkdir(path.join(contentDir, 'uploads', 'cited'), { recursive: true });
    await writeFile(path.join(contentDir, 'uploads', 'cited', '0000000000000000.gif'), gif);

    cms.replyContexts.catchUp();
    await cms.replyContexts.settled();

    const names = await cited(contentDir);
    assert.equal(names.length, 1);
    assert.notEqual(names[0], '0000000000000000.gif');
  });
});
