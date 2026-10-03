/**
 * The Micropub endpoint's read side (TASK-163): what a client is told when it
 * asks what the site supports, and what it is refused.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { createUser } from '../admin/accounts.ts';
import type { AuthorizationCode } from '../indieauth/grants.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const RESOURCE_METADATA = `${BASE}/.well-known/oauth-protected-resource`;

const POSTS: Record<string, string> = {
  'posts/2026-09-01-one.md':
    "---\ntitle: One\ndate: '2026-09-01T09:00:00Z'\nauthor: ada\ntags: [IndieWeb, micropub]\ncategories: [Notes]\n---\n\nOne.\n",
  'posts/2026-09-02-two.md':
    "---\ntitle: Two\ndate: '2026-09-02T09:00:00Z'\nauthor: ada\ntags: [indieauth, IndieWeb]\ncategories: [Essays]\n---\n\nTwo.\n",
  'posts/2026-09-03-draft.md':
    "---\ntitle: Draft\ndate: '2026-09-03T09:00:00Z'\nauthor: ada\ndraft: true\ntags: [unannounced]\n---\n\nSoon.\n",
};

interface Site {
  cms: Cms;
  token: string;
}

async function site(grant: Partial<AuthorizationCode> = {}): Promise<Site> {
  const contentDir = await box.dir('geekity-micropub-content-');
  const dataDir = await box.dir('geekity-micropub-data-');
  for (const [relative, contents] of Object.entries(POSTS)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  const cms = await box.open({ contentDir, dataDir, baseUrl: BASE });
  const { accessToken } = await issueTokens(
    dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/ada/`,
      scopes: ['create'],
      ...grant,
    },
    new Date(),
  );
  return { cms, token: accessToken };
}

async function query(cms: Cms, token: string, params: string): Promise<Response> {
  return await cms.app.request(`${ENDPOINT}?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('q=config', () => {
  it('names the media endpoint, the syndication targets and the post types the site accepts', async () => {
    const { cms, token } = await site();
    const response = await query(cms, token, 'q=config');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const config = (await response.json()) as Record<string, unknown>;
    assert.equal(config['media-endpoint'], `${BASE}/_geekity/micropub/media`);
    assert.deepEqual(config['syndicate-to'], []);
    const postTypes = config['post-types'] as { type: string; name: string }[];
    assert.deepEqual(
      postTypes.map(({ type, name }) => ({ type, name })),
      [
        { type: 'note', name: 'Note' },
        { type: 'article', name: 'Article' },
        { type: 'reply', name: 'Reply' },
        { type: 'photo', name: 'Photo' },
        { type: 'like', name: 'Like' },
        { type: 'repost', name: 'Repost' },
        { type: 'bookmark', name: 'Bookmark' },
        { type: 'read', name: 'Read' },
      ],
    );
    assert.deepEqual(config['q'], ['config', 'syndicate-to', 'category', 'source']);
  });

  it('accepts a token bound to the site as its resource', async () => {
    const { cms, token } = await site({ resource: BASE });
    assert.equal((await query(cms, token, 'q=config')).status, 200);
  });
});

describe('q=syndicate-to', () => {
  it('answers the same list q=config does', async () => {
    const { cms, token } = await site();
    const response = await query(cms, token, 'q=syndicate-to');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { 'syndicate-to': [] });
  });
});

describe('q=category', () => {
  it('lists every tag and category on a published post once, alphabetically', async () => {
    const { cms, token } = await site();
    const response = await query(cms, token, 'q=category');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      categories: ['Essays', 'indieauth', 'IndieWeb', 'micropub', 'Notes'],
    });
  });

  it('keeps only the terms containing filter, whatever their case', async () => {
    const { cms, token } = await site();
    const response = await query(cms, token, 'q=category&filter=INDIE');
    assert.deepEqual(await response.json(), { categories: ['indieauth', 'IndieWeb'] });
  });

  it('answers an empty list when nothing matches', async () => {
    const { cms, token } = await site();
    const response = await query(cms, token, 'q=category&filter=unannounced');
    assert.deepEqual(await response.json(), { categories: [] });
  });
});

describe('a refused query', () => {
  it('answers 401 with a challenge naming the resource metadata when no token came', async () => {
    const { cms } = await site();
    const response = await cms.app.request(`${ENDPOINT}?q=config`);
    assert.equal(response.status, 401);
    assert.equal(((await response.json()) as { error: string }).error, 'unauthorized');
    assert.match(
      response.headers.get('www-authenticate') ?? '',
      new RegExp(`^Bearer .*resource_metadata="${RESOURCE_METADATA}"`),
    );
  });

  it('answers 401 invalid_token for a token the site never issued', async () => {
    const { cms } = await site();
    const response = await query(cms, 'not-a-token', 'q=config');
    assert.equal(response.status, 401);
    assert.equal(((await response.json()) as { error: string }).error, 'invalid_token');
  });

  it('answers 401 for a token bound to another resource', async () => {
    const { cms, token } = await site({ resource: `${BASE}/mcp` });
    assert.equal((await query(cms, token, 'q=config')).status, 401);
  });

  for (const params of ['q=nonsense', '', 'q=']) {
    it(`answers 400 invalid_request for "?${params}"`, async () => {
      const { cms, token } = await site();
      const response = await query(cms, token, params);
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string; error_description: string };
      assert.equal(body.error, 'invalid_request');
      assert.ok(body.error_description.length > 0);
    });
  }
});
