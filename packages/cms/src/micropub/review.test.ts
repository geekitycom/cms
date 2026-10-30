import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import matter from 'gray-matter';

import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import { FIRST_ADMIN, sandbox } from '../admin/__testing__/harness.ts';
import { postTypeOf } from '../content/post-type.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { findUser } from '../site/users.ts';

remoteHostsDoNotExist();

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const NOW = new Date('2026-09-20T12:00:00.000Z');

interface Site {
  cms: Cms;
  token: string;
}

async function site(): Promise<Site> {
  const contentDir = await box.dir('geekity-micropub-review-content-');
  const dataDir = await box.dir('geekity-micropub-review-data-');
  writeUsers(dataDir);
  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE,
    now: () => NOW,
  });
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
      scopes: ['create', 'update'],
    },
    NOW,
  );
  return { cms, token: accessToken };
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

async function created(response: Response): Promise<string> {
  assert.equal(response.status, 201, await response.clone().text());
  const location = response.headers.get('location');
  assert.ok(location !== null, 'a 201 names the post');
  return location;
}

async function refusal(response: Response): Promise<string> {
  assert.equal(response.status, 400);
  const body = (await response.json()) as Record<string, string>;
  assert.equal(body['error'], 'invalid_request');
  return body['error_description'] ?? '';
}

async function fileOf(cms: Cms, url: string): Promise<string> {
  const document = cms.store.getByPermalink(new URL(url).pathname);
  assert.ok(document !== undefined, `${url} is in the index`);
  return await readFile(path.join(cms.config.contentDir, ...document.path.split('/')), 'utf8');
}

async function source(cms: Cms, token: string, url: string): Promise<Record<string, unknown>> {
  const response = await cms.app.request(`${ENDPOINT}?q=source&url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  return (await response.json()) as Record<string, unknown>;
}

const MOVIE = {
  type: ['h-cite'],
  properties: {
    kind: ['movie'],
    name: ['Dune: Part Two'],
    author: ['Denis Villeneuve'],
    published: ['2024'],
    uid: ['https://www.themoviedb.org/movie/693134'],
    photo: [{ value: 'https://images.example/dune.jpg', alt: 'The poster' }],
    date: ['2026-10-18'],
  },
};

describe('a Micropub review (TASK-432)', () => {
  it('creates an h-review and reads it back with q=source', async () => {
    const { cms, token } = await site();
    const url = await created(
      await postJson(cms, token, {
        type: ['h-review'],
        properties: { item: [MOVIE], rating: ['4'], content: ['Loud and long.'] },
      }),
    );
    const { data, content } = matter(await fileOf(cms, url));
    assert.equal(data['rating'], 4);
    assert.deepEqual(data['item'], {
      kind: 'movie',
      name: 'Dune: Part Two',
      by: 'Denis Villeneuve',
      year: 2024,
      uid: 'https://www.themoviedb.org/movie/693134',
      photo: { url: 'https://images.example/dune.jpg', alt: 'The poster' },
      date: '2026-10-18',
    });
    assert.equal(content.trim(), 'Loud and long.');
    const document = cms.store.getByPermalink(new URL(url).pathname);
    assert.ok(document !== undefined);
    assert.equal(postTypeOf(document), 'review');

    const read = await source(cms, token, url);
    assert.deepEqual(read['type'], ['h-review']);
    const properties = read['properties'] as Record<string, unknown[]>;
    assert.deepEqual(properties['item'], [MOVIE]);
    assert.deepEqual(properties['rating'], ['4']);
  });

  it('creates a place review from an h-entry with an h-card item, and no rating', async () => {
    const { cms, token } = await site();
    const url = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: {
          item: [
            {
              type: ['h-card'],
              properties: {
                name: ['Blue Door Coffee'],
                category: ['Coffee shop'],
                locality: ['Grand Rapids'],
                url: ['https://bluedoor.example'],
              },
            },
          ],
          content: ['Good coffee.'],
        },
      }),
    );
    const { data } = matter(await fileOf(cms, url));
    assert.equal(data['rating'], undefined);
    assert.deepEqual(data['item'], {
      kind: 'place',
      name: 'Blue Door Coffee',
      category: 'Coffee shop',
      locality: 'Grand Rapids',
      url: 'https://bluedoor.example',
    });
    const read = await source(cms, token, url);
    assert.deepEqual(read['type'], ['h-review']);
  });

  it('creates one form-encoded, with h=review and the item’s name', async () => {
    const { cms, token } = await site();
    const url = await created(
      await postForm(cms, token, [
        ['h', 'review'],
        ['item', 'The corner bakery'],
        ['rating', '5'],
        ['content', 'Best bread in town.'],
      ]),
    );
    const { data } = matter(await fileOf(cms, url));
    assert.deepEqual(data['item'], { kind: 'other', name: 'The corner bakery' });
    assert.equal(data['rating'], 5);
  });

  it('keeps the item and rating through an update to the content', async () => {
    const { cms, token } = await site();
    const url = await created(
      await postJson(cms, token, {
        type: ['h-review'],
        properties: { item: [MOVIE], rating: ['4'], content: ['Loud.'] },
      }),
    );
    const response = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { content: ['Loud and long.'], rating: ['5'] },
    });
    assert.ok(response.status === 200 || response.status === 204, await response.text());
    const { data, content } = matter(await fileOf(cms, url));
    assert.equal(data['rating'], 5);
    assert.equal((data['item'] as Record<string, unknown>)['name'], 'Dune: Part Two');
    assert.equal(content.trim(), 'Loud and long.');
  });

  for (const rating of ['0', '6', '4.5', 'great']) {
    it(`refuses a rating of ${rating}, naming the field`, async () => {
      const { cms, token } = await site();
      const message = await refusal(
        await postJson(cms, token, {
          type: ['h-review'],
          properties: { item: [MOVIE], rating: [rating], content: ['Hm.'] },
        }),
      );
      assert.match(message, new RegExp(`rating is a whole number from 1 to 5, not ${rating}\\.`));
    });
  }

  it('refuses an h-review with no item', async () => {
    const { cms, token } = await site();
    const message = await refusal(
      await postJson(cms, token, {
        type: ['h-review'],
        properties: { rating: ['3'], content: ['Hm.'] },
      }),
    );
    assert.match(message, /item/);
  });

  it('refuses an invented id prefix', async () => {
    const { cms, token } = await site();
    const item = { ...MOVIE, properties: { ...MOVIE.properties, uid: ['imdb:tt15239678'] } };
    const message = await refusal(
      await postJson(cms, token, {
        type: ['h-review'],
        properties: { item: [item], content: ['Hm.'] },
      }),
    );
    assert.match(message, /isbn:… or doi:…/);
  });

  it('offers reviews in q=config', async () => {
    const { cms, token } = await site();
    const response = await cms.app.request(`${ENDPOINT}?q=config`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const config = (await response.json()) as {
      'post-types': { type: string; 'required-properties': string[] }[];
    };
    const review = config['post-types'].find((type) => type.type === 'review');
    assert.deepEqual(review?.['required-properties'], ['item']);
  });
});
