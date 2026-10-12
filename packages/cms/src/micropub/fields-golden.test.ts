import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import { FIRST_ADMIN, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import { findUser } from '../site/users.ts';

remoteHostsDoNotExist();

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const NOW = new Date('2026-09-20T12:00:00.000Z');
const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fields-golden.json');

const TARGETS = JSON.stringify([
  { id: 'news', name: 'News', url: 'https://news.example/' },
  { id: 'bridgy.fed', name: 'Bridgy Fed', url: 'https://fed.brid.gy/' },
]);

async function site(): Promise<{ cms: Cms; token: string }> {
  const contentDir = await box.dir('geekity-micropub-golden-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(path.join(contentDir, '_data', 'syndicationTargets.json'), TARGETS, 'utf8');
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-micropub-golden-data-'),
    baseUrl: BASE,
    now: () => NOW,
  });
  await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined);
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create', 'update'],
    },
    NOW,
  );
  return { cms, token: accessToken };
}

async function send(cms: Cms, token: string, body: unknown): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function frame(cms: Cms, token: string, url: string): Promise<unknown> {
  const document = cms.store.getByPermalink(new URL(url).pathname);
  assert.ok(document !== undefined, `${url} is in the index`);
  const file = await readFile(
    path.join(cms.config.contentDir, ...document.path.split('/')),
    'utf8',
  );
  const response = await cms.app.request(`${ENDPOINT}?q=source&url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const source = (await response.json()) as { type: unknown; properties: Record<string, unknown> };
  return {
    path: document.path,
    file,
    source: { ...source, properties: sorted(source.properties) },
  };
}

function sorted(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)));
}

const CREATES: Readonly<Record<string, object>> = {
  entry: {
    type: ['h-entry'],
    properties: {
      name: ['Every field'],
      content: ['Some words.'],
      summary: ['A summary'],
      category: ['one', 'two'],
      'in-reply-to': ['https://events.example/party'],
      rsvp: ['yes'],
      'repost-of': ['https://elsewhere.example/reposted'],
      'like-of': ['https://elsewhere.example/liked'],
      'bookmark-of': ['https://elsewhere.example/bookmarked'],
      published: ['2026-09-01T10:00:00Z'],
      visibility: ['unlisted'],
      photo: [
        'https://images.example/one.jpg',
        { value: 'https://images.example/two.jpg', alt: 'Two' },
      ],
      location: ['geo:45.5,-122.6'],
      'mp-syndicate-to': ['news'],
      'mp-slug': ['every-field'],
      'post-status': ['draft'],
      'x-kept': ['kept as sent'],
    },
  },
  read: {
    type: ['h-entry'],
    properties: {
      'read-status': ['finished'],
      'read-of': [
        {
          type: ['h-cite'],
          properties: {
            name: ['A Book'],
            author: ['An Author'],
            uid: ['isbn:9780000000000'],
            url: ['https://books.example/a-book'],
          },
        },
      ],
      'post-status': ['draft'],
    },
  },
  event: {
    type: ['h-event'],
    properties: {
      name: ['A party'],
      start: ['2026-10-01 18:00'],
      end: ['2026-10-01 22:00'],
      location: ['The hall'],
      checkin: [
        {
          type: ['h-card'],
          properties: { name: ['The hall'], latitude: ['45.5'], longitude: ['-122.6'] },
        },
      ],
      'post-status': ['draft'],
    },
  },
};

const UPDATES: Readonly<Record<string, readonly object[]>> = {
  entry: [
    { replace: { rsvp: ['maybe'], 'like-of': ['https://elsewhere.example/liked-again'] } },
    { delete: ['repost-of', 'bookmark-of'] },
    { add: { photo: ['https://images.example/three.jpg'] } },
    { replace: { 'mp-syndicate-to': ['bridgy.fed'], summary: ['Another summary'] } },
    { delete: ['photo', 'location'] },
    { replace: { 'x-kept': ['changed'] } },
  ],
  read: [
    { replace: { 'read-status': ['reading'] } },
    {
      replace: {
        'read-of': [{ type: ['h-cite'], properties: { name: ['Another Book'] } }],
      },
    },
  ],
  event: [{ replace: { end: ['2026-10-01 23:30'] } }, { replace: { location: ['The park'] } }],
};

const REFUSED: Readonly<Record<string, object>> = {
  rsvp: { 'in-reply-to': ['https://events.example/party'], rsvp: ['perhaps'] },
  'repost-of': { 'repost-of': ['not a url'] },
  'like-of': { 'like-of': ['not a url'] },
  'bookmark-of': { 'bookmark-of': ['not a url'] },
  'read-status': {
    'read-status': ['skimmed'],
    'read-of': [{ type: ['h-cite'], properties: { name: ['A Book'] } }],
  },
  'read-of': { 'read-of': ['A Book'] },
  photo: { photo: ['not a url'] },
  'mp-syndicate-to': { content: ['Hi'], 'mp-syndicate-to': ['nowhere'] },
  'event-only': { content: ['Hi'], start: ['2026-10-01 18:00'] },
};

describe('Micropub field mapping (TASK-353 AC #4)', () => {
  it('writes and reads back every field as it did before the table', async () => {
    const { cms, token } = await site();
    const frames: Record<string, unknown> = {};

    for (const [name, create] of Object.entries(CREATES)) {
      const response = await send(cms, token, create);
      assert.equal(response.status, 201, `${name}: ${await response.clone().text()}`);
      const url = response.headers.get('location');
      assert.ok(url !== null);
      frames[`${name} created`] = await frame(cms, token, url);
      for (const [index, change] of (UPDATES[name] ?? []).entries()) {
        const updated = await send(cms, token, { action: 'update', url, ...change });
        assert.ok(updated.status < 300, `${name} update ${String(index)}: ${await updated.text()}`);
        frames[`${name} update ${String(index)}`] = await frame(cms, token, url);
      }
    }

    for (const [name, properties] of Object.entries(REFUSED)) {
      const response = await send(cms, token, { type: ['h-entry'], properties });
      frames[`${name} refused`] = { status: response.status, body: await response.json() };
    }

    if (process.env['GOLDEN_UPDATE'] === '1') {
      await writeFile(GOLDEN, `${JSON.stringify(frames, null, 2)}\n`, 'utf8');
    }
    const expected: unknown = JSON.parse(await readFile(GOLDEN, 'utf8'));
    assert.equal(JSON.stringify(frames, null, 2), JSON.stringify(expected, null, 2));
  });
});
