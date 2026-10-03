/**
 * Micropub create (TASK-164): a client posts an h-entry and the site writes
 * the post the admin editor would have written.
 */
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import matter from 'gray-matter';
import sharp from 'sharp';

import { csrfField, FIRST_ADMIN, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { findUser } from '../admin/accounts.ts';
import { postTypeOf } from '../content/post-type.ts';
import { addFollower } from '../federation/records.ts';
import type { Scope } from '../indieauth/request.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms, GeekityConfig } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const NOW = new Date('2026-09-20T12:00:00.000Z');

interface Site {
  cms: Cms;
  agent: Browser;
  token: string;
}

/** A site whose first admin, ada, holds a token with `scopes`. */
async function site(scopes: Scope[] = ['create'], config: GeekityConfig = {}): Promise<Site> {
  const cms = await box.open({
    contentDir: await box.dir('geekity-micropub-create-content-'),
    dataDir: await box.dir('geekity-micropub-create-data-'),
    baseUrl: BASE,
    now: () => NOW,
    ...config,
  });
  const agent = await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined, 'the first admin exists');
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: 'unused',
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes,
    },
    NOW,
  );
  return { cms, agent, token: accessToken };
}

async function postForm(cms: Cms, token: string, fields: [string, string][]): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields).toString(),
  });
}

async function postJson(cms: Cms, token: string, body: unknown): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Every Markdown file under the content directory's posts. */
async function postFiles(cms: Cms): Promise<string[]> {
  try {
    return await readdir(path.join(cms.config.contentDir, 'posts'));
  } catch {
    return [];
  }
}

async function fileAt(cms: Cms, relative: string): Promise<string> {
  return await readFile(path.join(cms.config.contentDir, relative), 'utf8');
}

describe('creating a post (AC #1)', () => {
  it('answers a form-encoded h=entry with 201 and the new post’s permalink', async () => {
    const { cms, token } = await site();
    const response = await postForm(cms, token, [
      ['h', 'entry'],
      ['content', 'Hello from a phone.'],
      ['category[]', 'indieweb'],
      ['category[]', 'micropub'],
    ]);

    assert.equal(response.status, 201);
    const location = response.headers.get('location');
    assert.equal(location, `${BASE}/2026/09/hello-from-a-phone/`);
    const document = cms.store.getByPermalink('/2026/09/hello-from-a-phone/');
    assert.ok(document !== undefined, 'the post is in the index');
    assert.deepEqual(document.tags, ['indieweb', 'micropub']);
    assert.equal((await cms.app.request(new URL(location).pathname)).status, 200);
  });

  it('answers a JSON h-entry with 201 and the new post’s permalink', async () => {
    const { cms, token } = await site();
    const response = await postJson(cms, token, {
      type: ['h-entry'],
      properties: {
        name: ['A title of its own'],
        content: [{ html: '<p>Some <em>markup</em>.</p>' }],
        summary: ['What it is about'],
        category: ['essays'],
        published: ['2026-09-18T08:30:00-05:00'],
        'mp-slug': ['chosen-slug'],
      },
    });

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('location'), `${BASE}/2026/09/chosen-slug/`);
    const document = cms.store.getByPermalink('/2026/09/chosen-slug/');
    assert.ok(document !== undefined);
    assert.equal(document.title, 'A title of its own');
    assert.equal(document.description, 'What it is about');
    assert.equal(document.date, '2026-09-18T13:30:00Z');
    assert.match(document.html, /<em>markup<\/em>/);
    assert.equal(document.path, 'posts/2026-09-18-chosen-slug.md');
  });

  it('takes the token from an access_token form field', async () => {
    const { cms, token } = await site();
    const response = await cms.app.request(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        h: 'entry',
        content: 'Token in the body',
        access_token: token,
      }).toString(),
    });
    assert.equal(response.status, 201);
    const document = cms.store.getByPermalink('/2026/09/token-in-the-body/');
    assert.ok(document !== undefined);
    assert.equal(document.extra['access_token'], undefined, 'the token is not front matter');
  });
});

