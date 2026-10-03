/**
 * Quill (TASK-222): every request its note, article, bookmark, like and repost
 * flows send, replayed as aaronpk/Quill 691cee2 builds them, answers 201, and
 * the properties only Quill sends are treated as the site's own.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import matter from 'gray-matter';

import { FIRST_ADMIN, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { findUser } from '../admin/accounts.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const NOW = new Date('2026-09-20T12:00:00.000Z');

const TARGETS = JSON.stringify([{ id: 'news', name: 'News', url: 'https://news.example/en' }]);

interface Site {
  cms: Cms;
  token: string;
}

/** A site with one syndication target whose first admin holds Quill's default token. */
async function site(): Promise<Site> {
  const contentDir = await box.dir('geekity-micropub-quill-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(path.join(contentDir, '_data', 'syndicationTargets.json'), TARGETS, 'utf8');
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-micropub-quill-data-'),
    baseUrl: BASE,
    now: () => NOW,
  });
  await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined, 'the first admin exists');
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://quill.p3k.io/',
      redirectUri: 'https://quill.p3k.io/auth/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create', 'update', 'media', 'profile'],
    },
    NOW,
  );
  return { cms, token: accessToken };
}

type PhpParams = Record<string, string | readonly string[]>;

/**
 * Quill's micropub_post (lib/helpers.php) for a form: h=entry and the token
 * as access_token ahead of the params, encoded by PHP's http_build_query with
 * each `x[0]` rewritten to `x[]`.
 */
async function quillPost(cms: Cms, token: string, params: PhpParams): Promise<Response> {
  const fields: PhpParams = { h: 'entry', access_token: token, ...params };
  const pairs: [string, string][] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === 'string') pairs.push([name, value]);
    else value.forEach((item, i) => pairs.push([`${name}[${i}]`, item]));
  }
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(pairs).toString().replace(/%5B[0-9]+%5D/g, '%5B%5D'),
  });
}

