import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import sharp from 'sharp';

import type { Cms, GeekityConfig } from '../index.ts';
import { flashes } from './__testing__/flash.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const NOW = new Date('2026-11-16T12:00:00.000Z');
const COVER = '2026/10/dune.png';
const ALICE = 'https://mastodon.example/users/alice';

/** A small picture of one colour, as real image bytes. */
async function picture(
  colour: string,
  format: 'png' | 'jpeg' = 'png',
  size = 8,
): Promise<Uint8Array> {
  const image = sharp({ create: { width: size, height: size, channels: 3, background: colour } });
  return new Uint8Array(await image.toFormat(format).toBuffer());
}

function versionOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

function postFile(name: string, frontMatter: string[], body = 'Loud and long.'): string {
  return ['---', `title: ${name}`, ...frontMatter, 'author: ada', '---', '', body, ''].join('\n');
}

const REVIEW = postFile('Dune', [
  "date: '2026-10-19T09:00:00Z'",
  'permalink: /2026/10/dune/',
  'rating: 4 # out of five',
  'item:',
  '  kind: movie',
  '  name: Dune',
  '  photo:',
  `    url: /uploads/${COVER}`,
  'activitypub:',
  "  published: '2026-10-19T09:00:05Z'",
]);

const DRAFT = postFile('Dune again', [
  "date: '2026-10-20T09:00:00Z'",
  'permalink: /2026/10/dune-again/',
  'draft: true',
  'activitypub:',
  "  published: '2026-10-20T09:00:05Z'",
  'photo:',
  `  - url: /uploads/${COVER}`,
]);

const UNRELATED = postFile('Popcorn', [
  "date: '2026-10-21T09:00:00Z'",
  'permalink: /2026/10/popcorn/',
  'activitypub:',
  "  published: '2026-10-21T09:00:05Z'",
]);

interface Site {
  cms: Cms;
  agent: Browser;
  contentDir: string;
}

async function siteWith(
  files: Record<string, string | Uint8Array>,
  config: GeekityConfig = {},
): Promise<Site> {
  const contentDir = await box.dir('geekity-media-replace-content-');
  const all = { '_data/site.json': JSON.stringify({ title: 'A Site', author: 'ada' }), ...files };
  for (const [relative, contents] of Object.entries(all)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  const cms = await box.site({
    contentDir,
    baseUrl: BASE,
    now: () => NOW,
    federation: { queue: null, allowPrivateAddress: true },
    ...config,
  });
  const agent = await signedIn(cms);
  cms.admin.putFollower({
    username: 'ada',
    actorId: ALICE,
    inboxId: `${ALICE}/inbox`,
    sharedInboxId: 'https://mastodon.example/inbox',
    handle: '@alice@mastodon.example',
    name: 'Alice',
    iconUrl: null,
    url: null,
    followedAt: '2026-02-01T00:00:00.000Z',
  });
  return { cms, agent, contentDir };
}

async function replace(
  { agent, cms }: Site,
  relative: string,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<string> {
  const screen = await (
    await agent.get(`/admin/media/file?path=${encodeURIComponent(relative)}`)
  ).text();
  const response = await agent.upload(
    '/admin/media/replace',
    csrfField(screen) ?? '',
    file,
    'file',
    { path: relative, from: '' },
  );
  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.equal(location, `/admin/media/file?path=${encodeURIComponent(relative)}`);
  await cms.delivery.settled();
  return await (await agent.get(location)).text();
}

async function bytesAt(contentDir: string, relative: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(contentDir, 'uploads', ...relative.split('/'))));
}

/** What the site posted to other servers, as parsed activities. */
const delivered: Record<string, unknown>[] = [];
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.startsWith(`${BASE}/`)) return await realFetch(input, init);
    if (request.method !== 'POST') return new Response('not here', { status: 404 });
    const body = await request.text();
    if (body.startsWith('{')) delivered.push(JSON.parse(body) as Record<string, unknown>);
    return new Response(null, { status: 202 });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  delivered.length = 0;
});