describe('what a Micropub post is (AC #2)', () => {
  it('writes the same file the editor writes for the same content', async () => {
    const editorSite = await site();
    const html = await (await editorSite.agent.get('/admin/posts/new')).text();
    const csrf = csrfField(html);
    assert.ok(csrf !== undefined);
    const saved = await editorSite.agent.post('/admin/posts/new', {
      csrf_token: csrf,
      title: '',
      slug: '',
      permalink: '',
      date: '2026-09-19T09:00:00Z',
      tags: 'indieweb, micropub',
      categories: '',
      description: '',
      'in-reply-to': 'https://peer.example/a-post/',
      lang: '',
      body: 'Replying from a phone.',
      action: 'publish',
    });
    assert.equal(saved.status, 303);

    const micropubSite = await site();
    const created = await postForm(micropubSite.cms, micropubSite.token, [
      ['h', 'entry'],
      ['content', 'Replying from a phone.'],
      ['category[]', 'indieweb'],
      ['category[]', 'micropub'],
      ['in-reply-to', 'https://peer.example/a-post/'],
      ['published', '2026-09-19T09:00:00Z'],
    ]);
    assert.equal(created.status, 201);

    const [editorFile] = await postFiles(editorSite.cms);
    const [micropubFile] = await postFiles(micropubSite.cms);
    assert.ok(editorFile !== undefined && micropubFile !== undefined);
    assert.equal(micropubFile, editorFile);
    assert.equal(
      await fileAt(micropubSite.cms, `posts/${micropubFile}`),
      await fileAt(editorSite.cms, `posts/${editorFile}`),
    );

    const editorPost = editorSite.cms.store.getByPath(`posts/${editorFile}`);
    const micropubPost = micropubSite.cms.store.getByPath(`posts/${micropubFile}`);
    assert.ok(editorPost !== undefined && micropubPost !== undefined);
    assert.equal(postTypeOf(micropubPost), 'reply');
    assert.equal(postTypeOf(micropubPost), postTypeOf(editorPost));
  });

  it('writes the same photo post the editor writes (TASK-166)', async () => {
    const editorSite = await site();
    const html = await (await editorSite.agent.get('/admin/posts/new')).text();
    const csrf = csrfField(html);
    assert.ok(csrf !== undefined);
    const saved = await editorSite.agent.post('/admin/posts/new', {
      csrf_token: csrf,
      date: '2026-09-19T09:00:00Z',
      'photo-url-0': 'https://peer.example/a.jpg',
      'photo-alt-0': 'A gull on a post',
      body: 'At the harbour.',
      action: 'publish',
    });
    assert.equal(saved.status, 303);

    const micropubSite = await site();
    const created = await postJson(micropubSite.cms, micropubSite.token, {
      type: ['h-entry'],
      properties: {
        content: ['At the harbour.'],
        photo: [{ value: 'https://peer.example/a.jpg', alt: 'A gull on a post' }],
        published: ['2026-09-19T09:00:00Z'],
      },
    });
    assert.equal(created.status, 201);

    const [editorFile] = await postFiles(editorSite.cms);
    const [micropubFile] = await postFiles(micropubSite.cms);
    assert.ok(editorFile !== undefined && micropubFile !== undefined);
    assert.equal(micropubFile, editorFile);
    assert.equal(
      await fileAt(micropubSite.cms, `posts/${micropubFile}`),
      await fileAt(editorSite.cms, `posts/${editorFile}`),
    );
  });

  for (const [label, properties, type] of [
    ['an untitled post', { content: ['Just a note.'] }, 'note'],
    ['a named post', { name: ['Named'], content: ['Its own words.'] }, 'article'],
  ] as const) {
    it(`gives ${label} the type Post Type Discovery gives it (${type})`, async () => {
      const { cms, token } = await site();
      const response = await postJson(cms, token, { type: ['h-entry'], properties });
      const location = response.headers.get('location');
      assert.ok(location !== null);
      const document = cms.store.getByPermalink(new URL(location).pathname);
      assert.ok(document !== undefined);
      assert.equal(postTypeOf(document), type);
    });
  }
});

