/**
 * Micropub create (TASK-164): a client posts an h-entry and the site writes
 * the post the admin editor would have written.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

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
      label: 'a like-of, a type the site does not have yet',
      send: (cms, token) =>
        postJson(cms, token, {
          type: ['h-entry'],
          properties: { 'like-of': ['https://peer.example/a-post/'] },
        }),
      names: ['like-of'],
    },
    {
      label: 'form properties the site does not understand',
      send: (cms, token) =>
        postForm(cms, token, [
          ['h', 'entry'],
          ['content', 'With a photo'],
          ['photo', 'https://peer.example/a.jpg'],
          ['location', 'geo:1,2'],
        ]),
      names: ['photo', 'location'],
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
