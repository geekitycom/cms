/**
 * Remote avatars, served from the site (TASK-134).
 *
 * Asserted over HTTP against a sandboxed CMS wearing the packaged theme, with
 * the network replaced by a table of make-believe servers, because what
 * matters is what a reader's browser is told to fetch and what the site does
 * when it is asked.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import sharp from 'sharp';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';
import {
  AVATAR_DIRECTORY,
  AVATAR_MAX_AGE_MS,
  AVATAR_MAX_BYTES,
  AVATAR_SIZE,
  avatarHref,
  avatarSourceOf,
} from './avatars.ts';

const box = sandbox();

const BASE_URL = 'https://blog.example';
const HELLO = `${BASE_URL}/2026/09/hello/`;

/** A follower who liked the post: their picture is shown. */
const ADA_ICON = 'https://remote.example/avatars/ada.png';
/** A follower who has done nothing: their picture is shown nowhere. */
const IDLE_ICON = 'https://remote.example/avatars/idle.png';
/** An approved webmention's author. */
const GRACE_PHOTO = 'https://grace.example/avatar.jpg';
/** A webmention still waiting for the moderator. */
const PENDING_PHOTO = 'https://pending.example/avatar.png';
/** Somewhere nobody recorded. */
const STRANGER = 'https://stranger.example/anything.png';

const ADDRESSES: Record<string, string[]> = {
  'remote.example': ['203.0.113.10'],
  'grace.example': ['203.0.113.11'],
  'pending.example': ['203.0.113.12'],
  'stranger.example': ['203.0.113.13'],
  'inside.example': ['10.0.0.5'],
};

const lookup: HostLookup = (hostname) => {
  const found = ADDRESSES[hostname];
  return found === undefined
    ? Promise.reject(new Error(`getaddrinfo ENOTFOUND ${hostname}`))
    : Promise.resolve(found);
};

/** Every URL the stubbed web was asked for. */
const requested: string[] = [];
/** What each URL answers; anything missing is a 404. */
let web: Record<string, () => Response> = {};

const original = globalThis.fetch;
before(() => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requested.push(request.url);
    return Promise.resolve(web[request.url]?.() ?? new Response('missing', { status: 404 }));
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = original;
  await box.cleanup();
});

afterEach(() => {
  requested.length = 0;
  web = {};
});

/** A picture of one colour, `width` by `height`, in `format`. */
async function picture(
  width: number,
  height: number,
  format: 'png' | 'jpeg',
  colour = { r: 200, g: 30, b: 30 },
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour } })
    [format]()
    .toBuffer();
}

function image(bytes: Uint8Array, type: string): () => Response {
  return () => new Response(bytes, { headers: { 'content-type': type } });
}

function entry(values: Record<string, unknown>): Record<string, unknown> {
  return {
    source: 'webmention',
    kind: 'mention',
    status: 'approved',
    author: { name: 'Somebody', url: null, email: null, avatar: null },
    content: { markdown: 'Wrote about this', html: '<p>Wrote about this</p>' },
    submitted: '2026-09-11T10:00:00.000Z',
    addressHash: null,
    inReplyTo: null,
    url: null,
    notify: false,
    ...values,
  };
}

/**
 * A site with one post that a following actor liked and an approved
 * webmention mentioned, a pending webmention, and a follower who has done
 * nothing.
 */
async function site(): Promise<{ cms: Cms; dataDir: string }> {
  const contentDir = await box.dir('geekity-avatars-content-');
  const dataDir = await box.dir('geekity-avatars-data-');

  const files: Record<string, string> = {
    'posts/hello.md': [
      '---',
      'title: Hello',
      "date: '2026-09-10T09:00:00Z'",
      'permalink: /2026/09/hello/',
      '---',
      '',
      'Words.',
      '',
    ].join('\n'),
    '_data/site.json': JSON.stringify({ title: 'A Site' }),
    '_data/comments/hello.json': JSON.stringify({
      post: '/2026/09/hello/',
      comments: [
        entry({
          id: '00000000-0000-4000-8000-000000000001',
          author: {
            name: 'Grace',
            url: 'https://grace.example/',
            email: null,
            avatar: GRACE_PHOTO,
          },
          url: 'https://grace.example/2026/09/about-that/',
        }),
        entry({
          id: '00000000-0000-4000-8000-000000000002',
          status: 'pending',
          author: { name: 'Pat', url: null, email: null, avatar: PENDING_PHOTO },
          url: 'https://pending.example/post/',
        }),
      ],
    }),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    hostLookup: lookup,
    now: () => new Date(),
  });

  for (const [actor, iconUrl] of [
    ['https://remote.example/users/ada', ADA_ICON],
    ['https://remote.example/users/idle', IDLE_ICON],
  ] as const) {
    cms.admin.putFollower({
      username: 'ada',
      actorId: actor,
      inboxId: `${actor}/inbox`,
      sharedInboxId: null,
      handle: null,
      name: actor.split('/').at(-1) ?? actor,
      iconUrl,
      url: actor,
    });
  }
  cms.admin.logInboxActivity({
    activityId: 'https://remote.example/likes/1',
    activityType: 'Like',
    actorId: 'https://remote.example/users/ada',
    objectId: HELLO,
    json: JSON.stringify({
      id: 'https://remote.example/likes/1',
      type: 'Like',
      actor: 'https://remote.example/users/ada',
      object: HELLO,
    }),
  });

  return { cms, dataDir };
}

