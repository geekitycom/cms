/**
 * Micropub update, delete and source (TASK-167): a client reads a post back,
 * edits it, deletes it and brings it back, through the editor's own paths.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { csrfField, FIRST_ADMIN, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { createUser, findUser } from '../admin/accounts.ts';
import { addFollower } from '../federation/records.ts';
import type { Scope } from '../indieauth/request.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms, GeekityConfig } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const NOW = new Date('2026-09-20T12:00:00.000Z');
const ALL: Scope[] = ['create', 'update', 'delete'];

interface Site {
  cms: Cms;
  agent: Browser;
  token: string;
}

/** A site whose first admin, ada, holds a token with `scopes`. */
async function site(
  scopes: Scope[] = ALL,
  config: GeekityConfig = {},
  files: Readonly<Record<string, string>> = {},
): Promise<Site> {
  const contentDir = await box.dir('geekity-micropub-update-content-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-micropub-update-data-'),
    baseUrl: BASE,
    now: () => NOW,
    ...config,
  });
  const agent = await signedIn(cms);
  return { cms, agent, token: await tokenFor(cms, FIRST_ADMIN.username, scopes) };
}

async function tokenFor(cms: Cms, username: string, scopes: Scope[]): Promise<string> {
  const user = findUser(cms.config.dataDir, username);
  assert.ok(user !== undefined, `${username} exists`);
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: user.id,
      me: `${BASE}/author/${user.username}/`,
      scopes,
    },
    NOW,
  );
  return accessToken;
}

async function postJson(cms: Cms, token: string, body: unknown): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
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

