import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { mf2 } from 'microformats-parser';

import { jpegWithMetadata } from '../__testing__/metadata.ts';
import { FIRST_ADMIN, sandbox } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';

const box = sandbox();

function fixture(name: string): string {
  return readFileSync(
    new URL(`../../test/fixtures/reply-context/${name}`, import.meta.url),
    'utf8',
  );
}

const AARON = 'https://aaronparecki.com/2026/09/24/20/';
const AARON_PHOTO = 'https://aaronparecki.com/images/profile.jpg';
const MASTODON = 'https://mastodon.social/@Gargron/117383656684365550';
const MASTODON_OBJECT = 'https://mastodon.social/users/Gargron/statuses/117383656684365550';
const MASTODON_ACTOR = 'https://mastodon.social/users/Gargron';
const MASTODON_AVATAR =
  'https://files.mastodon.social/accounts/avatars/000/000/001/original/6b2384b33799a0dd.png';
const MASTODON_IMAGE =
  'https://files.mastodon.social/media_attachments/files/117/383/653/868/951/382/original/076a61b438462f42.jpeg';
const NO_PHOTO = 'https://them.example/2026/09/no-photo/';
const PLAIN = 'https://plain.example/page';
const DOWN = 'https://down.example/page';

const ACTIVITY = 'application/activity+json; charset=utf-8';

let jpeg: Uint8Array;
const fetched: { url: string; signed: boolean }[] = [];

function signedRequest(request: Request): boolean {
  return request.headers.has('signature') || request.headers.has('signature-input');
}

const routes: Record<string, () => Response> = {};

function answer(request: Request): Response {
  const route = routes[request.url];
  if (route !== undefined) return route();
  const signed = signedRequest(request);
  const html = (body: string): Response =>
    new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const image = (): Response => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  switch (request.url) {
    case AARON:
      return html(fixture('aaronparecki-checkin.html'));
    case AARON_PHOTO:
    case MASTODON_AVATAR:
    case MASTODON_IMAGE:
      return image();
    case MASTODON:
      return html(fixture('mastodon-status.html'));
    case MASTODON_OBJECT:
      return new Response(fixture('mastodon-status.json'), {
        headers: { 'content-type': ACTIVITY },
      });
    case MASTODON_ACTOR:
      return signed
        ? new Response(fixture('mastodon-actor.json'), { headers: { 'content-type': ACTIVITY } })
        : new Response('{"error":"Request not signed"}', { status: 401 });
    case NO_PHOTO:
      return html(`<title>No photo</title>
        <article class="h-entry"><h1 class="p-name">A post with a broken avatar</h1>
          <span class="p-author h-card"><img class="u-photo" src="/missing.jpg" alt="">
            <a class="p-name u-url" href="https://them.example/">Pat Them</a></span>
          <div class="e-content"><p>Words.</p></div></article>`);
    case 'https://them.example/missing.jpg':
      return html('<p>Not an image at all.</p>');
    case PLAIN:
      return html('<title>Only a title</title>');
    default:
      return new Response('gone', { status: 404 });
  }
}

const lookup: HostLookup = () => Promise.resolve(['203.0.113.7']);

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  fetched.push({ url: request.url, signed: signedRequest(request) });
  if (request.url === DOWN) return Promise.reject(new TypeError('fetch failed'));
  return Promise.resolve(answer(request));
}) as typeof fetch;

const warn = console.warn;

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
  console.warn = warn;
});

function reply(name: string, target: string): string {
  return [
    '---',
    "date: '2026-10-05T09:00:00Z'",
    `permalink: /2026/10/${name}/`,
    `in-reply-to: ${target}`,
    '---',
    '',
    `The reply called ${name}.`,
    '',
  ].join('\n');
}

const REPLIES = {
  'to-aaron': AARON,
  'to-mastodon': MASTODON,
  'to-no-photo': NO_PHOTO,
  'to-plain': PLAIN,
  'to-down': DOWN,
};