async function page(cms: Cms): Promise<string> {
  const response = await cms.app.request('/2026/09/hello/');
  assert.equal(response.status, 200);
  return response.text();
}

describe('avatar keys', () => {
  it('spell the source URL and nothing else', () => {
    const href = avatarHref(ADA_ICON);
    assert.match(href, /^\/_geekity\/avatars\/[A-Za-z0-9_-]+$/);
    assert.equal(avatarSourceOf(href.split('/').at(-1) ?? ''), ADA_ICON);
  });

  it('refuse a key that is not one the site would mint', () => {
    assert.equal(avatarSourceOf('not base64!'), undefined);
    assert.equal(
      avatarSourceOf(Buffer.from('file:///etc/passwd').toString('base64url')),
      undefined,
    );
    assert.equal(avatarSourceOf(`${Buffer.from(ADA_ICON).toString('base64url')}=`), undefined);
  });
});

describe('a post page (AC #1)', () => {
  it('names every remote avatar by a same-origin URL and never by the remote one', async () => {
    const { cms } = await site();
    const html = await page(cms);

    assert.ok(html.includes(`src="${avatarHref(ADA_ICON)}"`), 'the liker is proxied');
    assert.ok(html.includes(`src="${avatarHref(GRACE_PHOTO)}"`), 'the webmention is proxied');
    const remote = [...html.matchAll(/<img[^>]*src="(https?:[^"]*)"/g)].map((match) => match[1]);
    assert.deepEqual(remote, [], 'no image is hotlinked');
    assert.ok(!html.includes('remote.example/avatars'), 'the remote URL is not on the page');
    assert.ok(!html.includes(GRACE_PHOTO), 'nor the webmention photo');
  });
});

describe('the avatar route (AC #2)', () => {
  it('fetches a recorded avatar and serves it as WebP at the size the theme shows', async () => {
    const { cms } = await site();
    web[ADA_ICON] = image(await picture(400, 300, 'png'), 'image/png');

    const response = await cms.app.request(avatarHref(ADA_ICON));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.match(response.headers.get('cache-control') ?? '', /public, max-age=\d+/);
    const served = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(served.format, 'webp');
    assert.equal(served.width, AVATAR_SIZE);
    assert.equal(served.height, AVATAR_SIZE);
    assert.deepEqual(requested, [ADA_ICON]);
  });

  it('answers the second request from the cache, and a validator with a 304', async () => {
    const { cms } = await site();
    web[GRACE_PHOTO] = image(await picture(120, 120, 'jpeg'), 'image/jpeg');

    const first = await cms.app.request(avatarHref(GRACE_PHOTO));
    assert.equal(first.status, 200);
    const etag = first.headers.get('etag') ?? '';
    const second = await cms.app.request(avatarHref(GRACE_PHOTO));
    assert.equal(second.status, 200);
    const again = await cms.app.request(avatarHref(GRACE_PHOTO), {
      headers: { 'if-none-match': etag },
    });

    assert.equal(again.status, 304);
    assert.deepEqual(requested, [GRACE_PHOTO], 'fetched once');
  });

  it('is not an open proxy: a URL the site has not recorded is a 404 and fetches nothing', async () => {
    const { cms } = await site();
    web[STRANGER] = image(await picture(80, 80, 'png'), 'image/png');
    web[IDLE_ICON] = image(await picture(80, 80, 'png'), 'image/png');
    web[PENDING_PHOTO] = image(await picture(80, 80, 'png'), 'image/png');

    for (const source of [STRANGER, IDLE_ICON, PENDING_PHOTO]) {
      const response = await cms.app.request(avatarHref(source));
      assert.equal(response.status, 404, `${source} is refused`);
    }
    assert.equal((await cms.app.request('/_geekity/avatars/not-a-key!')).status, 404);
    assert.deepEqual(requested, [], 'nothing was fetched');
  });

  it('serves the placeholder for a body over the size limit', async () => {
    const { cms } = await site();
    web[ADA_ICON] = image(new Uint8Array(AVATAR_MAX_BYTES + 1), 'image/png');

    const response = await cms.app.request(avatarHref(ADA_ICON));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
  });

  it('serves the placeholder for anything that is not a raster picture', async () => {
    const { cms } = await site();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    web[ADA_ICON] = () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });
    // Labelled a PNG, but HTML inside.
    web[GRACE_PHOTO] = () =>
      new Response('<html>hi</html>', { headers: { 'content-type': 'image/png' } });

    for (const source of [ADA_ICON, GRACE_PHOTO]) {
      const response = await cms.app.request(avatarHref(source));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/svg+xml', source);
      assert.ok(!(await response.text()).includes('script'), 'the stranger’s bytes are not served');
    }
  });

  it('does not follow a redirect to a private address', async () => {
    const { cms } = await site();
    web[ADA_ICON] = () =>
      new Response(null, { status: 302, headers: { location: 'http://inside.example/a.png' } });

    const response = await cms.app.request(avatarHref(ADA_ICON));

    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    assert.deepEqual(requested, [ADA_ICON], 'the private host was never asked');
  });
});

