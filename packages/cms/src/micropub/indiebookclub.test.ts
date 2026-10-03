/**
 * indiebookclub's read posts (TASK-229), replayed as it sends them: JSON built
 * by build_micropub_request (app/Controller/IbcController.php), always with
 * summary, read-status, an h-cite read-of, post-status and visibility, and
 * published and category when the user gave them. No content and no name.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import matter from 'gray-matter';
import { mf2 } from 'microformats-parser';

import { FIRST_ADMIN, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { findUser } from '../admin/accounts.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';

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
  const cms = await box.open({
    contentDir: await box.dir('geekity-micropub-ibc-content-'),
    dataDir: await box.dir('geekity-micropub-ibc-data-'),
    baseUrl: BASE,
    now: () => NOW,
  });
  await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined, 'the first admin exists');
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://indiebookclub.biz/',
      redirectUri: 'https://indiebookclub.biz/auth/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create', 'update'],
    },
    NOW,
  );
  return { cms, token: accessToken };
}

async function post(cms: Cms, token: string, body: object): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function created(response: Response): Promise<string> {
  assert.equal(response.status, 201, await response.clone().text());
  const location = response.headers.get('location');
  assert.ok(location !== null, 'a 201 names the post');
  return location;
}

async function fileOf(cms: Cms, url: string): Promise<string> {
  const document = cms.store.getByPermalink(new URL(url).pathname);
  assert.ok(document !== undefined, `${url} is in the index`);
  return await readFile(path.join(cms.config.contentDir, ...document.path.split('/')), 'utf8');
}

async function source(cms: Cms, token: string, url: string): Promise<Record<string, unknown[]>> {
  const response = await cms.app.request(`${ENDPOINT}?q=source&url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  return ((await response.json()) as { properties: Record<string, unknown[]> }).properties;
}

const INDIEBOOKCLUB_DOCS_EXAMPLE = {
  type: ['h-entry'],
  properties: {
    summary: ['Want to read: The Left Hand of Darkness by Ursula K. Le Guin, ISBN: 9780441478125'],
    'read-status': ['to-read'],
    'read-of': [
      {
        type: ['h-cite'],
        properties: {
          name: ['The Left Hand of Darkness'],
          author: ['Ursula K. Le Guin'],
          uid: ['isbn:9780441478125'],
        },
      },
    ],
    visibility: ['public'],
    'post-status': ['published'],
  },
};

const READ_OF = INDIEBOOKCLUB_DOCS_EXAMPLE.properties['read-of'][0];

const STORED = {
  name: 'The Left Hand of Darkness',
  author: 'Ursula K. Le Guin',
  uid: 'isbn:9780441478125',
};

describe("indiebookclub's read posts (TASK-229)", () => {
  it('answers its documented request with 201 and writes read-of and read-status', async () => {
    const { cms, token } = await site();
    const location = await created(await post(cms, token, INDIEBOOKCLUB_DOCS_EXAMPLE));
    assert.match(location, /\/the-left-hand-of-darkness\/$/, 'its URL names what was read');

    const { data, content } = matter(await fileOf(cms, location));
    assert.equal(data['read-status'], 'to-read');
    assert.deepEqual(data['read-of'], STORED);
    assert.equal(data['description'], INDIEBOOKCLUB_DOCS_EXAMPLE.properties.summary[0]);
    assert.equal(content.trim(), '');
  });

  it('takes published and category when they are given, and a doi with no author', async () => {
    const { cms, token } = await site();
    const location = await created(
      await post(cms, token, {
        type: ['h-entry'],
        properties: {
          summary: ['Finished reading: A Paper, doi:10.1000/182'],
          'read-status': ['finished'],
          'read-of': [
            { type: ['h-cite'], properties: { name: ['A Paper'], uid: ['doi:10.1000/182'] } },
          ],
          'post-status': ['published'],
          visibility: ['public'],
          published: ['2026-09-19 08:30:00-05:00'],
          category: ['science', 'reading'],
        },
      }),
    );
    const { data } = matter(await fileOf(cms, location));
    assert.equal(data['read-status'], 'finished');
    assert.deepEqual(data['read-of'], { name: 'A Paper', uid: 'doi:10.1000/182' });
    assert.deepEqual(data['tags'], ['science', 'reading']);
    assert.equal(new Date(String(data['date'])).toISOString(), '2026-09-19T13:30:00.000Z');
  });

  it('round-trips both through q=source and an update', async () => {
    const { cms, token } = await site();
    const location = await created(await post(cms, token, INDIEBOOKCLUB_DOCS_EXAMPLE));

    const properties = await source(cms, token, location);
    assert.deepEqual(properties['read-status'], ['to-read']);
    assert.deepEqual(properties['read-of'], [READ_OF]);

    const update = await post(cms, token, {
      action: 'update',
      url: location,
      replace: { 'read-status': ['reading'] },
    });
    assert.equal(update.status, 204, await update.clone().text());
    const after = await source(cms, token, location);
    assert.deepEqual(after['read-status'], ['reading']);
    assert.deepEqual(after['read-of'], [READ_OF], 'the work read is left as it was');

    const sentBack = await post(cms, token, {
      action: 'update',
      url: location,
      replace: { 'read-of': after['read-of'], 'read-status': ['finished'] },
    });
    assert.equal(sentBack.status, 204, await sentBack.clone().text());
    const { data } = matter(await fileOf(cms, location));
    assert.equal(data['read-status'], 'finished');
    assert.deepEqual(data['read-of'], STORED);
  });

  it('refuses a read-status it does not know and a read-of that is no h-cite', async () => {
    const { cms, token } = await site();
    for (const [properties, message] of [
      [{ ...INDIEBOOKCLUB_DOCS_EXAMPLE.properties, 'read-status': ['abandoned'] }, /read-status/],
      [
        { ...INDIEBOOKCLUB_DOCS_EXAMPLE.properties, 'read-of': ['The Left Hand of Darkness'] },
        /read-of/,
      ],
      [{ ...INDIEBOOKCLUB_DOCS_EXAMPLE.properties, 'read-of': [] }, /read/i],
    ] as const) {
      const response = await post(cms, token, { type: ['h-entry'], properties });
      assert.equal(response.status, 400);
      const body = (await response.json()) as Record<string, string>;
      assert.match(body['error_description'] ?? '', message);
    }
    assert.equal(cms.store.listAll({ type: 'post' }).length, 0, 'and nothing was written');
  });

  it('is a read on q=config', async () => {
    const { cms, token } = await site();
    const response = await cms.app.request(`${ENDPOINT}?q=config`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const config = (await response.json()) as { 'post-types': { type: string }[] };
    assert.ok(config['post-types'].some(({ type }) => type === 'read'));
  });

  it('prints p-read-status and a p-read-of h-cite on its page', async () => {
    const { cms, token } = await site();
    const location = await created(await post(cms, token, INDIEBOOKCLUB_DOCS_EXAMPLE));
    const html = await (await cms.app.request(new URL(location).pathname)).text();

    const entry = mf2(html, { baseUrl: location }).items.find((item) =>
      item.type?.includes('h-entry'),
    );
    assert.ok(entry !== undefined, 'the page is an h-entry');
    assert.deepEqual(entry.properties['read-status'], ['to-read']);
    const [cite] = entry.properties['read-of'] ?? [];
    assert.ok(typeof cite === 'object' && 'type' in cite, 'read-of is an embedded item');
    assert.deepEqual(cite.type, ['h-cite']);
    assert.deepEqual(cite.properties['name'], ['The Left Hand of Darkness']);
    assert.deepEqual(cite.properties['author'], ['Ursula K. Le Guin']);
    assert.deepEqual(cite.properties['uid'], ['isbn:9780441478125']);
    assert.match(
      html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' '),
      /Want to read: The Left Hand of Darkness by Ursula K\. Le Guin, ISBN: 9780441478125/,
      'and says it in words',
    );

    const home = mf2(await (await cms.app.request('/')).text(), { baseUrl: BASE });
    const listed = home.items
      .flatMap((item) => [item, ...(item.children ?? [])])
      .find((item) => item.type?.includes('h-entry'));
    assert.deepEqual(listed?.properties['read-status'], ['to-read'], 'and so does a listing');
  });

  it('federates as a Note whose content says what was read', async () => {
    const { cms, token } = await site();
    const location = await created(await post(cms, token, INDIEBOOKCLUB_DOCS_EXAMPLE));
    const object = (await (
      await cms.app.request(new URL(location).pathname, {
        headers: { accept: 'application/activity+json' },
      })
    ).json()) as { type: string; content: string };

    assert.equal(object.type, 'Note');
    assert.match(
      object.content,
      /Want to read: <cite>The Left Hand of Darkness<\/cite> by Ursula K\. Le Guin, ISBN: 9780441478125/,
    );
  });
});
