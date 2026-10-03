/**
 * q=config's post types (TASK-228): each type lists the properties a create of
 * that type accepts, so a client that reads the list, as Micropublish does,
 * never offers a field the site refuses.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { FIRST_ADMIN, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { findUser } from '../admin/accounts.ts';
import { postTypeOf } from '../content/post-type.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const NOW = new Date('2026-09-20T12:00:00.000Z');

const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (() => Promise.resolve(new Response('', { status: 404 }))) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

/** A value createForm accepts for each property a listing may name. */
const SAMPLES: Readonly<Record<string, unknown>> = {
  name: 'A title of its own',
  content: 'Words that do not open with the title.',
  summary: 'A summary.',
  category: 'indieweb',
  location: 'geo:37.786971,-122.399677',
  published: '2026-09-19T10:00:00Z',
  'post-status': 'published',
  visibility: 'public',
  'mp-slug': 'a-slug',
  'mp-syndicate-to': 'news',
  'in-reply-to': 'https://peer.example/a-post',
  'like-of': 'https://peer.example/liked',
  'repost-of': 'https://peer.example/reposted',
  'bookmark-of': 'https://peer.example/bookmarked',
  photo: 'https://peer.example/photo.jpg',
  'read-of': {
    type: ['h-cite'],
    properties: { name: ['A Book'], author: ['An Author'], uid: ['isbn:9780000000000'] },
  },
  'read-status': 'finished',
};

/** Micropublish's own known properties (config/properties.json), and the legacy names Quill sends. */
const CANDIDATES = [
  'in-reply-to',
  'repost-of',
  'like-of',
  'bookmark-of',
  'rsvp',
  'name',
  'content',
  'summary',
  'published',
  'category',
  'mp-syndicate-to',
  'syndication',
  'mp-slug',
  'checkin',
  'post-status',
  'visibility',
  'mp-channel',
  'photo',
  'listen-of',
  'ate',
  'drank',
  'location',
  'slug',
  'syndicate-to',
  'p3k-content-type',
];

interface PostTypeEntry {
  type: string;
  name: string;
  properties: string[];
  'required-properties': string[];
}

interface Site {
  cms: Cms;
  token: string;
}

async function site(): Promise<Site> {
  const contentDir = await box.dir('geekity-micropub-post-types-content-');
  const targets = path.join(contentDir, '_data', 'syndicationTargets.json');
  await mkdir(path.dirname(targets), { recursive: true });
  await writeFile(
    targets,
    JSON.stringify([{ id: 'news', name: 'News', url: 'https://news.example/' }]),
    'utf8',
  );
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-micropub-post-types-data-'),
    baseUrl: BASE,
    now: () => NOW,
  });
  await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined, 'the first admin exists');
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create'],
    },
    NOW,
  );
  return { cms, token: accessToken };
}

async function postTypes({ cms, token }: Site): Promise<PostTypeEntry[]> {
  const response = await cms.app.request(`${ENDPOINT}?q=config`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  const config = (await response.json()) as { 'post-types': PostTypeEntry[] };
  return config['post-types'];
}

async function create(
  { cms, token }: Site,
  names: readonly string[],
  value: (name: string) => unknown = (name) => SAMPLES[name],
): Promise<Response> {
  const properties = Object.fromEntries(names.map((name) => [name, [value(name)]]));
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: ['h-entry'], properties }),
  });
}

async function createdType(made: Site, response: Response): Promise<string> {
  const body = response.status === 201 ? '' : await response.text();
  assert.equal(response.status, 201, body);
  const location = response.headers.get('location');
  assert.ok(location !== null);
  const document = made.cms.store.getByPermalink(new URL(location).pathname);
  assert.ok(document !== undefined, `${location} was written`);
  await made.cms.webmentions.settled();
  await made.cms.delivery.settled();
  return postTypeOf(document);
}

describe('q=config post-types properties (AC #1, AC #2)', () => {
  it('lists, for each type, the properties and the required properties a client offers', async () => {
    const entries = await postTypes(await site());
    const shared = [
      'content',
      'summary',
      'category',
      'location',
      'published',
      'post-status',
      'visibility',
      'mp-slug',
      'mp-syndicate-to',
    ];
    assert.deepEqual(
      Object.fromEntries(
        entries.map((entry) => [
          entry.type,
          { properties: entry.properties, required: entry['required-properties'] },
        ]),
      ),
      {
        note: { properties: shared, required: ['content'] },
        article: {
          properties: ['name', ...shared],
          required: ['name', 'content'],
        },
        reply: { properties: ['in-reply-to', 'name', ...shared], required: ['in-reply-to'] },
        photo: { properties: ['photo', 'name', ...shared], required: ['photo'] },
        like: { properties: ['like-of', 'name', ...shared], required: ['like-of'] },
        repost: { properties: ['repost-of', 'name', ...shared], required: ['repost-of'] },
        bookmark: { properties: ['bookmark-of', 'name', ...shared], required: ['bookmark-of'] },
        read: {
          properties: ['read-of', 'read-status', 'name', ...shared],
          required: ['read-of', 'read-status'],
        },
      },
    );
  });

  it('accepts a create of each type carrying every property it lists, as a post of that type', async () => {
    const made = await site();
    for (const entry of await postTypes(made)) {
      const response = await create(made, entry.properties);
      assert.equal(await createdType(made, response), entry.type, entry.type);
    }
  });

  it('accepts a create of each type carrying only its required properties, as a post of that type', async () => {
    const made = await site();
    for (const entry of await postTypes(made)) {
      const response = await create(made, entry['required-properties']);
      assert.equal(await createdType(made, response), entry.type, entry.type);
    }
  });

  it('lists no property a create refuses as not understood', async () => {
    const made = await site();
    const listed = new Set((await postTypes(made)).flatMap((entry) => entry.properties));
    const refused: string[] = [];
    for (const name of CANDIDATES) {
      const response = await create(
        made,
        ['content', name],
        (property) => SAMPLES[property] ?? 'a value',
      );
      if (response.status !== 400) continue;
      const { error_description: description } = (await response.json()) as {
        error_description: string;
      };
      if (description.includes(`does not understand ${name}`)) refused.push(name);
    }
    assert.deepEqual(refused, [
      'rsvp',
      'syndication',
      'checkin',
      'mp-channel',
      'listen-of',
      'ate',
      'drank',
    ]);
    assert.deepEqual(
      refused.filter((name) => listed.has(name)),
      [],
    );
  });

  it('lists the current names, not the legacy ones or a property that changes nothing', async () => {
    const listed = new Set((await postTypes(await site())).flatMap((entry) => entry.properties));
    for (const name of ['slug', 'syndicate-to', 'p3k-content-type']) {
      assert.equal(listed.has(name), false, name);
    }
  });
});