describe('refreshing (AC #3)', () => {
  it('falls back to the placeholder when the fetch fails, and does not ask again at once', async () => {
    const { cms } = await site();

    const first = await cms.app.request(avatarHref(ADA_ICON));
    const second = await cms.app.request(avatarHref(ADA_ICON));

    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-type'), 'image/svg+xml');
    assert.match(first.headers.get('cache-control') ?? '', /max-age=300/);
    assert.equal(second.headers.get('content-type'), 'image/svg+xml');
    assert.deepEqual(requested, [ADA_ICON], 'a failure is not retried on every view');
  });

  it('fetches every recorded avatar in the sweep, before anybody asks', async () => {
    const { cms } = await site();
    web[ADA_ICON] = image(await picture(64, 64, 'png'), 'image/png');
    web[GRACE_PHOTO] = image(await picture(64, 64, 'jpeg'), 'image/jpeg');

    await cms.avatars.sweep();

    assert.deepEqual([...requested].sort(), [ADA_ICON, GRACE_PHOTO].sort());
    const response = await cms.app.request(avatarHref(ADA_ICON));
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(requested.length, 2, 'the page view fetched nothing');
  });

  it('refetches an avatar older than the maximum age, and keeps a fresh one', async () => {
    const { cms, dataDir } = await site();
    web[ADA_ICON] = image(await picture(64, 64, 'png'), 'image/png');
    web[GRACE_PHOTO] = image(await picture(64, 64, 'jpeg'), 'image/jpeg');
    await cms.avatars.sweep();
    requested.length = 0;

    const directory = path.join(dataDir, AVATAR_DIRECTORY);
    const adaFile = cachedFileFor(ADA_ICON);
    const old = new Date(Date.now() - AVATAR_MAX_AGE_MS - 60_000);
    await utimes(path.join(directory, adaFile), old, old);
    web[ADA_ICON] = image(await picture(64, 64, 'png', { r: 0, g: 0, b: 255 }), 'image/png');

    await cms.avatars.sweep();

    assert.deepEqual(requested, [ADA_ICON], 'only the stale one was fetched');
    const served = await cms.app.request(avatarHref(ADA_ICON));
    const { data } = await sharp(Buffer.from(await served.arrayBuffer()))
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.ok((data[2] ?? 0) > 200 && (data[0] ?? 255) < 50, 'the new picture is served');
  });
});

describe('the cache (AC #4)', () => {
  it('can be deleted: the next request fetches the picture again', async () => {
    const { cms, dataDir } = await site();
    web[ADA_ICON] = image(await picture(64, 64, 'png'), 'image/png');
    await cms.avatars.sweep();

    await rm(path.join(dataDir, AVATAR_DIRECTORY), { recursive: true, force: true });
    const response = await cms.app.request(avatarHref(ADA_ICON));

    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(requested.filter((url) => url === ADA_ICON).length, 2);
  });

  it('forgets a picture the site no longer shows', async () => {
    const { cms, dataDir } = await site();
    web[ADA_ICON] = image(await picture(64, 64, 'png'), 'image/png');
    web[GRACE_PHOTO] = image(await picture(64, 64, 'jpeg'), 'image/jpeg');
    await cms.avatars.sweep();
    const adaFile = cachedFileFor(ADA_ICON);

    cms.admin.deleteFollower('ada', 'https://remote.example/users/ada');
    await cms.avatars.sweep();

    const left = await readdir(path.join(dataDir, AVATAR_DIRECTORY));
    assert.ok(!left.includes(adaFile), 'the unfollowed liker’s picture is gone');
    assert.equal(left.filter((name) => name.endsWith('.webp')).length, 1, 'Grace’s stays');
    assert.equal((await cms.app.request(avatarHref(ADA_ICON))).status, 404);
  });
});

/** The cached file for one source: named by the hash of its URL. */
function cachedFileFor(source: string): string {
  return `${createHash('sha256').update(source).digest('hex')}.webp`;
}
