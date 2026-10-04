import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { mf2 } from 'microformats-parser';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';

const box = sandbox();

const ENTRY = 'https://them.example/2026/09/tomatoes/';
const TITLED = 'http://scripting.example/';
const OG = 'https://og.example/page';
const VIDEO = 'https://video.example/watch?v=1';
const VIDEO_OEMBED = 'https://video.example/oembed?url=1';
const DOWN = 'https://down.example/post';
const MOVED = 'https://other.example/beans/';
const HOSTILE = 'https://hostile.example/post';
const SOUND = 'https://sound.example/forss/flickermood';
const SOUND_LOWER = 'https://sound.example/forss/lower';
const RICK = 'https://video.example/watch?v=dQw4w9WgXcQ';
const SCRIPTING = 'http://scripting.example/2026/10/03/225649.html';

function oembedPage(
  page: string,
  oembed: Record<string, string>,
): Record<string, { type: string; body: string }> {
  const endpoint = `${page}/oembed`;
  return {
    [page]: {
      type: 'text/html',
      body: `<link rel="alternate" type="application/json+oembed" href="${endpoint}">`,
    },
    [endpoint]: { type: 'application/json', body: JSON.stringify(oembed) },
  };
}

const PAGES: Record<string, { type: string; body: string }> = {
  ...oembedPage(SOUND, {
    title: 'Flickermood by Forss',
    author_name: 'Forss',
    author_url: 'https://sound.example/forss',
  }),
  ...oembedPage(SOUND_LOWER, { title: 'Flickermood By Forss ', author_name: 'forss' }),
  ...oembedPage(RICK, {
    title: 'Rick Astley - Never Gonna Give You Up',
    author_name: 'Rick Astley',
    author_url: 'https://video.example/@rick',
  }),
  [ENTRY]: {
    type: 'text/html',
    body: `<article class="h-entry">
      <h1 class="p-name">Growing tomatoes</h1>
      <a class="p-author h-card" href="https://them.example/">Pat Them</a>
      <div class="e-content"><p>Tomatoes want sun.</p></div>
    </article>`,
  },
  [TITLED]: { type: 'text/html', body: '<title>Scripting News</title>' },
  [OG]: { type: 'text/html', body: '<meta property="og:title" content="Shared title">' },
  [VIDEO]: {
    type: 'text/html',
    body: `<title>- Video</title>
      <link rel="alternate" type="application/json+oembed" href="/oembed?url=1">`,
  },
  [VIDEO_OEMBED]: {
    type: 'application/json',
    body: JSON.stringify({
      type: 'video',
      title: 'How to grow beans',
      author_name: 'Sam Video',
      author_url: 'https://video.example/@sam',
      html: '<iframe src="https://video.example/embed/1"></iframe>',
    }),
  },
  [MOVED]: { type: 'text/html', body: '<title>Growing beans</title>' },
  [SCRIPTING]: {
    type: 'text/html',
    body: `<title>Scripting News: RSS tip #2</title>
      <meta property="og:title" content="RSS tip #2">
      <meta property="og:site_name" content="Scripting News">
      <meta property="og:description" content="A site-wide bio, not the post.">
      <meta name="description" content="A site-wide bio, not the post.">
      <meta name="twitter:card" content="summary_large_image">`,
  },
  [HOSTILE]: {
    type: 'text/html',
    body: `<article class="h-entry">
      <h1 class="p-name">&lt;script&gt;alert(1)&lt;/script&gt;</h1>
      <a class="p-author h-card" href="javascript:alert(2)">&quot;&gt;&lt;img src=x onerror=alert(3)&gt;</a>
      <div class="e-content"><p>Hi</p></div>
    </article>`,
  },
};

const fetched: string[] = [];

const lookup: HostLookup = () => Promise.resolve(['203.0.113.7']);

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  const url = new Request(input).url;
  fetched.push(url);
  const page = PAGES[url];
  if (page === undefined) return Promise.reject(new TypeError('fetch failed'));
  return Promise.resolve(new Response(page.body, { headers: { 'content-type': page.type } }));
}) as typeof fetch;

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
});

beforeEach(() => {
  fetched.length = 0;
});

function post(name: string, property: string | undefined, target?: string): string {
  return [
    '---',
    "date: '2026-09-10T09:00:00Z'",
    `permalink: /2026/09/${name}/`,
    ...(property === undefined ? [] : [`${property}: ${target ?? ''}`]),
    '---',
    '',
    `The post called ${name}.`,
    '',
  ].join('\n');
}

