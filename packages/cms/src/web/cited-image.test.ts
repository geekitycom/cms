import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { leakedSecrets, pngWithMetadata } from '../__testing__/metadata.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';

const box = sandbox();

const IMAGE =
  'https://edu.example/sites/default/files/2026-09/fx-991cw-calculator-front-view-high-resolution.png?itok=Xq3rT9vA&width=1200&utm_source=share';
const BIG_IMAGE = 'https://edu.example/huge.png';
const GONE = 'https://gone.example/a/very/long/path/to/something.png';
const UNREAD = 'https://unread.example/2026/09/a-post/';

const UPLOAD_MAX_BYTES = 200_000;

let png: Uint8Array;

function answer(url: URL): Response {
  switch (url.origin + url.pathname) {
    case 'https://edu.example/sites/default/files/2026-09/fx-991cw-calculator-front-view-high-resolution.png':
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    case BIG_IMAGE:
      return new Response(new Uint8Array([...png, ...new Uint8Array(UPLOAD_MAX_BYTES)]), {
        headers: { 'content-type': 'image/png' },
      });
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
  png = await pngWithMetadata();
  console.warn = () => undefined;
});

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
  console.warn = warn;
});

function post(name: string, lines: string[]): string {
  return [
    '---',
    "date: '2026-09-10T09:00:00Z'",
    `permalink: /2026/09/${name}/`,
    ...lines,
    '---',
    '',
    `The post called ${name}.`,
    '',
  ].join('\n');
}

async function site(files: Record<string, string>): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await box.dir('geekity-cited-image-content-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-cited-image-data-'),
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

