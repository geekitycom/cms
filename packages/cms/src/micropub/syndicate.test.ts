/**
 * Micropub syndication (TASK-168): a client offers the site's own syndication
 * targets (TASK-155) and selects them on a create or an update, with the
 * effect the editor's checkboxes have.
 */
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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

/** A target that copies a post and answers with the copy, as IndieNews does. */
const NEWS = 'https://news.example/en';
const NEWS_ENDPOINT = 'https://news.example/webmention';
const NEWS_COPY = 'https://news.example/en/copy-of-the-post';

const TARGETS = JSON.stringify([
  { id: 'news', name: 'News', url: NEWS },
  { id: 'bridgy.fed', name: 'Bridgy Fed', url: 'https://fed.brid.gy/' },
]);

interface Site {
  cms: Cms;
  token: string;
}

async function site(files: Readonly<Record<string, string>> = {}): Promise<Site> {
  const contentDir = await box.dir('geekity-micropub-syndicate-content-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-micropub-syndicate-data-'),
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
      codeChallenge: 'unused',
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create', 'update'],
    },
    NOW,
  );
  return { cms, token: accessToken };
}

const withTargets = async (): Promise<Site> =>
  await site({ '_data/syndicationTargets.json': TARGETS });

async function query(cms: Cms, token: string, search: string): Promise<unknown> {
  const response = await cms.app.request(`${ENDPOINT}?${search}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  return await response.json();
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

async function frontMatterAt(cms: Cms, url: string): Promise<Record<string, unknown>> {
  const document = cms.store.getByPermalink(new URL(url).pathname);
  assert.ok(document !== undefined, `${url} is in the index`);
  const text = await readFile(
    path.join(cms.config.contentDir, ...document.path.split('/')),
    'utf8',
  );
  return matter(text).data;
}

async function copies(cms: Cms): Promise<unknown> {
  try {
    return JSON.parse(
      await readFile(path.join(cms.config.contentDir, '_data', 'syndication.json'), 'utf8'),
    );
  } catch {
    return {};
  }
}

/**
 * Answer news.example as a target that advertises an endpoint and copies what
 * it is sent, and remember each webmention it gets. Everything else passes
 * through, so only news.example's traffic is asserted on.
 */
function newsTarget(): { sent: { source: string; target: string }[]; restore: () => void } {
  const original = globalThis.fetch;
  const sent: { source: string; target: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== 'https://news.example') {
      return await original(input, init);
    }
    if (request.method === 'POST' && request.url === NEWS_ENDPOINT) {
      const body = new URLSearchParams(await request.text());
      sent.push({ source: body.get('source') ?? '', target: body.get('target') ?? '' });
      return new Response('', { status: 201, headers: { location: NEWS_COPY } });
    }
    return new Response(`<link rel="webmention" href="${NEWS_ENDPOINT}">`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }) as typeof fetch;
  return {
    sent,
    restore() {
      globalThis.fetch = original;
    },
  };
}

async function quiet(cms: Cms): Promise<void> {
  await cms.delivery.settled();
  await cms.webmentions.settled();
  await cms.notifier.settled();
}

describe('the targets a client is offered (AC #1)', () => {
  const OFFERED = [
    { uid: 'news', name: 'News' },
    { uid: 'bridgy.fed', name: 'Bridgy Fed' },
  ];

  it('lists every declared target with its uid and name in q=syndicate-to', async () => {
    const { cms, token } = await withTargets();
    assert.deepEqual(await query(cms, token, 'q=syndicate-to'), { 'syndicate-to': OFFERED });
  });

  it('lists them in q=config too', async () => {
    const { cms, token } = await withTargets();
    const config = (await query(cms, token, 'q=config')) as Record<string, unknown>;
    assert.deepEqual(config['syndicate-to'], OFFERED);
  });

  it('lists a target added after the site started', async () => {
    const { cms, token } = await site();
    assert.deepEqual(await query(cms, token, 'q=syndicate-to'), { 'syndicate-to': [] });
    const config = (await query(cms, token, 'q=config')) as Record<string, unknown>;
    assert.deepEqual(config['syndicate-to'], []);

    await mkdir(path.join(cms.config.contentDir, '_data'), { recursive: true });
    await writeFile(path.join(cms.config.contentDir, '_data', 'syndicationTargets.json'), TARGETS);
    assert.deepEqual(await query(cms, token, 'q=syndicate-to'), { 'syndicate-to': OFFERED });
  });
});

describe('selecting targets on a create (AC #2)', () => {
  it('writes them to syndicate-to and syndicates the post as the editor would', async () => {
    const { cms, token } = await withTargets();
    const news = newsTarget();
    let location: string | null;
    try {
      const response = await postForm(cms, token, [
        ['h', 'entry'],
        ['content', 'Worth a share.'],
        ['mp-syndicate-to[]', 'news'],
      ]);
      assert.equal(response.status, 201, await response.clone().text());
      location = response.headers.get('location');
      await quiet(cms);
    } finally {
      news.restore();
    }

    assert.ok(location !== null);
    assert.deepEqual((await frontMatterAt(cms, location))['syndicate-to'], ['news']);
    assert.deepEqual(news.sent, [{ source: location, target: NEWS }], 'the target was told');
    assert.deepEqual(await copies(cms), { [new URL(location).pathname]: { [NEWS]: NEWS_COPY } });
    const html = await (await cms.app.request(new URL(location).pathname)).text();
    assert.ok(html.includes(NEWS_COPY), 'the post prints the copy the target made');
  });

  it('takes JSON, and writes each target once', async () => {
    const { cms, token } = await withTargets();
    const response = await postJson(cms, token, {
      type: ['h-entry'],
      properties: {
        content: ['Twice over.'],
        'mp-syndicate-to': ['bridgy.fed', 'news', 'bridgy.fed'],
        'post-status': ['draft'],
      },
    });
    assert.equal(response.status, 201, await response.clone().text());
    const location = response.headers.get('location');
    assert.ok(location !== null);
    assert.deepEqual((await frontMatterAt(cms, location))['syndicate-to'], ['bridgy.fed', 'news']);
  });
});

describe('an unknown target (AC #3)', () => {
  it('gets 400 invalid_request naming it, and nothing is written', async () => {
    const { cms, token } = await withTargets();
    const response = await postForm(cms, token, [
      ['h', 'entry'],
      ['content', 'Nowhere to go.'],
      ['mp-syndicate-to', 'news'],
      ['mp-syndicate-to', 'myspace'],
    ]);

    assert.equal(response.status, 400);
    const body = (await response.json()) as Record<string, string>;
    assert.equal(body['error'], 'invalid_request');
    assert.match(body['error_description'] ?? '', /myspace/);
    assert.doesNotMatch(body['error_description'] ?? '', /\bnews\b/);
    const posts = await readdir(path.join(cms.config.contentDir, 'posts')).catch(() => []);
    assert.deepEqual(posts, [], 'no post file was written');
  });

  it('is refused on an update too, and the post is left as it was', async () => {
    const { cms, token } = await withTargets();
    const created = await postJson(cms, token, {
      type: ['h-entry'],
      properties: { content: ['Stay put.'], 'post-status': ['draft'] },
    });
    const url = created.headers.get('location');
    assert.ok(url !== null);
    const before = await frontMatterAt(cms, url);

    const response = await postJson(cms, token, {
      action: 'update',
      url,
      add: { 'mp-syndicate-to': ['myspace'] },
    });
    assert.equal(response.status, 400);
    assert.match(
      ((await response.json()) as Record<string, string>)['error_description'] ?? '',
      /myspace/,
    );
    assert.deepEqual(await frontMatterAt(cms, url), before);
  });
});

describe('changing targets on an update (AC #4)', () => {
  const POST = [
    '---',
    'title: Shared',
    "date: '2026-09-01T09:00:00Z'",
    'permalink: /2026/09/shared/',
    'author: admin',
    'syndicate-to: [news, elsewhere]',
    '---',
    '',
    'Shared.',
    '',
  ].join('\n');
  const URL_OF_POST = `${BASE}/2026/09/shared/`;

  async function shared(): Promise<Site> {
    return await site({
      '_data/syndicationTargets.json': TARGETS,
      'posts/2026-09-01-shared.md': POST.replace(
        'author: admin',
        `author: ${FIRST_ADMIN.username}`,
      ),
    });
  }

  it('reports the selected targets in q=source, leaving out ids the site does not declare', async () => {
    const { cms, token } = await shared();
    const source = (await query(cms, token, `q=source&url=${encodeURIComponent(URL_OF_POST)}`)) as {
      properties: Record<string, unknown>;
    };
    assert.deepEqual(source.properties['mp-syndicate-to'], ['news']);
  });

  it('adds a target, keeping an id the file lists that the site does not declare', async () => {
    const { cms, token } = await shared();
    const response = await postJson(cms, token, {
      action: 'update',
      url: URL_OF_POST,
      add: { 'mp-syndicate-to': ['bridgy.fed'] },
    });
    assert.equal(response.status, 204, await response.clone().text());
    assert.deepEqual((await frontMatterAt(cms, URL_OF_POST))['syndicate-to'], [
      'news',
      'bridgy.fed',
      'elsewhere',
    ]);
  });

  it('removes a target, which is told the post no longer links to it', async () => {
    const { cms, token } = await shared();
    const news = newsTarget();
    try {
      const response = await postJson(cms, token, {
        action: 'update',
        url: URL_OF_POST,
        delete: { 'mp-syndicate-to': ['news'] },
      });
      assert.equal(response.status, 204, await response.clone().text());
      await quiet(cms);
    } finally {
      news.restore();
    }

    assert.deepEqual((await frontMatterAt(cms, URL_OF_POST))['syndicate-to'], ['elsewhere']);
    assert.deepEqual(
      news.sent,
      [{ source: URL_OF_POST, target: NEWS }],
      'the deselected target was told again',
    );
    const html = await (await cms.app.request('/2026/09/shared/')).text();
    assert.ok(!html.includes(NEWS), 'the post no longer links to the target');
  });

  it('leaves the targets as they were when an update does not name them', async () => {
    const { cms, token } = await shared();
    const response = await postJson(cms, token, {
      action: 'update',
      url: URL_OF_POST,
      replace: { content: ['Shared again.'] },
    });
    assert.equal(response.status, 204, await response.clone().text());
    assert.deepEqual((await frontMatterAt(cms, URL_OF_POST))['syndicate-to'], [
      'news',
      'elsewhere',
    ]);
  });

  it('takes every target away when the property is deleted', async () => {
    const { cms, token } = await shared();
    const response = await postJson(cms, token, {
      action: 'update',
      url: URL_OF_POST,
      delete: ['mp-syndicate-to'],
    });
    assert.equal(response.status, 204, await response.clone().text());
    assert.deepEqual((await frontMatterAt(cms, URL_OF_POST))['syndicate-to'], ['elsewhere']);
  });
});