/** Quill's micropub_post for JSON, which carries the token in the header only. */
async function quillJson(cms: Cms, token: string, body: object): Promise<Response> {
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

async function refusal(response: Response): Promise<string> {
  assert.equal(response.status, 400);
  const body = (await response.json()) as Record<string, string>;
  assert.equal(body['error'], 'invalid_request');
  return body['error_description'] ?? '';
}

async function update(cms: Cms, token: string, url: string, body: object): Promise<Response> {
  return await quillJson(cms, token, { action: 'update', url, ...body });
}

describe("Quill's own requests (AC #6)", () => {
  it('posts a note from its note editor as a form', async () => {
    const { cms, token } = await site();
    const location = await created(
      await quillPost(cms, token, {
        content: 'Hello from Quill.',
        category: ['indieweb', 'quill'],
        'mp-slug': 'hello-quill',
      }),
    );
    const { data, content } = matter(await fileOf(cms, location));
    assert.match(location, /hello-quill/);
    assert.deepEqual(data['tags'], ['indieweb', 'quill']);
    assert.equal(content.trim(), 'Hello from Quill.');
  });

  it('posts a note with a photo and its alt text as JSON', async () => {
    const { cms, token } = await site();
    const location = await created(
      await quillJson(cms, token, {
        type: ['h-entry'],
        properties: {
          content: ['A heron.'],
          photo: [{ value: 'https://photos.example/heron.jpg', alt: 'A heron on a post' }],
        },
      }),
    );
    assert.deepEqual(matter(await fileOf(cms, location)).data['photo'], [
      { url: 'https://photos.example/heron.jpg', alt: 'A heron on a post' },
    ]);
  });

  it('posts an article from its editor as a form, with HTML content', async () => {
    const { cms, token } = await site();
    const location = await created(
      await quillPost(cms, token, {
        name: ['A long read'],
        content: ['<p>First <b>paragraph</b>.</p>'],
        category: 'essays',
      }),
    );
    const { data, content } = matter(await fileOf(cms, location));
    assert.equal(data['title'], 'A long read');
    assert.equal(content.trim(), '<p>First <b>paragraph</b>.</p>');
  });

  it('posts an article as JSON { html } when the account opted into HTML content', async () => {
    const { cms, token } = await site();
    const location = await created(
      await quillJson(cms, token, {
        type: ['h-entry'],
        properties: {
          name: ['A long read'],
          content: [{ html: '<p>First paragraph.</p>' }],
          'post-status': ['draft'],
        },
      }),
    );
    const { data, content } = matter(await fileOf(cms, location));
    assert.equal(data['title'], 'A long read');
    assert.equal(data['draft'], true);
    assert.equal(content.trim(), '<p>First paragraph.</p>');
  });

  for (const [label, params, property] of [
    [
      'a bookmark',
      {
        'bookmark-of': 'https://example.org/article',
        name: 'An article',
        content: 'Worth reading.',
        category: ['reading'],
      },
      'bookmark-of',
    ],
    ['a like', { 'like-of': 'https://example.org/post' }, 'like-of'],
    ['a repost', { 'repost-of': 'https://example.org/post' }, 'repost-of'],
  ] as const) {
    it(`posts ${label} as a form`, async () => {
      const { cms, token } = await site();
      const location = await created(await quillPost(cms, token, params));
      assert.equal(matter(await fileOf(cms, location)).data[property], params[property]);
    });
  }
});

describe('the names accounts from before Quill’s migrations send (AC #1)', () => {
  it('takes slug and syndicate-to as mp-slug and mp-syndicate-to on a create', async () => {
    const { cms, token } = await site();
    const location = await created(
      await quillPost(cms, token, {
        content: 'Old account.',
        slug: 'old-account',
        'syndicate-to': ['news'],
        'post-status': 'draft',
      }),
    );
    assert.match(location, /old-account/);
    assert.deepEqual(matter(await fileOf(cms, location)).data['syndicate-to'], ['news']);
  });

  it('takes them in JSON too', async () => {
    const { cms, token } = await site();
    const location = await created(
      await quillJson(cms, token, {
        type: ['h-entry'],
        properties: {
          content: ['Old account.'],
          slug: ['old-json'],
          'syndicate-to': ['news'],
          'post-status': ['draft'],
        },
      }),
    );
    assert.match(location, /old-json/);
    assert.deepEqual(matter(await fileOf(cms, location)).data['syndicate-to'], ['news']);
  });

  it('takes syndicate-to on an update, and refuses slug as it refuses mp-slug', async () => {
    const { cms, token } = await site();
    const location = await created(
      await quillPost(cms, token, { content: 'Draft.', 'post-status': 'draft' }),
    );
    const replaced = await update(cms, token, location, { replace: { 'syndicate-to': ['news'] } });
    assert.equal(replaced.status, 204, await replaced.clone().text());
    assert.deepEqual(matter(await fileOf(cms, location)).data['syndicate-to'], ['news']);

    const moved = await update(cms, token, location, { replace: { slug: ['elsewhere'] } });
    assert.match(await refusal(moved), /mp-slug/);
  });

  it('refuses a syndicate-to target the site does not declare, as mp-syndicate-to', async () => {
    const { cms, token } = await site();
    const response = await quillPost(cms, token, { content: 'x', 'syndicate-to': ['myspace'] });
    assert.match(await refusal(response), /myspace/);
  });
});

describe('p3k-content-type (AC #3)', () => {
  for (const type of ['text/plain', 'text/markdown']) {
    it(`stores the content of a ${type} note as it stores one without it`, async () => {
      const { cms, token } = await site();
      const content = 'Some *emphasis* and `code`.';
      const plain = await created(await quillPost(cms, token, { content, 'mp-slug': 'without' }));
      const typed = await created(
        await quillPost(cms, token, { content, 'mp-slug': 'with', 'p3k-content-type': type }),
      );
      const without = matter(await fileOf(cms, plain));
      const withType = matter(await fileOf(cms, typed));
      assert.equal(withType.content, without.content);
      assert.equal('p3k-content-type' in withType.data, false, 'nothing about it is stored');
    });
  }

  for (const type of ['text/html', 'code/php']) {
    it(`refuses ${type}, naming it, on a create and an update`, async () => {
      const { cms, token } = await site();
      const create = await quillPost(cms, token, { content: 'x', 'p3k-content-type': type });
      assert.ok((await refusal(create)).includes(type));

      const location = await created(await quillPost(cms, token, { content: 'y' }));
      const changed = await update(cms, token, location, {
        replace: { 'p3k-content-type': [type] },
      });
      assert.ok((await refusal(changed)).includes(type));
    });
  }

  it('is accepted on an update and leaves the post as it was', async () => {
    const { cms, token } = await site();
    const location = await created(await quillPost(cms, token, { content: 'Stays.' }));
    const before = await fileOf(cms, location);
    const response = await update(cms, token, location, {
      replace: { content: ['Changed.'], 'p3k-content-type': ['text/markdown'] },
    });
    assert.equal(response.status, 204, await response.clone().text());
    assert.notEqual(await fileOf(cms, location), before);
    assert.equal(matter(await fileOf(cms, location)).content.trim(), 'Changed.');
  });
});

describe('visibility (AC #4)', () => {
  it('is advertised in q=config as public alone', async () => {
    const { cms, token } = await site();
    const response = await cms.app.request(`${ENDPOINT}?q=config`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const config = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(config['visibility'], ['public']);
  });

  it('takes visibility=public on a create and writes what it writes without it', async () => {
    const { cms, token } = await site();
    const plain = await created(
      await quillPost(cms, token, { content: 'Public.', 'mp-slug': 'plain' }),
    );
    const visible = await created(
      await quillPost(cms, token, {
        content: 'Public.',
        'mp-slug': 'visible',
        visibility: 'public',
      }),
    );
    const without = (await fileOf(cms, plain)).replace(/plain/g, 'SLUG');
    assert.equal((await fileOf(cms, visible)).replace(/visible/g, 'SLUG'), without);
  });

  it('takes visibility=public on an update and leaves the file as it was', async () => {
    const { cms, token } = await site();
    const location = await created(await quillPost(cms, token, { content: 'Public.' }));
    const before = await fileOf(cms, location);
    const response = await update(cms, token, location, { replace: { visibility: ['public'] } });
    assert.equal(response.status, 204, await response.clone().text());
    assert.equal(await fileOf(cms, location), before);
  });

  for (const [value, message] of [
    ['unlisted', /does not publish unlisted posts yet/],
    ['private', /does not publish private posts/],
  ] as const) {
    it(`refuses ${value} on a create and an update, saying so`, async () => {
      const { cms, token } = await site();
      const create = await quillPost(cms, token, { content: 'x', visibility: value });
      assert.match(await refusal(create), message);

      const location = await created(await quillPost(cms, token, { content: 'y' }));
      const changed = await update(cms, token, location, { replace: { visibility: [value] } });
      assert.match(await refusal(changed), message);
    });
  }
});