/** Hand every request to peer.example an answer, and remember where each went. */
function recordOutboundRequests(): { urls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(href);
    if (new URL(href).origin !== 'https://peer.example') return await original(input, init);
    return new Response('', { status: 202 });
  }) as typeof fetch;
  return {
    urls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** A site with a follower to deliver to, whose posts link to peer.example. */
async function federatingSite(): Promise<Site> {
  const made = await site(['create'], { federation: { queue: null, allowPrivateAddress: true } });
  await addFollower(
    { admin: made.cms.admin, contentDir: made.cms.config.contentDir },
    FIRST_ADMIN.username,
    {
      actorId: 'https://peer.example/users/bob',
      inboxId: 'https://peer.example/users/bob/inbox',
      sharedInboxId: null,
      handle: '@bob@peer.example',
      name: 'Bob',
      iconUrl: null,
      url: 'https://peer.example/users/bob',
    },
  );
  return made;
}

async function quiet(cms: Cms): Promise<void> {
  await cms.delivery.settled();
  await cms.webmentions.settled();
  await cms.notifier.settled();
}

describe('who wrote it and who hears about it (AC #3, AC #4)', () => {
  it('is authored by the token’s user, sends webmentions and federates', async () => {
    const { cms, token } = await federatingSite();
    const outbound = recordOutboundRequests();
    try {
      const response = await postForm(cms, token, [
        ['h', 'entry'],
        ['content', 'Read [this](https://peer.example/page) today.'],
      ]);
      assert.equal(response.status, 201);
      await quiet(cms);
    } finally {
      outbound.restore();
    }

    const document = cms.store.getByPermalink('/2026/09/read-this-today/');
    assert.ok(document !== undefined);
    assert.equal(document.author, FIRST_ADMIN.username);
    assert.ok(
      cms.admin.lastDeliveryToObject(`${BASE}/2026/09/read-this-today/`) !== undefined,
      'the post was delivered to the follower',
    );
    assert.notDeepEqual(
      cms.admin.listSentWebmentions(document.slug),
      [],
      'the page it links to was sent a webmention',
    );
  });

  it('writes post-status draft as a draft that nobody hears about', async () => {
    const { cms, token } = await federatingSite();
    const outbound = recordOutboundRequests();
    let location: string | null;
    try {
      const response = await postForm(cms, token, [
        ['h', 'entry'],
        ['content', 'Not yet [this](https://peer.example/page).'],
        ['post-status', 'draft'],
      ]);
      assert.equal(response.status, 201);
      location = response.headers.get('location');
      await quiet(cms);
    } finally {
      outbound.restore();
    }

    assert.equal(location, `${BASE}/2026/09/not-yet-this/`);
    const document = cms.store.getByPermalink('/2026/09/not-yet-this/');
    assert.ok(document !== undefined);
    assert.equal(document.draft, true);
    assert.equal((await cms.app.request('/2026/09/not-yet-this/')).status, 404);
    assert.equal(cms.admin.lastDeliveryToObject(`${BASE}/2026/09/not-yet-this/`), undefined);
    assert.deepEqual(cms.admin.listSentWebmentions(document.slug), []);
    assert.deepEqual(
      outbound.urls.filter((url) => url.startsWith('https://peer.example/')),
      [],
      'nothing went to the page it links to or the follower',
    );
  });
});

describe('a refused create', () => {
  it('answers 403 insufficient_scope to a token without create (AC #5)', async () => {
    const { cms, token } = await site(['profile', 'update']);
    const response = await postForm(cms, token, [
      ['h', 'entry'],
      ['content', 'Should not land.'],
    ]);
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { error: string }).error, 'insufficient_scope');
    assert.match(response.headers.get('www-authenticate') ?? '', /scope="create"/);
    assert.deepEqual(await postFiles(cms), []);
  });

  it('still answers a query to a token without create', async () => {
    const { cms, token } = await site(['profile']);
    const response = await cms.app.request(`${ENDPOINT}?q=config`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
  });

  const refusals: {
    label: string;
    send: (cms: Cms, token: string) => Promise<Response>;
    names: string[];
  }[] = [
    {
      label: 'an rsvp, a type the site does not have',
      send: (cms, token) =>
        postJson(cms, token, {
          type: ['h-entry'],
          properties: { rsvp: ['yes'], 'in-reply-to': ['https://peer.example/an-event/'] },
        }),
      names: ['rsvp'],
    },
    {
      label: 'form properties the site does not understand',
      send: (cms, token) =>
        postForm(cms, token, [
          ['h', 'entry'],
          ['content', 'With a place'],
          ['checkin', 'https://places.example/cafe'],
          ['location', 'geo:1,2'],
        ]),
      names: ['checkin', 'location'],
    },
    {
      label: 'an h=event',
      send: (cms, token) =>
        postForm(cms, token, [
          ['h', 'event'],
          ['name', 'A party'],
        ]),
      names: ['h-event'],
    },
    {
      label: 'a JSON h-card',
      send: (cms, token) =>
        postJson(cms, token, { type: ['h-card'], properties: { name: ['Me'] } }),
      names: ['h-card'],
    },
    {
      label: 'two names for one post',
      send: (cms, token) =>
        postJson(cms, token, { type: ['h-entry'], properties: { name: ['One', 'Two'] } }),
      names: ['name'],
    },
    {
      label: 'a post-status the site does not have',
      send: (cms, token) =>
        postForm(cms, token, [
          ['h', 'entry'],
          ['content', 'Hm'],
          ['post-status', 'private'],
        ]),
      names: ['post-status'],
    },
    {
      label: 'an in-reply-to that is not a web address',
      send: (cms, token) =>
        postForm(cms, token, [
          ['h', 'entry'],
          ['content', 'Hm'],
          ['in-reply-to', 'not a url'],
        ]),
      names: ['In reply to'],
    },
  ];

  for (const { label, send, names } of refusals) {
    it(`answers 400 naming ${names.join(' and ')} for ${label}, and writes nothing (AC #6)`, async () => {
      const { cms, token } = await site();
      const response = await send(cms, token);
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string; error_description: string };
      assert.equal(body.error, 'invalid_request');
      for (const name of names)
        assert.ok(body.error_description.includes(name), body.error_description);
      assert.deepEqual(await postFiles(cms), []);
    });
  }

  it('answers 400 to a body that is neither a form nor JSON', async () => {
    const { cms, token } = await site();
    const response = await cms.app.request(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
      body: 'h=entry&content=hi',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await postFiles(cms), []);
  });
});

