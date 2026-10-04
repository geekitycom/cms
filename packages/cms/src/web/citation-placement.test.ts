import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { mf2 } from 'microformats-parser';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const TARGET = 'https://them.example/2026/09/their-post/';
const CITE =
  /<div class="reply-context cite u-(?:in-reply-to|like-of|repost-of|bookmark-of) h-cite">/;

const KINDS = [
  { kind: 'bookmark', property: 'bookmark-of' },
  { kind: 'like', property: 'like-of' },
  { kind: 'repost', property: 'repost-of' },
  { kind: 'reply', property: 'in-reply-to' },
] as const;

interface Post {
  slug: string;
  day: string;
  title?: string;
  property?: string;
  /** No description and no words, only the title and the citation (TASK-256). */
  bare?: boolean;
  /** A title that only repeats the opening words, so it is no heading. */
  echo?: boolean;
}

const BARE_KINDS = KINDS.filter(({ kind }) => kind !== 'reply');

const POSTS: Post[] = [
  ...KINDS.map(({ kind, property }, index) => ({
    slug: `titled-${kind}`,
    day: String(10 + index),
    title: `A titled ${kind}`,
    property,
  })),
  ...KINDS.map(({ kind, property }, index) => ({
    slug: `untitled-${kind}`,
    day: String(20 + index),
    property,
  })),
  { slug: 'untitled-note', day: '25' },
  ...BARE_KINDS.map(({ kind, property }, index) => ({
    slug: `bare-${kind}`,
    day: String(27 + index),
    title: `A bare ${kind}`,
    property,
    bare: true,
  })),
  { slug: 'echo-note', day: '26', title: 'The words of echo-note', echo: true },
];

function file({ slug, day, title, property, bare, echo }: Post): string {
  const described = title !== undefined && bare !== true && echo !== true;
  return [
    '---',
    ...(title === undefined ? [] : [`title: ${title}`]),
    ...(described ? [`description: Why ${slug} is worth it.`] : []),
    `date: '2026-09-${day}T09:00:00Z'`,
    `permalink: /2026/09/${slug}/`,
    ...(property === undefined ? [] : [`${property}: ${TARGET}`]),
    '---',
    '',
    ...(bare === true ? [] : [`The words of ${slug}.`]),
    '',
  ].join('\n');
}

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-citation-placement-content-');
  const dataDir = await box.dir('geekity-citation-placement-data-');
  const files: Record<string, string> = {
    '_data/site.json': JSON.stringify({ title: 'A Site', postsPerPage: 20 }),
    ...Object.fromEntries(POSTS.map((post) => [`posts/${post.slug}.md`, file(post)])),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    cms = await box.open({ contentDir, dataDir, baseUrl: BASE });
    await cms.replyContexts.settled();
  } finally {
    console.warn = warn;
  }
});