async function site(files: Record<string, string>): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await box.dir('geekity-citation-context-content-');
  const dataDir = await box.dir('geekity-citation-context-data-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const cms = await box.open({ contentDir, dataDir, hostLookup: lookup });
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

function cite(html: string, property: string): string | undefined {
  return new RegExp(`<div class="reply-context cite u-${property} h-cite">[\\s\\S]*?</div>`).exec(
    html,
  )?.[0];
}

function entry(html: string, name: string): string {
  const items = html.split('<article class="feed-item h-entry"');
  const found = items.find((each) => each.includes(`href="/2026/09/${name}/"`));
  assert.ok(found !== undefined, `the listing has ${name}`);
  return found;
}

async function stored(contentDir: string): Promise<Record<string, unknown>> {
  const text = await readFile(path.join(contentDir, '_data', 'replyContexts.json'), 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

const POSTS = {
  'liked-entry': ['like-of', ENTRY],
  'bookmarked-title': ['bookmark-of', TITLED],
  'reposted-og': ['repost-of', OG],
  'liked-video': ['like-of', VIDEO],
  'bookmarked-down': ['bookmark-of', DOWN],
  'reposted-hostile': ['repost-of', HOSTILE],
} as const;

describe('a like, a repost or a bookmark names what it cites', () => {
  let cms: Cms;
  let contentDir: string;
  let front: string;

  before(async () => {
    ({ cms, contentDir } = await site({
      '_data/site.json': JSON.stringify({ title: 'A Site', timezone: 'UTC' }),
      ...Object.fromEntries(
        Object.entries(POSTS).map(([name, [property, target]]) => [
          `posts/2026-09-10-${name}.md`,
          post(name, property, target),
        ]),
      ),
    }));
    front = await get(cms, '/');
  });

  for (const where of ['page', 'listing'] as const) {
    const read = async (name: string, property: string): Promise<string> => {
      const html = where === 'page' ? await get(cms, `/2026/09/${name}/`) : entry(front, name);
      const citation = cite(html, property);
      assert.ok(citation !== undefined, `the ${where} cites ${name}`);
      return citation;
    };

    it(`names an h-entry target and its author, in the ${where}`, async () => {
      const citation = await read('liked-entry', 'like-of');

      assert.match(
        citation,
        new RegExp(`Liked <a class="u-url p-name" href="${ENTRY}">Growing tomatoes</a>`),
      );
      assert.match(
        citation,
        / by <span class="p-author h-card"><a class="u-url p-name" href="https:\/\/them.example\/">Pat Them<\/a><\/span>/,
      );
    });

    it(`names a target by its <title>, in the ${where}`, async () => {
      const citation = await read('bookmarked-title', 'bookmark-of');

      assert.match(
        citation,
        /Bookmarked <a class="u-url p-name" href="http:\/\/scripting.example\/">Scripting News<\/a>/,
      );
      assert.doesNotMatch(citation, /p-author/);
    });

    it(`names a target by its og:title, in the ${where}`, async () => {
      const citation = await read('reposted-og', 'repost-of');

      assert.match(
        citation,
        new RegExp(`Reposted <a class="u-url p-name" href="${OG}">Shared title</a>`),
      );
    });

    it(`names a target by its oEmbed title and author, in the ${where}`, async () => {
      const citation = await read('liked-video', 'like-of');

      assert.match(
        citation,
        /Liked <a class="u-url p-name" href="https:\/\/video.example\/watch\?v=1">How to grow beans<\/a>/,
      );
      assert.match(
        citation,
        /<span class="p-author h-card"><a class="u-url p-name" href="https:\/\/video.example\/@sam">Sam Video<\/a><\/span>/,
      );
      assert.doesNotMatch(citation, /- Video/);
    });

    it(`names the host, never the bare URL, when no title was found, in the ${where}`, async () => {
      const citation = await read('bookmarked-down', 'bookmark-of');

      assert.match(
        citation,
        new RegExp(`Bookmarked <a class="u-url" href="${DOWN}">a page on down\\.example</a>`),
      );
      assert.doesNotMatch(citation, /p-name|p-author/);
    });
  }

  it('prints the target’s words as text, so its markup cannot reach the page', async () => {
    const citation = cite(await get(cms, '/2026/09/reposted-hostile/'), 'repost-of') ?? '';

    assert.match(citation, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(citation, /&quot;&gt;&lt;img src=x onerror=alert\(3\)&gt;/);
    assert.doesNotMatch(citation, /<script|<img|javascript:/);
  });

  it('never prints the oEmbed html', async () => {
    for (const html of [await get(cms, '/2026/09/liked-video/'), front]) {
      assert.doesNotMatch(html, /<iframe|video.example\/embed/);
    }
    assert.doesNotMatch(JSON.stringify(await stored(contentDir)), /iframe|embed\/1/);
  });

  it('keeps what it read in the reply contexts file, keyed by the target', async () => {
    const contexts = await stored(contentDir);

    assert.deepEqual(Object.keys(contexts).sort(), [ENTRY, HOSTILE, OG, TITLED, VIDEO].sort());
    assert.deepEqual(contexts[VIDEO], {
      url: VIDEO,
      name: 'How to grow beans',
      author: { name: 'Sam Video', url: 'https://video.example/@sam' },
    });
  });

  it('serves every citation without a fetch', async () => {
    for (const name of Object.keys(POSTS)) await get(cms, `/2026/09/${name}/`);
    await get(cms, '/');

    assert.deepEqual(fetched, []);
  });
});

describe('a citation whose target changes', () => {
  it('reads the new target, and forgets the old one when nothing cites it', async () => {
    const { cms, contentDir } = await site({
      'posts/2026-09-10-liked.md': post('liked', 'like-of', TITLED),
    });
    const file = path.join(contentDir, 'posts', '2026-09-10-liked.md');

    await writeFile(file, post('liked', 'like-of', MOVED), 'utf8');
    await cms.sync();
    await cms.replyContexts.settled();

    assert.match(cite(await get(cms, '/2026/09/liked/'), 'like-of') ?? '', />Growing beans<\/a>/);
    assert.deepEqual(Object.keys(await stored(contentDir)), [MOVED]);

    await writeFile(file, post('liked', undefined), 'utf8');
    await cms.sync();
    await cms.replyContexts.settled();

    assert.deepEqual(await stored(contentDir), {});
  });

  it('keeps a target a reply still answers when a bookmark of it goes', async () => {
    const { cms, contentDir } = await site({
      'posts/2026-09-10-reply.md': post('reply', 'in-reply-to', ENTRY),
      'posts/2026-09-10-saved.md': post('saved', 'bookmark-of', ENTRY),
    });

    await writeFile(
      path.join(contentDir, 'posts', '2026-09-10-saved.md'),
      post('saved', undefined),
    );
    await cms.sync();
    await cms.replyContexts.settled();

    assert.deepEqual(Object.keys(await stored(contentDir)), [ENTRY]);
  });

  it('fetches a cited target the file lacks when the site catches up', async () => {
    const { cms, contentDir } = await site({
      'posts/2026-09-10-saved.md': post('saved', 'bookmark-of', TITLED),
    });
    await rm(path.join(contentDir, '_data', 'replyContexts.json'));
    fetched.length = 0;

    await cms.sync();
    await cms.replyContexts.settled();
    assert.deepEqual(fetched, [], 'an up-to-date index reports no change to act on');

    cms.replyContexts.catchUp();
    await cms.replyContexts.settled();

    assert.deepEqual(fetched, [TITLED]);
    assert.match(
      cite(await get(cms, '/2026/09/saved/'), 'bookmark-of') ?? '',
      />Scripting News<\/a>/,
    );
  });

  it('does not fetch again when the index is rebuilt from the same files', async () => {
    const { contentDir } = await site({
      'posts/2026-09-10-saved.md': post('saved', 'bookmark-of', TITLED),
    });
    fetched.length = 0;

    const rebuilt = await box.open({
      contentDir,
      dataDir: await box.dir('geekity-citation-context-rebuilt-'),
      hostLookup: lookup,
    });
    await rebuilt.replyContexts.settled();

    assert.deepEqual(fetched, []);
  });
});

describe('a citation whose title already names its author', () => {
  let page: (name: string) => Promise<string>;

  before(async () => {
    const { cms } = await site({
      'posts/2026-09-10-sound.md': post('sound', 'like-of', SOUND),
      'posts/2026-09-10-lower.md': post('lower', 'like-of', SOUND_LOWER),
      'posts/2026-09-10-rick.md': post('rick', 'like-of', RICK),
    });
    page = (name) => get(cms, `/2026/09/${name}/`);
  });

  const seen = (citation: string): string =>
    citation
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  function likeOf(html: string, url: string): { name: unknown; url: unknown; author: unknown } {
    const entry = mf2(html, { baseUrl: url }).items.find((item) => item.type?.includes('h-entry'));
    const cite = entry?.properties['like-of']?.[0] as
      { properties: Record<string, unknown[]> } | undefined;
    assert.ok(cite !== undefined, 'the post has a like-of h-cite');
    const author = cite.properties['author']?.[0] as
      { type: string[]; properties: Record<string, unknown[]> } | undefined;
    return {
      name: cite.properties['name'],
      url: cite.properties['url'],
      author: author === undefined ? undefined : { type: author.type, ...author.properties },
    };
  }

  it('does not print the author again after a title ending in “by” them', async () => {
    const html = await page('sound');
    const citation = cite(html, 'like-of') ?? '';

    assert.equal(seen(citation), 'Liked Flickermood by Forss');
    assert.match(
      citation,
      /<a class="u-url p-name" href="https:\/\/sound.example\/forss">Forss<\/a>/,
    );
    assert.deepEqual(likeOf(html, 'https://example.com/2026/09/sound/'), {
      name: ['Flickermood by Forss'],
      url: [SOUND],
      author: { type: ['h-card'], name: ['Forss'], url: ['https://sound.example/forss'] },
    });
  });

  it('matches the author whatever the case, and prints the title’s own words', async () => {
    const html = await page('lower');

    assert.equal(seen(cite(html, 'like-of') ?? ''), 'Liked Flickermood By Forss');
    assert.deepEqual(likeOf(html, 'https://example.com/2026/09/lower/').author, {
      type: ['h-card'],
      name: ['Forss'],
    });
  });

  it('keeps the author of a title that names them anywhere but its end', async () => {
    const citation = cite(await page('rick'), 'like-of') ?? '';

    assert.equal(seen(citation), 'Liked Rick Astley - Never Gonna Give You Up by Rick Astley');
  });

  it('names the author once in a listing too', async () => {
    const { cms } = await site({ 'posts/2026-09-10-sound.md': post('sound', 'like-of', SOUND) });

    assert.equal(
      seen(cite(entry(await get(cms, '/'), 'sound'), 'like-of') ?? ''),
      'Liked Flickermood by Forss',
    );
  });
});

describe('a citation of a page that names its site but no author', () => {
  let cms: Cms;

  before(async () => {
    ({ cms } = await site({
      'posts/2026-09-10-tip.md': post('tip', 'bookmark-of', SCRIPTING),
      'posts/2026-09-10-liked-tip.md': post('liked-tip', 'like-of', SCRIPTING),
    }));
  });

  const seen = (citation: string): string =>
    citation
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  it('reads as the title and the site, on the page and in the listing', async () => {
    const front = await get(cms, '/');
    for (const [name, property, verb] of [
      ['tip', 'bookmark-of', 'Bookmarked'],
      ['liked-tip', 'like-of', 'Liked'],
    ] as const) {
      for (const html of [await get(cms, `/2026/09/${name}/`), entry(front, name)]) {
        const citation = cite(html, property) ?? '';

        assert.equal(seen(citation), `${verb} RSS tip #2 · Scripting News`);
        assert.match(citation, / · <span class="cite-site">Scripting News<\/span>/);
        assert.doesNotMatch(citation, /h-card|p-author|bio/);
      }
    }
  });

  it('marks the site up as no author', async () => {
    const html = await get(cms, '/2026/09/tip/');
    const entryItem = mf2(html, { baseUrl: 'https://example.com/2026/09/tip/' }).items.find(
      (item) => item.type?.includes('h-entry'),
    );
    const bookmark = entryItem?.properties['bookmark-of']?.[0] as
      { properties: Record<string, unknown[]> } | undefined;

    assert.ok(bookmark !== undefined);
    assert.deepEqual(bookmark.properties['name'], ['RSS tip #2']);
    assert.equal(bookmark.properties['author'], undefined);
  });

  it('reads the same in the feeds, without the description', async () => {
    const feed = (await (await cms.app.request('/feed/json/')).json()) as {
      items: { url: string; content_html: string }[];
    };
    const tip = feed.items.find((item) => item.url.endsWith('/2026/09/tip/'));

    assert.match(
      tip?.content_html ?? '',
      /^<p class="cite-line">Bookmarked <a href="http:\/\/scripting\.example\/2026\/10\/03\/225649\.html">RSS tip #2<\/a> · Scripting News<\/p>/,
    );
    assert.doesNotMatch(tip?.content_html ?? '', /bio/);
  });
});