describe('a like, a repost and a bookmark (TASK-169 AC #5)', () => {
  const target = 'https://peer.example/a-post/';
  const cases = [
    { property: 'like-of', type: 'like' },
    { property: 'repost-of', type: 'repost' },
    { property: 'bookmark-of', type: 'bookmark' },
  ] as const;

  for (const { property, type } of cases) {
    it(`writes ${property} into the front matter and makes a ${type} post`, async () => {
      const { cms, token } = await site();
      const response = await postJson(cms, token, {
        type: ['h-entry'],
        properties: { [property]: [target], content: ['Worth it.'] },
      });
      assert.equal(response.status, 201, await response.clone().text());

      const [file] = await postFiles(cms);
      assert.ok(file !== undefined);
      const { data } = matter(await fileAt(cms, `posts/${file}`));
      assert.equal(data[property], target);
      const document = cms.store.getByPath(`posts/${file}`);
      assert.ok(document !== undefined);
      assert.equal(postTypeOf(document), type);
    });
  }

  it('takes one from a form-encoded create with no content at all', async () => {
    const { cms, token } = await site();
    const response = await postForm(cms, token, [
      ['h', 'entry'],
      ['like-of', target],
    ]);
    assert.equal(response.status, 201, await response.clone().text());
    const [file] = await postFiles(cms);
    assert.ok(file !== undefined);
    const document = cms.store.getByPath(`posts/${file}`);
    assert.ok(document !== undefined);
    assert.equal(postTypeOf(document), 'like');
  });

  it('writes the same like the editor writes for the same post', async () => {
    const editorSite = await site();
    const html = await (await editorSite.agent.get('/admin/posts/new')).text();
    const csrf = csrfField(html);
    assert.ok(csrf !== undefined);
    const saved = await editorSite.agent.post('/admin/posts/new', {
      csrf_token: csrf,
      date: '2026-09-19T09:00:00Z',
      'like-of': target,
      body: 'So good.',
      action: 'publish',
    });
    assert.equal(saved.status, 303);

    const micropubSite = await site();
    const created = await postForm(micropubSite.cms, micropubSite.token, [
      ['h', 'entry'],
      ['content', 'So good.'],
      ['like-of', target],
      ['published', '2026-09-19T09:00:00Z'],
    ]);
    assert.equal(created.status, 201);

    const [editorFile] = await postFiles(editorSite.cms);
    const [micropubFile] = await postFiles(micropubSite.cms);
    assert.ok(editorFile !== undefined && micropubFile !== undefined);
    assert.equal(micropubFile, editorFile);
    assert.equal(
      await fileAt(micropubSite.cms, `posts/${micropubFile}`),
      await fileAt(editorSite.cms, `posts/${editorFile}`),
    );
  });

  for (const { property } of cases) {
    it(`refuses a ${property} that is not a web address, and writes nothing`, async () => {
      const { cms, token } = await site();
      const response = await postForm(cms, token, [
        ['h', 'entry'],
        ['content', 'Hm'],
        [property, 'not a url'],
      ]);
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error_description: string };
      assert.match(body.error_description, /web address/);
      assert.deepEqual(await postFiles(cms), []);
    });
  }
});