describe('replacing a file in the media library', () => {
  it('offers Replace file on the file’s page, for the same format only', async () => {
    const site = await siteWith({ [`uploads/${COVER}`]: await picture('#111') });
    const screen = await (
      await site.agent.get(`/admin/media/file?path=${encodeURIComponent(COVER)}`)
    ).text();

    assert.match(
      screen,
      /<form[^>]*action="\/admin\/media\/replace"[^>]*enctype="multipart\/form-data"/,
    );
    assert.match(screen, /<label[^>]*for="media-replace">Replace file<\/label>/);
    assert.match(screen, /id="media-replace"[^>]*accept="\.png"/);
  });

  it('writes the new bytes over the same path, keeping the name and the alt text', async () => {
    const dark = await picture('#111');
    const bright = await picture('#eee');
    const library = JSON.stringify({ [COVER]: { alt: 'The Dune poster' } });
    const site = await siteWith({ [`uploads/${COVER}`]: dark, '_data/media.json': library });

    const screen = await replace(site, COVER, {
      name: 'brighter.png',
      type: 'image/png',
      bytes: bright,
    });

    assert.deepEqual(
      await bytesAt(site.contentDir, COVER),
      bright,
      'the new bytes are at the old path',
    );
    assert.equal(
      await readFile(path.join(site.contentDir, '_data/media.json'), 'utf8'),
      library,
      'the alt text is kept under the same path',
    );
    assert.match(screen, /The Dune poster/);
    assert.match(screen, new RegExp(`src="/uploads/${COVER}\\?v=${versionOf(bright)}"`));
    assert.deepEqual(
      flashes(screen).map((flash) => flash.kind),
      ['notice'],
    );
  });

  it('refuses a replacement in another format, and says why', async () => {
    const dark = await picture('#111');
    const site = await siteWith({ [`uploads/${COVER}`]: dark });

    const screen = await replace(site, COVER, {
      name: 'brighter.jpg',
      type: 'image/jpeg',
      bytes: await picture('#eee', 'jpeg'),
    });

    assert.deepEqual(flashes(screen), [
      {
        kind: 'error',
        message:
          'That file is image/jpeg and this one is image/png. A replacement has to be the same format, ' +
          'because everything that uses the file names it by its extension. The file was not replaced.',
      },
    ]);
    assert.deepEqual(await bytesAt(site.contentDir, COVER), dark);
  });

  it('refuses a replacement an upload would refuse, by its size or what it is inside', async () => {
    const dark = await picture('#111');
    const site = await siteWith({ [`uploads/${COVER}`]: dark }, { uploadMaxBytes: 2048 });

    const tooBig = await replace(site, COVER, {
      name: 'huge.png',
      type: 'image/png',
      bytes: new Uint8Array([...(await picture('#eee')), ...new Uint8Array(4096)]),
    });
    assert.match(flashes(tooBig)[0]?.message ?? '', /too big/);

    const disguised = await replace(site, COVER, {
      name: 'brighter.png',
      type: 'image/png',
      bytes: await picture('#eee', 'jpeg'),
    });
    assert.match(flashes(disguised)[0]?.message ?? '', /does not look like a \.png inside/);
    assert.deepEqual(await bytesAt(site.contentDir, COVER), dark, 'nothing was written');
  });

  it('shows the new picture on the post and its derived sizes without editing it', async () => {
    const site = await siteWith({
      [`uploads/${COVER}`]: await picture('#111', 'png', 64),
      'posts/2026-10-19-dune.md': REVIEW,
    });
    const bright = await picture('#eee', 'png', 64);

    await replace(site, COVER, { name: 'brighter.png', type: 'image/png', bytes: bright });

    const page = await (await site.cms.app.request(`${BASE}/2026/10/dune/`)).text();
    const derived = [...page.matchAll(/\/uploads\/_\/2026\/10\/dune\.png\/[^"\s]+\?v=(\w+)/g)];
    assert.ok(derived.length > 0, 'the cover is drawn from its derived sizes');
    assert.ok(
      derived.every((match) => match[1] === versionOf(bright)),
      'every derived size names the new bytes',
    );
  });
});

describe('sending a replaced picture to followers', () => {
  it('dates each published post that attaches it and sends its followers an Update', async () => {
    const site = await siteWith({
      [`uploads/${COVER}`]: await picture('#111'),
      'posts/2026-10-19-dune.md': REVIEW,
      'posts/2026-10-20-dune-again.md': DRAFT,
      'posts/2026-10-21-popcorn.md': UNRELATED,
    });
    const bright = await picture('#eee');

    const screen = await replace(site, COVER, {
      name: 'brighter.png',
      type: 'image/png',
      bytes: bright,
    });

    assert.equal(
      flashes(screen)[0]?.message,
      `Replaced /uploads/${COVER}. 1 published post that attaches it got a new updated time and went to followers again.`,
    );
    const review = await readFile(path.join(site.contentDir, 'posts/2026-10-19-dune.md'), 'utf8');
    assert.equal(
      review,
      REVIEW.replace(
        "date: '2026-10-19T09:00:00Z'\n",
        "date: '2026-10-19T09:00:00Z'\nupdated: '2026-11-16T12:00:00.000Z'\n",
      ),
      'the post gains an updated line and nothing else changes',
    );
    assert.equal(
      await readFile(path.join(site.contentDir, 'posts/2026-10-20-dune-again.md'), 'utf8'),
      DRAFT,
      'the draft is left alone',
    );
    assert.equal(
      await readFile(path.join(site.contentDir, 'posts/2026-10-21-popcorn.md'), 'utf8'),
      UNRELATED,
    );

    assert.deepEqual(
      delivered.map((activity) => activity['type']),
      ['Update'],
      'one Update, for the review',
    );
    const object = delivered[0]?.['object'] as Record<string, unknown>;
    assert.equal(object['id'], `${BASE}/2026/10/dune/`);
    assert.equal(object['updated'], '2026-11-16T12:00:00Z');
    assert.equal(
      (object['attachment'] as Record<string, unknown>[])[0]?.['url'],
      `${BASE}/uploads/${COVER}?v=${versionOf(bright)}`,
    );
  });

  it('sends nothing when a site with versioned attachment URLs boots', async () => {
    const site = await siteWith({
      [`uploads/${COVER}`]: await picture('#111'),
      'posts/2026-10-19-dune.md': REVIEW,
    });
    const object = (await (
      await site.cms.app.request(`${BASE}/2026/10/dune/`, {
        headers: { accept: 'application/activity+json' },
      })
    ).json()) as Record<string, unknown>;
    assert.match(
      String((object['attachment'] as Record<string, unknown>)['url']),
      /\?v=\w{12}$/,
      'the object a peer fetches carries the versioned URL',
    );

    await site.cms.sync();
    await site.cms.delivery.settled();

    assert.deepEqual(delivered, [], 'neither the boot scan nor a rescan sends the post again');
  });
});
