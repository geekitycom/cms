/**
 * A post that shows a title prints its header first and what it cites or
 * answers after it, before its words; a post with no title opens on the
 * citation (TASK-241). Moving the markup changes nothing a microformats parser
 * reads. Asserted over HTTP against the packaged theme, because the markup is
 * the behaviour.
 */
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
}

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
];

function file({ slug, day, title, property }: Post): string {
  return [
    '---',
    ...(title === undefined ? [] : [`title: ${title}`]),
    ...(title === undefined ? [] : [`description: Why ${slug} is worth it.`]),
    `date: '2026-09-${day}T09:00:00Z'`,
    `permalink: /2026/09/${slug}/`,
    ...(property === undefined ? [] : [`${property}: ${TARGET}`]),
    '---',
    '',
    `The words of ${slug}.`,
    '',
  ].join('\n');
}

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-citation-placement-content-');
  const dataDir = await box.dir('geekity-citation-placement-data-');
  const files: Record<string, string> = {
    '_data/site.json': JSON.stringify({ title: 'A Site', paginate: 20 }),
    ...Object.fromEntries(POSTS.map((post) => [`posts/${post.slug}.md`, file(post)])),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }
  // The replies' target is not a public address, so fetching its context warns.
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

/** The `<article>` on a page, or in a listing the one that links to the slug. */
function article(html: string, slug?: string): string {
  const all = [...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map((match) => match[0]);
  const found = slug === undefined ? all[0] : all.find((one) => one.includes(`/2026/09/${slug}/`));
  assert.ok(found !== undefined, `found the article for ${slug ?? 'the page'}`);
  return found;
}

/** Where each pattern first matches, in the order given; -1 when it does not. */
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

/** What a parser should read from a post's h-entry, wherever its citation sits. */
function expected({ slug, title, property }: Post, listed: boolean): Record<string, unknown> {
  const keys = ['published', 'url'];
  if (title !== undefined) keys.push('name', 'summary');
  if (property !== undefined) keys.push(property);
  if (!listed || title === undefined) keys.push('content');
  return {
    keys: keys.sort(),
    url: `${BASE}/2026/09/${slug}/`,
    name: title === undefined ? undefined : [title],
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