describe('a photo post (TASK-166 AC #1)', () => {
  /** A site with a JPEG at /uploads/2026/09/beach.jpg, described in the media library. */
  async function photoSite(): Promise<Site> {
    const created = await site(['create']);
    const uploads = path.join(created.cms.config.contentDir, 'uploads', '2026', '09');
    await mkdir(uploads, { recursive: true });
    await writeFile(path.join(uploads, 'beach.jpg'), await jpeg());
    return created;
  }

  async function jpeg(): Promise<Uint8Array<ArrayBuffer>> {
    return Uint8Array.from(
      await sharp({
        create: { width: 40, height: 20, channels: 3, background: { r: 40, g: 90, b: 160 } },
      })
        .jpeg()
        .toBuffer(),
    );
  }

  async function postMultipart(cms: Cms, token: string, body: FormData): Promise<Response> {
    return await cms.app.request(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body,
    });
  }

  async function photosAt(cms: Cms, location: string | null): Promise<unknown> {
    assert.ok(location !== null, 'the create answered with a Location');
    const document = cms.store.getByPermalink(new URL(location).pathname);
    assert.ok(document !== undefined, 'the post is in the index');
    assert.equal(postTypeOf(document), 'photo');
    return matter(await fileAt(cms, document.path)).data['photo'];
  }

  async function uploadedFiles(cms: Cms): Promise<string[]> {
    try {
      const entries = await readdir(path.join(cms.config.contentDir, 'uploads'), {
        recursive: true,
        withFileTypes: true,
      });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  it('stores a photo given as a URL, this site’s own upload as its path', async () => {
    const { cms, token } = await photoSite();
    const response = await postJson(cms, token, {
      type: ['h-entry'],
      properties: {
        photo: [`${BASE}/uploads/2026/09/beach.jpg`, 'https://peer.example/a.jpg'],
      },
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await photosAt(cms, response.headers.get('location')), [
      { url: '/uploads/2026/09/beach.jpg' },
      { url: 'https://peer.example/a.jpg' },
    ]);
  });

  it('stores a photo given as { value, alt } with its alt text', async () => {
    const { cms, token } = await photoSite();
    const response = await postJson(cms, token, {
      type: ['h-entry'],
      properties: {
        content: ['At the beach.'],
        photo: [{ value: `${BASE}/uploads/2026/09/beach.jpg`, alt: 'Waves breaking at dusk' }],
      },
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await photosAt(cms, response.headers.get('location')), [
      { url: '/uploads/2026/09/beach.jpg', alt: 'Waves breaking at dusk' },
    ]);
  });

  it('stores form-encoded photo[] URLs', async () => {
    const { cms, token } = await photoSite();
    const response = await postForm(cms, token, [
      ['h', 'entry'],
      ['photo[]', `${BASE}/uploads/2026/09/beach.jpg`],
    ]);

    assert.equal(response.status, 201);
    assert.deepEqual(await photosAt(cms, response.headers.get('location')), [
      { url: '/uploads/2026/09/beach.jpg' },
    ]);
  });

  it('stores a multipart photo file in the media library and the post points at it', async () => {
    const { cms, token } = await photoSite();
    const body = new FormData();
    body.set('h', 'entry');
    body.set('content', 'Straight from the camera.');
    body.set('photo', new File([await jpeg()], 'Sunset.JPG', { type: 'image/jpeg' }));

    const response = await postMultipart(cms, token, body);

    assert.equal(response.status, 201);
    const photos = (await photosAt(cms, response.headers.get('location'))) as { url: string }[];
    assert.equal(photos.length, 1);
    assert.match(photos[0]?.url ?? '', /^\/uploads\/\d{4}\/\d{2}\/sunset\.jpg$/);
    const stored = await readFile(path.join(cms.config.contentDir, ...photos[0]!.url.split('/')));
    assert.ok(stored.byteLength > 0, 'the file is in the media library');
  });

  it('refuses a multipart photo that is not an image, and keeps nothing', async () => {
    const { cms, token } = await photoSite();
    const body = new FormData();
    body.set('h', 'entry');
    body.set('photo', new File(['just words'], 'notes.txt', { type: 'text/plain' }));

    const response = await postMultipart(cms, token, body);

    assert.equal(response.status, 400);
    assert.match(
      ((await response.json()) as { error_description: string }).error_description,
      /image/,
    );
    assert.deepEqual(await postFiles(cms), []);
    assert.deepEqual(await uploadedFiles(cms), ['beach.jpg']);
  });

  it('takes a stored photo back out when the post itself is refused', async () => {
    const { cms, token } = await photoSite();
    const body = new FormData();
    body.set('h', 'entry');
    body.set('in-reply-to', 'not a url');
    body.set('photo', new File([await jpeg()], 'sunset.jpg', { type: 'image/jpeg' }));

    const response = await postMultipart(cms, token, body);

    assert.equal(response.status, 400);
    assert.deepEqual(await postFiles(cms), []);
    assert.deepEqual(await uploadedFiles(cms), ['beach.jpg']);
  });

  it('refuses a photo that is not a web address, naming photo', async () => {
    const { cms, token } = await photoSite();
    for (const photo of ['beach.jpg', { alt: 'no value' }, 7]) {
      const response = await postJson(cms, token, {
        type: ['h-entry'],
        properties: { photo: [photo] },
      });
      assert.equal(response.status, 400, JSON.stringify(photo));
      assert.match(
        ((await response.json()) as { error_description: string }).error_description,
        /photo/,
      );
    }
    assert.deepEqual(await postFiles(cms), []);
  });
});

describe('an oversized create (TASK-216)', () => {
  const LIMITS: GeekityConfig = { uploadMaxBytes: 64, uploadMediaMaxBytes: 64 };

  function watchedBody(text: string): { body: ReadableStream<Uint8Array>; pulls: () => number } {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    return { body, pulls: () => pulls };
  }

  async function postDeclared(
    cms: Cms,
    token: string,
    type: string,
    body: ReadableStream<Uint8Array>,
  ): Promise<Response> {
    return await cms.app.request(
      new Request(`http://localhost${ENDPOINT}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': type,
          'content-length': String(64 * 1024 * 1024),
        },
        body,
        duplex: 'half',
      } as RequestInit),
    );
  }

  it('refuses a multipart create declared over the upload limit with 400 before reading its body', async () => {
    const { cms, token } = await site(['create'], LIMITS);
    const { body, pulls } = watchedBody(
      '--x\r\ncontent-disposition: form-data; name="h"\r\n\r\nentry\r\n--x--\r\n',
    );

    const response = await postDeclared(cms, token, 'multipart/form-data; boundary=x', body);

    assert.equal(response.status, 400);
    const answer = (await response.json()) as Record<string, string>;
    assert.equal(answer['error'], 'invalid_request');
    assert.match(answer['error_description'] ?? '', /too big/);
    assert.equal(pulls(), 0, 'nothing read the body');
    assert.deepEqual(await postFiles(cms), []);
  });

  it('holds a JSON create to the same limit', async () => {
    const { cms, token } = await site(['create'], LIMITS);
    const { body, pulls } = watchedBody('{"type":["h-entry"],"properties":{"content":["Hi"]}}');

    const response = await postDeclared(cms, token, 'application/json', body);

    assert.equal(response.status, 400);
    assert.equal(pulls(), 0, 'nothing read the body');
    assert.deepEqual(await postFiles(cms), []);
  });

  it('still takes a create within the limit and its envelope', async () => {
    const { cms, token } = await site(['create'], LIMITS);
    const response = await postJson(cms, token, {
      type: ['h-entry'],
      properties: { content: ['Small enough.'] },
    });
    assert.equal(response.status, 201);
  });
});