function words(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escaped(url: string): string {
  return url.replaceAll('&', '&amp;').replace(/[.?*+()[\]]/g, '\\$&');
}

const POSTS: Record<string, string[]> = {
  'reposted-image': [`repost-of: ${IMAGE}`, 'cited-alt: A Casio scientific calculator, face on'],
  'titled-image': ['title: My new calculator', `repost-of: ${IMAGE}`],
  'untitled-image': [`repost-of: ${IMAGE}`],
  'liked-image': [`like-of: ${IMAGE}`],
  'bookmarked-image': [`bookmark-of: ${IMAGE}`],
  'hidden-image': [`repost-of: ${IMAGE}`, 'preview: false'],
  'reposted-huge': [`repost-of: ${BIG_IMAGE}`],
  'reposted-gone': [`repost-of: ${GONE}`],
  'replied-unread': [`in-reply-to: ${UNREAD}`],
};

describe('a cited URL that is an image', () => {
  let cms: Cms;
  let contentDir: string;
  let front: string;
  const pages: Record<string, string> = {};

  before(async () => {
    ({ cms, contentDir } = await site({
      '_data/site.json': JSON.stringify({ title: 'A Site', timezone: 'UTC', postsPerPage: 20 }),
      ...Object.fromEntries(
        Object.entries(POSTS).map(([name, lines]) => [
          `posts/2026-09-10-${name}.md`,
          post(name, lines),
        ]),
      ),
    }));
    for (const name of Object.keys(POSTS)) pages[name] = await get(cms, `/2026/09/${name}/`);
    front = await get(cms, '/');
  });

  for (const where of ['page', 'listing'] as const) {
    const read = (name: string, property: string): string =>
      cite(where === 'page' ? (pages[name] ?? '') : entry(front, name), property);

    it(`shows a reposted image in full, credited to its host, in the ${where}`, () => {
      const citation = read('reposted-image', 'repost-of');

      assert.match(
        citation,
        new RegExp(
          `<p class="cite-line small">Reposted <a class="u-url" href="${escaped(IMAGE)}">an image from edu\\.example</a>\\s*</p>`,
        ),
      );
      assert.match(
        citation,
        new RegExp(
          `<a class="cite-photo" href="${escaped(IMAGE)}">(?:<picture>.*?)?<img class="u-photo" src="/uploads/cited/[0-9a-f]{16}\\.png" alt="A Casio scientific calculator, face on" width="\\d+" height="\\d+"`,
        ),
      );
      assert.equal(words(citation), 'Reposted an image from edu.example');
    });

    it(`takes the post’s title as the image’s alt text when it has none of its own, in the ${where}`, () => {
      assert.match(
        read('titled-image', 'repost-of'),
        /<img class="u-photo"[^>]* alt="My new calculator"/,
      );
      assert.match(read('untitled-image', 'repost-of'), /<img class="u-photo"[^>]* alt=""/);
    });

    it(`says a like or a bookmark of an image is of an image, beside its thumbnail, in the ${where}`, () => {
      for (const [name, property, verb] of [
        ['liked-image', 'like-of', 'Liked'],
        ['bookmarked-image', 'bookmark-of', 'Bookmarked'],
      ] as const) {
        const citation = read(name, property);

        assert.equal(words(citation), `${verb} an image from edu.example`, name);
        assert.match(
          citation,
          /<a class="cite-thumb" href="[^"]+" tabindex="-1" aria-hidden="true">(?:<picture>.*?)?<img class="u-photo" src="\/uploads\/cited\/[0-9a-f]{16}\.png" alt=""/,
          name,
        );
      }
    });

    it(`still says it reposted an image when the post hid its preview, in the ${where}`, () => {
      const citation = read('hidden-image', 'repost-of');

      assert.doesNotMatch(citation, /<img/);
      assert.equal(words(citation), 'Reposted an image from edu.example');
    });

    it(`links an image over the size cap or a failed fetch by its host, never its whole URL, in the ${where}`, () => {
      for (const [name, property, line] of [
        ['reposted-huge', 'repost-of', 'Reposted a page on edu.example'],
        ['reposted-gone', 'repost-of', 'Reposted a page on gone.example'],
        ['replied-unread', 'in-reply-to', 'In reply to a page on unread.example'],
      ] as const) {
        const citation = read(name, property);

        assert.doesNotMatch(citation, /<img/, name);
        assert.equal(words(citation), line, name);
        assert.match(citation, /<a class="u-url" href="https:\/\/[^"]+">a page on /, name);
      }
    });
  }

  it('copies the image into uploads/cited, stripped, and keeps no entry for one it could not copy', async () => {
    const names = await readdir(path.join(contentDir, 'uploads', 'cited'));
    assert.equal(names.filter((name) => name.endsWith('.png')).length, 1, names.join(', '));
    const [name] = names.filter((each) => each.endsWith('.png'));
    assert.deepEqual(
      leakedSecrets(await readFile(path.join(contentDir, 'uploads', 'cited', name ?? ''))),
      [],
    );

    const contexts = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'replyContexts.json'), 'utf8'),
    ) as Record<string, Record<string, unknown>>;
    assert.deepEqual(Object.keys(contexts[IMAGE] ?? {}).sort(), ['picture', 'url']);
    assert.equal((contexts[IMAGE]?.['picture'] as { kind: string }).kind, 'photo');
    assert.equal(contexts[BIG_IMAGE], undefined);
    assert.equal(contexts[GONE], undefined);
  });

  it('never asks the image’s host for anything while serving', async () => {
    fetched.length = 0;
    await get(cms, '/2026/09/reposted-image/');
    await get(cms, '/');
    assert.deepEqual(fetched, []);
  });

  it('cites the image the same way in every feed', async () => {
    const feed = await get(cms, '/feed/json/');
    const items = (JSON.parse(feed) as { items: { url: string; content_html: string }[] }).items;
    const html = (name: string): string =>
      items.find((item) => item.url.endsWith(`/2026/09/${name}/`))?.content_html ?? '';

    assert.match(
      html('reposted-image'),
      new RegExp(
        `^<p class="cite-line">Reposted <a href="${escaped(IMAGE)}">an image from edu\\.example</a></p>\\n<p><a href="${escaped(IMAGE)}"><img src="http[^"]+/uploads/cited/[0-9a-f]{16}\\.png" alt="A Casio scientific calculator, face on"`,
      ),
    );
    assert.match(html('titled-image'), /<img [^>]*alt="My new calculator"/);
    assert.match(
      html('reposted-gone'),
      new RegExp(
        `^<p class="cite-line">Reposted <a href="${escaped(GONE)}">a page on gone\\.example</a></p>`,
      ),
    );
    assert.match(
      html('liked-image'),
      /^<p class="cite-line">Liked <a href="[^"]+">an image from edu\.example<\/a><\/p>/,
    );
    for (const feedPath of ['/feed/', '/feed/atom/', '/feed/json/']) {
      assert.doesNotMatch(
        await get(cms, feedPath),
        />https:\/\/(edu|gone|unread)\.example[^<]*<\/a>/,
      );
    }
  });
});