async function get(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

function article(html: string, slug?: string): string {
  const all = [...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map((match) => match[0]);
  const found = slug === undefined ? all[0] : all.find((one) => one.includes(`/2026/09/${slug}/`));
  assert.ok(found !== undefined, `found the article for ${slug ?? 'the page'}`);
  return found;
}

function at(html: string, ...patterns: RegExp[]): number[] {
  return patterns.map((pattern) => html.search(pattern));
}

function ascending(positions: number[], message: string): void {
  assert.ok(
    positions.every((position) => position >= 0),
    `${message}: all present (${positions.join(', ')})`,
  );
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    `${message}: in order (${positions.join(', ')})`,
  );
}

describe('a titled post’s citation on its page', () => {
  for (const { kind } of KINDS) {
    it(`prints a titled ${kind}’s header, then its citation, then its words`, async () => {
      const html = article(await get(`/2026/09/titled-${kind}/`));
      ascending(
        at(html, /<header class="post-header">/, /<\/header>/, CITE, /class="e-content"/),
        `titled ${kind}`,
      );
    });
  }
});

describe('an untitled post’s citation on its page', () => {
  for (const { kind } of KINDS) {
    it(`opens an untitled ${kind} on its kicker and citation, then its words`, async () => {
      const html = article(await get(`/2026/09/untitled-${kind}/`));
      ascending(at(html, /class="kicker"/, CITE, /class="e-content"/), `untitled ${kind}`);
      assert.doesNotMatch(html, /<header class="post-header">/);
    });
  }

  it('opens an untitled note on its kicker and words, citing nothing', async () => {
    const html = article(await get('/2026/09/untitled-note/'));
    ascending(at(html, /class="kicker"/, /class="e-content"/), 'untitled note');
    assert.doesNotMatch(html, CITE);
  });
});

describe('a titled post with no words (TASK-256)', () => {
  for (const { kind } of BARE_KINDS) {
    it(`heads a titled ${kind} with no words by its title, then its citation`, async () => {
      const html = article(await get(`/2026/09/bare-${kind}/`));
      ascending(
        at(
          html,
          /<header class="post-header">/,
          new RegExp(`<h1 class="p-name">A bare ${kind}</h1>`),
          /<\/header>/,
          CITE,
          /class="e-content"/,
        ),
        `bare ${kind}`,
      );
      assert.doesNotMatch(html, /screen-reader-text/);
    });

    it(`lists a titled ${kind} with no words by its title, then its citation`, async () => {
      const html = article(await get('/'), `bare-${kind}`);
      ascending(
        at(
          html,
          /class="kicker"/,
          new RegExp(`class="feed-title p-name">\\s*<a [^>]*>A bare ${kind}</a>`),
          CITE,
          /class="feed-more"/,
        ),
        `listed bare ${kind}`,
      );
    });
  }

  it('gives a note whose title only repeats its words no heading', async () => {
    const page = article(await get('/2026/09/echo-note/'));
    assert.doesNotMatch(page, /<header class="post-header">/);
    assert.match(page, /<h1 class="screen-reader-text">\s*Note/);
    const listed = article(await get('/'), 'echo-note');
    assert.doesNotMatch(listed, /class="feed-title/);
    assert.match(listed, /class="feed-excerpt e-content"/);
  });
});

describe('a titled post with no words in the feeds (TASK-256)', () => {
  function block(xml: string, tag: string, slug: string): string {
    const found = [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'))]
      .map((match) => match[0])
      .find((one) => one.includes(`/2026/09/${slug}/`));
    assert.ok(found !== undefined, `the feed has ${slug}`);
    return found;
  }

  for (const { kind } of BARE_KINDS) {
    it(`titles a titled ${kind} with no words in RSS, Atom and JSON Feed`, async () => {
      assert.match(
        block(await get('/feed/'), 'item', `bare-${kind}`),
        new RegExp(`<title>A bare ${kind}</title>`),
      );
      assert.match(
        block(await get('/feed/atom/'), 'entry', `bare-${kind}`),
        new RegExp(`<title>A bare ${kind}</title>`),
      );
      const feed = JSON.parse(await get('/feed/json/')) as {
        items: { url: string; title?: string }[];
      };
      const item = feed.items.find((one) => one.url.endsWith(`/2026/09/bare-${kind}/`));
      assert.equal(item?.title, `A bare ${kind}`);
    });
  }

  it('gives a note whose title only repeats its words no feed title', async () => {
    assert.doesNotMatch(block(await get('/feed/'), 'item', 'echo-note'), /<title>/);
    assert.match(block(await get('/feed/atom/'), 'entry', 'echo-note'), /<title><\/title>/);
    const feed = JSON.parse(await get('/feed/json/')) as {
      items: { url: string; title?: string }[];
    };
    const item = feed.items.find((one) => one.url.endsWith('/2026/09/echo-note/'));
    assert.ok(item !== undefined);
    assert.equal('title' in item, false);
  });
});

describe('citations in a listing', () => {
  for (const { kind } of KINDS) {
    it(`lists a titled ${kind} by its title and summary, then its citation`, async () => {
      const html = article(await get('/'), `titled-${kind}`);
      ascending(
        at(
          html,
          /class="kicker"/,
          /class="feed-title p-name"/,
          /class="feed-excerpt p-summary"/,
          CITE,
          /class="feed-more"/,
        ),
        `listed titled ${kind}`,
      );
    });

    it(`lists an untitled ${kind} with its citation above its words`, async () => {
      const html = article(await get('/'), `untitled-${kind}`);
      ascending(
        at(html, /class="kicker"/, CITE, /class="feed-excerpt e-content"/),
        `listed untitled ${kind}`,
      );
    });
  }
});

interface Item {
  type: string[];
  properties: Record<string, unknown[]>;
  children?: Item[];
}

function entries(html: string, url: string): Item[] {
  const found: Item[] = [];
  const visit = (item: Item): void => {
    if (item.type.includes('h-entry')) found.push(item);
    for (const child of item.children ?? []) visit(child);
  };
  for (const item of mf2(html, { baseUrl: url }).items as Item[]) visit(item);
  return found;
}

function expected(
  { slug, title, property, bare, echo }: Post,
  listed: boolean,
): Record<string, unknown> {
  const heading = title !== undefined && echo !== true;
  const keys = ['published', 'url'];
  if (heading) keys.push('name');
  if (heading && bare !== true) keys.push('summary');
  if (property !== undefined) keys.push(property);
  if (!listed || !heading) keys.push('content');
  return {
    keys: keys.sort(),
    url: `${BASE}/2026/09/${slug}/`,
    name: heading ? [title] : undefined,
    cited: property === undefined ? undefined : [TARGET],
  };
}

function read(entry: Item, { property }: Post): Record<string, unknown> {
  const cites = property === undefined ? undefined : entry.properties[property];
  return {
    keys: Object.keys(entry.properties).sort(),
    url: String(entry.properties['url']?.[0]),
    name: entry.properties['name'],
    cited: cites?.map((value) => {
      const cite = value as Item;
      assert.ok(cite.type.includes('h-cite'), `${String(property)} is an h-cite`);
      return String(cite.properties['url']?.[0]);
    }),
  };
}

describe('what a parser reads', () => {
  for (const post of POSTS) {
    it(`reads ${post.slug}’s h-entry the same on its page`, async () => {
      const url = `${BASE}/2026/09/${post.slug}/`;
      const found = entries(await get(`/2026/09/${post.slug}/`), url);
      assert.equal(found.length, 1);
      assert.deepEqual(read(found[0]!, post), expected(post, false));
    });
  }

  it('reads every listed h-entry the same', async () => {
    const listed = entries(await get('/'), `${BASE}/`);
    assert.equal(listed.length, POSTS.length);
    for (const post of POSTS) {
      const entry = listed.find(
        (one) => String(one.properties['url']?.[0]) === `${BASE}/2026/09/${post.slug}/`,
      );
      assert.ok(entry !== undefined, `${post.slug} is listed`);
      assert.deepEqual(read(entry, post), expected(post, true));
    }
  });
});