describe('the author of what a reply answers', () => {
  let cms: Cms;
  let contentDir: string;
  const pages: Record<string, string> = {};

  before(async () => {
    jpeg = await jpegWithMetadata();
    console.warn = () => undefined;
    contentDir = await box.dir('geekity-cited-author-content-');
    const dataDir = await box.dir('geekity-cited-author-data-');
    writeUsers(dataDir, [{ username: FIRST_ADMIN.username }]);
    await mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'A Site', timezone: 'UTC', baseUrl: 'https://site.example' }),
    );
    for (const [name, target] of Object.entries(REPLIES)) {
      await writeFile(path.join(contentDir, 'posts', `2026-10-05-${name}.md`), reply(name, target));
    }
    cms = await box.open({
      contentDir,
      dataDir,
      baseUrl: 'https://site.example',
      hostLookup: lookup,
      federation: { queue: null, allowPrivateAddress: true },
    });
    await cms.replyContexts.settled();
    for (const name of Object.keys(REPLIES)) {
      const response = await cms.app.request(`/2026/10/${name}/`);
      assert.equal(response.status, 200, name);
      pages[name] = await response.text();
    }
  });

  function cite(name: string): string {
    const found = /<div class="reply-context cite u-in-reply-to h-cite[^"]*">[\s\S]*?<\/div>/.exec(
      pages[name] ?? '',
    )?.[0];
    assert.ok(found !== undefined, `${name} cites what it answers`);
    return found;
  }

  function author(name: string): Record<string, unknown[]> {
    const parsed = mf2(cite(name), { baseUrl: 'https://site.example/' });
    const card = parsed.items[0]?.properties['author']?.[0];
    assert.ok(typeof card === 'object' && 'properties' in card, `${name} names an author h-card`);
    return card.properties as Record<string, unknown[]>;
  }

  function sources(fragment: string): string[] {
    return [...fragment.matchAll(/\s(?:src|srcset)="([^"]*)"/g)].flatMap((match) =>
      (match[1] ?? '').split(',').map((candidate) => candidate.trim().split(' ')[0] ?? ''),
    );
  }

  it('shows an h-entry author’s photo beside their name, from the site’s own uploads', () => {
    const card = author('to-aaron');

    assert.deepEqual(card['name'], ['Aaron Parecki']);
    assert.deepEqual(card['url'], ['https://aaronparecki.com/']);
    const [photo] = card['photo'] ?? [];
    const src = typeof photo === 'string' ? photo : (photo as { value: string }).value;
    assert.match(src, /^https:\/\/site\.example\/uploads\/cited\/[0-9a-f]{16}\.jpg$/);
    assert.match(cite('to-aaron'), /<img class="u-photo cite-avatar"[^>]* alt=""/);
  });

  it('shows a Mastodon status’s author, handle, avatar, words, picture and date', () => {
    const citation = cite('to-mastodon');
    const card = author('to-mastodon');

    assert.deepEqual(card['name'], ['Eugen Rochko']);
    assert.deepEqual(card['nickname'], ['@Gargron@mastodon.social']);
    assert.deepEqual(card['url'], ['https://mastodon.social/@Gargron']);
    assert.equal(card['photo']?.length, 1);
    assert.match(citation, /<blockquote class="cite-quote p-content">#SilentSunday<\/blockquote>/);
    assert.match(citation, /<time class="dt-published" datetime="2026-10-04T16:47:36/);
    assert.match(citation, /<a class="cite-thumb" href="https:\/\/mastodon\.social\/@Gargron/);
    assert.doesNotMatch(citation, /Eugen Rochko \(@Gargron@mastodon\.social\)/);
  });

  it('reads the status and its author signed as the site', () => {
    const asked = fetched.filter(({ url }) => url === MASTODON_OBJECT || url === MASTODON_ACTOR);

    assert.ok(asked.length >= 2, JSON.stringify(asked));
    assert.ok(
      asked.every(({ signed }) => signed),
      JSON.stringify(asked),
    );
  });

  it('serves every face and picture from the site, never from where it was found', () => {
    for (const name of ['to-aaron', 'to-mastodon']) {
      const found = sources(cite(name));
      assert.ok(found.length > 0, name);
      for (const src of found) assert.match(src, /^\/(uploads|images)\//, `${name}: ${src}`);
    }
  });

  it('keeps the photos in the contexts file and the files under uploads/cited', async () => {
    const stored = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'replyContexts.json'), 'utf8'),
    ) as Record<string, { author?: { handle?: string; photo?: { src: string } } }>;
    const copied = await readdir(path.join(contentDir, 'uploads', 'cited'));

    assert.equal(stored[MASTODON]?.author?.handle, 'Gargron@mastodon.social');
    for (const target of [AARON, MASTODON]) {
      const src = stored[target]?.author?.photo?.src ?? '';
      assert.ok(copied.includes(path.basename(src)), `${target}: ${src}`);
    }
  });

  it('copies the author’s photo after a save that named its post after the target', async () => {
    const target = 'https://aaronparecki.com/2026/09/24/20/?named';
    routes[target] = () =>
      new Response(fixture('aaronparecki-checkin.html'), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

    const described = await cms.replyContexts.describe(target);
    await cms.replyContexts.settled();

    assert.equal(described?.author?.name, 'Aaron Parecki');
    assert.match(cms.replyContexts.read(target)?.author?.photo?.src ?? '', /^\/uploads\/cited\//);
  });

  it('leaves the author without a photo when theirs is not an image', () => {
    const card = author('to-no-photo');

    assert.deepEqual(card['name'], ['Pat Them']);
    assert.equal(card['photo'], undefined);
    assert.doesNotMatch(cite('to-no-photo'), /<img/);
  });

  it('draws a page with only a title, and one that cannot be fetched, as before', () => {
    assert.match(
      cite('to-plain'),
      /In reply to <a class="u-url p-name" href="https:\/\/plain\.example\/page">Only a title<\/a>/,
    );
    assert.match(
      cite('to-down'),
      /In reply to <a class="u-url" href="https:\/\/down\.example\/page">a page on down\.example<\/a>/,
    );
  });
});
