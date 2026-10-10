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
const ORIGINAL = 'https://andrew.substack.com/p/on-writing';
const GUEST = 'https://open.substack.com/pub/albexl/p/why-youre-great-at-setting-bad-goals';

function post(slug: string, frontMatter: string[]): string {
  return [
    '---',
    `title: ${slug}`,
    "date: '2026-09-02T09:00:00Z'",
    `permalink: /2026/09/${slug}/`,
    ...frontMatter,
    '---',
    '',
    'Words.',
    '',
  ].join('\n');
}

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', language: 'en', timezone: 'UTC' }),
  'posts/crossposted.md': post('crossposted', [`canonical_href: '${ORIGINAL}'`]),
  'posts/plain-http.md': post('plain-http', ["canonical_href: 'http://old.example/essay'"]),
  'posts/home.md': post('home', []),
  'posts/words.md': post('words', ["canonical_href: 'my substack'"]),
  'posts/relative.md': post('relative', ["canonical_href: '/elsewhere/'"]),
  'posts/mailto.md': post('mailto', ["canonical_href: 'mailto:me@example.com'"]),
  'posts/number.md': post('number', ['canonical_href: 7']),
  'posts/named.md': post('named', [
    `canonical_href: '${GUEST}'`,
    "canonical_name: '  Smarter Engineers '",
  ]),
  'posts/blank-name.md': post('blank-name', [
    `canonical_href: '${ORIGINAL}'`,
    "canonical_name: '  '",
  ]),
  'posts/number-name.md': post('number-name', [
    `canonical_href: '${ORIGINAL}'`,
    'canonical_name: 7',
  ]),
  'posts/name-only.md': post('name-only', ["canonical_name: 'Smarter Engineers'"]),
  'posts/name-bad-href.md': post('name-bad-href', [
    "canonical_href: 'my substack'",
    "canonical_name: 'Smarter Engineers'",
  ]),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-original-content-');
  const dataDir = await box.dir('geekity-original-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE,
    now: () => new Date('2026-09-13T12:00:00Z'),
  });
});

async function page(slug: string, suffix = ''): Promise<string> {
  const response = await cms.app.request(`/2026/09/${slug}/${suffix}`);
  assert.equal(response.status, 200, `${slug}${suffix} is served`);
  return response.text();
}

function canonicalOf(html: string): string | undefined {
  const links = [...html.matchAll(/<link rel="canonical" href="([^"]*)">/g)];
  assert.equal(links.length, 1, 'one canonical link');
  return links[0]?.[1];
}

function ogUrlOf(html: string): string | undefined {
  return /<meta property="og:url" content="([^"]*)">/.exec(html)?.[1];
}

function entryOf(html: string, url: string) {
  const entry = mf2(html, { baseUrl: url }).items.find((item) => item.type?.includes('h-entry'));
  assert.ok(entry !== undefined, 'the page has an h-entry');
  return entry;
}

describe('a post that names its original elsewhere (TASK-293)', () => {
  it('points rel=canonical and og:url at the original', async () => {
    const html = await page('crossposted');

    assert.equal(canonicalOf(html), ORIGINAL);
    assert.equal(ogUrlOf(html), ORIGINAL);
  });

  it('accepts an http original', async () => {
    assert.equal(canonicalOf(await page('plain-http')), 'http://old.example/essay');
  });

  it('says where it was first published, as a u-url of its h-entry after its permalink', async () => {
    const permalink = `${BASE}/2026/09/crossposted/`;
    const html = await page('crossposted');

    assert.match(
      html,
      /Originally published at <a class="u-url" href="https:\/\/andrew\.substack\.com\/p\/on-writing">andrew\.substack\.com<\/a>/,
    );
    const entry = entryOf(html, permalink);
    assert.deepEqual(entry.properties['url'], [permalink, ORIGINAL]);
    assert.equal(entry.properties['syndication'], undefined, 'the original is not a copy');
  });

  it('keeps its own URL as canonical when it names no original', async () => {
    const html = await page('home');

    assert.equal(canonicalOf(html), `${BASE}/2026/09/home/`);
    assert.equal(ogUrlOf(html), `${BASE}/2026/09/home/`);
    assert.doesNotMatch(html, /Originally published/);
  });

  for (const slug of ['words', 'relative', 'mailto', 'number']) {
    it(`ignores a canonical_href that is not an absolute http(s) URL: ${slug}`, async () => {
      const html = await page(slug);

      assert.equal(canonicalOf(html), `${BASE}/2026/09/${slug}/`);
      assert.doesNotMatch(html, /Originally published/);
      assert.deepEqual(entryOf(html, `${BASE}/2026/09/${slug}/`).properties['url'], [
        `${BASE}/2026/09/${slug}/`,
      ]);
    });
  }

  it('names the original by its canonical_name, linking canonical_href (TASK-316)', async () => {
    const permalink = `${BASE}/2026/09/named/`;
    const html = await page('named');

    assert.match(
      html,
      /Originally published at <a class="u-url" href="https:\/\/open\.substack\.com\/pub\/albexl\/p\/why-youre-great-at-setting-bad-goals">Smarter Engineers<\/a>/,
    );
    assert.equal(canonicalOf(html), GUEST);
    assert.deepEqual(entryOf(html, permalink).properties['url'], [permalink, GUEST]);
  });

  for (const slug of ['blank-name', 'number-name']) {
    it(`names the original by its host when canonical_name is no non-empty string: ${slug}`, async () => {
      assert.match(
        await page(slug),
        /Originally published at <a class="u-url" href="https:\/\/andrew\.substack\.com\/p\/on-writing">andrew\.substack\.com<\/a>/,
      );
    });
  }

  for (const slug of ['name-only', 'name-bad-href']) {
    it(`ignores a canonical_name without a valid canonical_href: ${slug}`, async () => {
      const html = await page(slug);

      assert.equal(canonicalOf(html), `${BASE}/2026/09/${slug}/`);
      assert.doesNotMatch(html, /Originally published|Smarter Engineers/);
    });
  }

  it('carries the original in the JSON representation', async () => {
    const json = JSON.parse(await page('crossposted', 'index.json')) as {
      frontMatter: Record<string, unknown>;
    };

    assert.equal(json.frontMatter['canonical_href'], ORIGINAL);
  });

  it('carries the original in the Markdown representation', async () => {
    assert.match(
      await page('crossposted', 'index.md'),
      /^canonical_href: https:\/\/andrew\.substack\.com\/p\/on-writing$/m,
    );
  });
});