async function query(cms: Cms, token: string, search: string): Promise<Response> {
  return await cms.app.request(`${ENDPOINT}?${search}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Create a post over Micropub and answer its absolute URL. */
async function created(cms: Cms, token: string, properties: object): Promise<string> {
  const response = await postJson(cms, token, { type: ['h-entry'], properties });
  assert.equal(response.status, 201, await response.clone().text());
  const location = response.headers.get('location');
  assert.ok(location !== null);
  return location;
}

function documentAt(cms: Cms, url: string) {
  const document = cms.store.getByPermalink(new URL(url).pathname);
  assert.ok(document !== undefined, `${url} is in the index`);
  return document;
}

async function fileOf(cms: Cms, url: string): Promise<string> {
  return await readFile(
    path.join(cms.config.contentDir, ...documentAt(cms, url).path.split('/')),
    'utf8',
  );
}

const ARTICLE = {
  name: ['A title'],
  content: ['Some words.'],
  summary: ['About it'],
  category: ['one', 'two'],
  published: ['2026-09-18T08:30:00-05:00'],
};

describe('q=source (AC #1)', () => {
  it('answers the post’s properties in the create mapping', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, {
      ...ARTICLE,
      'in-reply-to': ['https://peer.example/a-post/'],
      photo: [
        { value: 'https://images.example/cat.jpg', alt: 'A cat' },
        'https://images.example/dog.jpg',
      ],
    });

    const response = await query(cms, token, `q=source&url=${encodeURIComponent(url)}`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      type: ['h-entry'],
      properties: {
        name: ['A title'],
        content: ['Some words.'],
        summary: ['About it'],
        category: ['one', 'two'],
        'in-reply-to': ['https://peer.example/a-post/'],
        published: ['2026-09-18T13:30:00Z'],
        'post-status': ['published'],
        visibility: ['public'],
        photo: [
          { value: 'https://images.example/cat.jpg', alt: 'A cat' },
          'https://images.example/dog.jpg',
        ],
      },
    });
  });

  it('answers a like, a repost and a bookmark under their own properties (TASK-169)', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, {
      'like-of': ['https://peer.example/liked/'],
      'repost-of': ['https://peer.example/reposted/'],
      'bookmark-of': ['https://peer.example/kept/'],
      content: ['Three at once.'],
    });

    const response = await query(cms, token, `q=source&url=${encodeURIComponent(url)}`);

    const body = (await response.json()) as { properties: Record<string, unknown[]> };
    assert.deepEqual(body.properties['like-of'], ['https://peer.example/liked/']);
    assert.deepEqual(body.properties['repost-of'], ['https://peer.example/reposted/']);
    assert.deepEqual(body.properties['bookmark-of'], ['https://peer.example/kept/']);
  });

  it('leaves out what the post does not have, and says draft for a draft', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, { content: ['Just a note.'], 'post-status': ['draft'] });

    const response = await query(cms, token, `q=source&url=${encodeURIComponent(url)}`);

    assert.deepEqual(await response.json(), {
      type: ['h-entry'],
      properties: {
        content: ['Just a note.'],
        published: ['2026-09-20T12:00:00Z'],
        'post-status': ['draft'],
        visibility: ['public'],
      },
    });
  });

  it('answers this site’s own upload as an absolute URL a create takes back', async () => {
    const { cms, token } = await site();
    const uploads = path.join(cms.config.contentDir, 'uploads', '2026', '09');
    await mkdir(uploads, { recursive: true });
    const jpeg = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 40, g: 90, b: 160 } },
    })
      .jpeg()
      .toBuffer();
    await writeFile(path.join(uploads, 'cat.jpg'), Uint8Array.from(jpeg));
    const url = await created(cms, token, {
      content: ['A photo.'],
      photo: [`${BASE}/uploads/2026/09/cat.jpg`],
    });
    const file = await fileOf(cms, url);
    assert.match(file, /url: \/uploads\/2026\/09\/cat\.jpg/);

    const response = await query(cms, token, `q=source&url=${encodeURIComponent(url)}`);

    const body = (await response.json()) as { properties: Record<string, unknown[]> };
    assert.deepEqual(body.properties['photo'], [`${BASE}/uploads/2026/09/cat.jpg`]);
    const sentBack = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { photo: body.properties['photo'] },
    });
    assert.equal(sentBack.status, 204);
    assert.equal(await fileOf(cms, url), file, 'sending the source back changes nothing');
  });

  it('limits the answer to the properties[] asked for, without the type', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, ARTICLE);

    const response = await query(
      cms,
      token,
      `q=source&url=${encodeURIComponent(url)}&properties[]=content&properties[]=category&properties[]=location`,
    );

    assert.deepEqual(await response.json(), {
      properties: { content: ['Some words.'], category: ['one', 'two'] },
    });
  });

  it('is listed among the queries q=config names', async () => {
    const { cms, token } = await site();
    const config = (await (await query(cms, token, 'q=config')).json()) as { q: string[] };
    assert.ok(config.q.includes('source'));
  });
});

describe('updating a like, a repost and a bookmark (TASK-169)', () => {
  it('replaces one citation and deletes another', async () => {
    const { cms, token } = await site(ALL);
    const url = await created(cms, token, {
      'like-of': ['https://peer.example/liked/'],
      'bookmark-of': ['https://peer.example/kept/'],
      content: ['Two at once.'],
    });

    const response = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { 'bookmark-of': ['https://peer.example/kept-instead/'] },
      delete: ['like-of'],
    });

    assert.equal(response.status, 204, await response.clone().text());
    const document = documentAt(cms, url);
    assert.equal(document.extra['bookmark-of'], 'https://peer.example/kept-instead/');
    assert.equal(document.extra['like-of'], undefined);
  });
});

describe('action=update (AC #2)', () => {
  it('replaces, adds and deletes only the properties it names', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, ARTICLE);
    const before = documentAt(cms, url);

    const response = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { content: ['New words.'] },
      add: { category: ['three'] },
      delete: { category: ['one'] },
    });

    assert.equal(response.status, 204, await response.clone().text());
    const after = documentAt(cms, url);
    assert.equal(after.body.trim(), 'New words.');
    assert.deepEqual(after.tags, ['two', 'three']);
    assert.equal(after.title, before.title);
    assert.equal(after.description, before.description);
    assert.equal(after.date, before.date);
    assert.equal(after.permalink, before.permalink);
    assert.equal(after.path, before.path);
    assert.equal(after.author, FIRST_ADMIN.username);
  });

  it('deletes whole properties named in a list', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, ARTICLE);

    const response = await postJson(cms, token, {
      action: 'update',
      url,
      delete: ['summary', 'category'],
    });

    assert.equal(response.status, 204);
    const after = documentAt(cms, url);
    assert.equal(after.description, undefined);
    assert.deepEqual(after.tags, []);
    assert.equal(after.title, 'A title');
  });

  it('turns a draft into a published post with post-status', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, { content: ['Soon.'], 'post-status': ['draft'] });
    assert.equal((await cms.app.request(new URL(url).pathname)).status, 404);

    const response = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { 'post-status': ['published'] },
    });

    assert.equal(response.status, 204);
    assert.equal(documentAt(cms, url).draft, false);
    assert.equal((await cms.app.request(new URL(url).pathname)).status, 200);
  });

  it('answers 201 with the new URL when re-dating a draft moves it', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, { content: ['Later.'], 'post-status': ['draft'] });
    assert.equal(url, `${BASE}/2026/09/later/`);

    const response = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { published: ['2026-10-05T09:00:00Z'] },
    });

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('location'), `${BASE}/2026/10/later/`);
  });

  it('federates an Update to the post’s followers', async () => {
    const { cms, token } = await federatingSite();
    const outbound = recordOutboundRequests();
    try {
      const url = await created(cms, token, { content: ['First words.'] });
      await quiet(cms);
      assert.equal(cms.admin.lastDeliveryToObject(url)?.activityType, 'Create');

      const response = await postJson(cms, token, {
        action: 'update',
        url,
        replace: { content: ['Second words.'] },
      });
      assert.equal(response.status, 204);
      await quiet(cms);

      assert.equal(cms.admin.lastDeliveryToObject(url)?.activityType, 'Update');
    } finally {
      outbound.restore();
    }
  });

  for (const [label, update, named] of [
    [
      'a property it does not map',
      { replace: { checkin: ['https://places.example/'] } },
      /checkin/,
    ],
    ['mp-slug', { replace: { 'mp-slug': ['moved'] } }, /mp-slug/],
    ['a second name', { add: { name: ['Another'] } }, /name takes one value/],
    ['replace that is not an object', { replace: ['content'] }, /replace/],
    ['delete of a value that is not a list', { delete: { category: 'one' } }, /category/],
  ] as const) {
    it(`answers 400 to ${label}, and writes nothing`, async () => {
      const { cms, token } = await site();
      const url = await created(cms, token, ARTICLE);
      const file = await fileOf(cms, url);

      const response = await postJson(cms, token, { action: 'update', url, ...update });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string; error_description: string };
      assert.equal(body.error, 'invalid_request');
      assert.match(body.error_description, named);
      assert.equal(await fileOf(cms, url), file);
    });
  }

  it('answers 400 to a form-encoded update, which the spec makes JSON', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, ARTICLE);

    const response = await postForm(cms, token, [
      ['action', 'update'],
      ['url', url],
    ]);

    assert.equal(response.status, 400);
  });
});

describe('action=delete and action=undelete (AC #3)', () => {
  it('takes the post off the site, its feeds and search, and brings it back', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, {
      name: ['Zanzibar notes'],
      content: ['Words about zanzibar.'],
    });
    const pathname = new URL(url).pathname;
    const visible = async (): Promise<Record<string, boolean>> => ({
      page: (await cms.app.request(pathname)).status === 200,
      feed: (await (await cms.app.request('/feed/')).text()).includes(url),
      search: (await (await cms.app.request('/search/?q=zanzibar')).text()).includes(pathname),
    });
    assert.deepEqual(await visible(), { page: true, feed: true, search: true });

    const deleted = await postForm(cms, token, [
      ['action', 'delete'],
      ['url', url],
    ]);
    assert.equal(deleted.status, 204);
    assert.deepEqual(await visible(), { page: false, feed: false, search: false });

    const restored = await postJson(cms, token, { action: 'undelete', url });
    assert.equal(restored.status, 204);
    assert.deepEqual(await visible(), { page: true, feed: true, search: true });
  });

  it('moves the file into the trash the way the editor does', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, { content: ['Bin me.'] });
    const live = documentAt(cms, url).path;

    await postJson(cms, token, { action: 'delete', url });

    assert.equal(documentAt(cms, url).path, `_trash/${live}`);
    await postJson(cms, token, { action: 'undelete', url });
    assert.equal(documentAt(cms, url).path, live);
  });

  it('answers 204 to deleting a deleted post and undeleting a live one', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, { content: ['Twice.'] });

    assert.equal((await postJson(cms, token, { action: 'undelete', url })).status, 204);
    assert.equal((await postJson(cms, token, { action: 'delete', url })).status, 204);
    assert.equal((await postJson(cms, token, { action: 'delete', url })).status, 204);
    assert.ok(documentAt(cms, url).path.startsWith('_trash/'));
  });

  it('federates a Delete', async () => {
    const { cms, token } = await federatingSite();
    const outbound = recordOutboundRequests();
    try {
      const url = await created(cms, token, { content: ['Gone soon.'] });
      await quiet(cms);

      assert.equal((await postJson(cms, token, { action: 'delete', url })).status, 204);
      await quiet(cms);

      assert.equal(cms.admin.lastDeliveryToObject(url)?.activityType, 'Delete');
    } finally {
      outbound.restore();
    }
  });
});

describe('which post a URL names (AC #4)', () => {
  async function siteWithOthers(): Promise<Site & { grace: string; page: string }> {
    const made = await site(
      ALL,
      {},
      {
        'posts/2026-09-01-graces.md':
          "---\ntitle: Grace's\ndate: '2026-09-01T09:00:00Z'\npermalink: /2026/09/graces/\nauthor: grace\n---\n\nHers.\n",
        'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nA page.\n',
      },
    );
    await createUser({
      dataDir: made.cms.config.dataDir,
      username: 'grace',
      password: 'another horse battery',
    });
    return { ...made, grace: `${BASE}/2026/09/graces/`, page: `${BASE}/about/` };
  }

  const requests: readonly [string, (url: string) => [string, unknown]][] = [
    ['q=source', (url) => ['GET', `q=source&url=${encodeURIComponent(url)}`]],
    ['update', (url) => ['POST', { action: 'update', url, replace: { content: ['x'] } }]],
    ['delete', (url) => ['POST', { action: 'delete', url }]],
    ['undelete', (url) => ['POST', { action: 'undelete', url }]],
  ];

  async function send(cms: Cms, token: string, request: [string, unknown]): Promise<Response> {
    const [method, payload] = request;
    return method === 'GET'
      ? await query(cms, token, payload as string)
      : await postJson(cms, token, payload);
  }

  for (const [label, request] of requests) {
    it(`answers ${label} with 400 for a URL that is not a post on this site`, async () => {
      const { cms, token, page } = await siteWithOthers();
      for (const url of [
        `${BASE}/2026/09/nothing-here/`,
        'https://elsewhere.example/2026/09/graces/',
        page,
        'not a url',
      ]) {
        const response = await send(cms, token, request(url));
        assert.equal(response.status, 400, `${url} is refused`);
        assert.equal(((await response.json()) as { error: string }).error, 'invalid_request');
      }
    });

    it(`answers ${label} with 403 for a post another user wrote`, async () => {
      const { cms, token, grace } = await siteWithOthers();
      const before = await readFile(
        path.join(cms.config.contentDir, 'posts', '2026-09-01-graces.md'),
        'utf8',
      );

      const response = await send(cms, token, request(grace));

      assert.equal(response.status, 403);
      assert.equal(((await response.json()) as { error: string }).error, 'forbidden');
      assert.equal(
        await readFile(path.join(cms.config.contentDir, 'posts', '2026-09-01-graces.md'), 'utf8'),
        before,
      );
    });
  }

  it('answers 400 when the url is missing', async () => {
    const { cms, token } = await site();
    assert.equal((await query(cms, token, 'q=source')).status, 400);
    assert.equal((await postJson(cms, token, { action: 'delete' })).status, 400);
  });
});

describe('scopes (AC #5)', () => {
  for (const [action, needs, body] of [
    ['update', 'update', { replace: { content: ['x'] } }],
    ['delete', 'delete', {}],
    ['undelete', 'delete', {}],
  ] as const) {
    it(`refuses ${action} to a token without ${needs}, and answers one with it`, async () => {
      const { cms, token } = await site();
      const url = await created(cms, token, { content: ['Scoped.'] });
      const others = ALL.filter((scope) => scope !== needs);
      const without = await tokenFor(cms, FIRST_ADMIN.username, others);
      const file = await fileOf(cms, url);

      const refused = await postJson(cms, without, { action, url, ...body });
      assert.equal(refused.status, 403);
      assert.equal(((await refused.json()) as { error: string }).error, 'insufficient_scope');
      assert.equal(await fileOf(cms, url), file);

      const only = await tokenFor(cms, FIRST_ADMIN.username, [needs]);
      assert.equal((await postJson(cms, only, { action, url, ...body })).status, 204);
    });
  }
});

describe('an editor with the post open (AC #6)', () => {
  it('reports the conflict when the post was updated over Micropub', async () => {
    const { cms, agent, token } = await site();
    const url = await created(cms, token, { content: ['What the editor loaded.'] });
    const slug = documentAt(cms, url).slug;

    const form = await (await agent.get(`/admin/posts/${slug}`)).text();
    const csrf = csrfField(form);
    const hash = /name="hash"[^>]*value="([^"]*)"/.exec(form)?.[1];
    assert.ok(csrf !== undefined && hash !== undefined);

    const updated = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { content: ['What the phone wrote.'] },
    });
    assert.equal(updated.status, 204);

    const saved = await agent.post(`/admin/posts/${slug}`, {
      csrf_token: csrf,
      hash,
      title: '',
      slug,
      permalink: new URL(url).pathname,
      date: '',
      tags: '',
      description: '',
      body: 'What I wrote in the editor.',
      action: 'update',
    });

    assert.equal(saved.status, 409);
    const html = await saved.text();
    assert.match(html, /What the phone wrote\./, 'the conflict shows the Micropub version');
    assert.match(await fileOf(cms, url), /What the phone wrote\./, 'and the file keeps it');
  });
});

/** Hand every request to peer.example an answer, and pass the rest through. */
function recordOutboundRequests(): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(href).origin !== 'https://peer.example') return await original(input, init);
    return new Response('', { status: 202 });
  }) as typeof fetch;
  return {
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** A site with a follower on peer.example to deliver to. */
async function federatingSite(): Promise<Site> {
  const made = await site(ALL, { federation: { queue: null, allowPrivateAddress: true } });
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
