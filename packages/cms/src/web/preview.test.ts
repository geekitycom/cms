/**
 * A post the public site does not serve, read at its permalink by the person
 * signed in (TASK-235): iA Writer posts a draft over Micropub and opens the URL
 * it was handed, which has to show the author the draft and nobody else
 * anything at all.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { sessionCookieName } from '../admin/session.ts';
import type { Cms } from '../index.ts';

const BASE_URL = 'https://blog.example';
const NOW = new Date('2026-09-20T12:00:00.000Z');

const box = sandbox();
after(() => box.cleanup());

function post(slug: string, date: string, extra: readonly string[] = []): string {
  return [
    '---',
    `title: The ${slug} post`,
    `date: '${date}'`,
    `permalink: /${slug}/`,
    'tags: [lanterns]',
    ...extra,
    '---',
    '',
    `Words about lanterns, ${slug}.`,
    '',
  ].join('\n');
}

const HIDDEN = {
  draft: '/draft/',
  scheduled: '/scheduled/',
  unrecognized: '/unrecognized/',
} as const;

const TRASHED = '/trashed/';
const UNKNOWN = '/no-such-thing/';

const CONTENT: Record<string, string> = {
  'posts/2026-09-01-published.md': post('published', '2026-09-01T09:00:00Z'),
  'posts/2026-09-02-draft.md': post('draft', '2026-09-02T09:00:00Z', ['draft: true']),
  'posts/2026-10-01-scheduled.md': post('scheduled', '2026-10-01T09:00:00Z'),
  'posts/2026-09-03-unrecognized.md': post('unrecognized', '2026-09-03T09:00:00Z', [
    'visibility: members-only',
  ]),
  '_trash/posts/2026-09-04-trashed.md': post('trashed', '2026-09-04T09:00:00Z'),
};

async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-preview-content-');
  const dataDir = await box.dir('geekity-preview-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  return await box.open({ contentDir, dataDir, baseUrl: BASE_URL, watch: false, now: () => NOW });
}

/** A request with whatever headers it names, carrying the browser's session when given one. */
async function request(
  cms: Cms,
  url: string,
  options: {
    agent?: Browser | undefined;
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
  } = {},
): Promise<Response> {
  const session = options.agent?.session();
  const headers = {
    ...options.headers,
    ...(session === undefined ? {} : { cookie: `${sessionCookieName(cms.config)}=${session}` }),
  };
  return await cms.app.request(url, { method: options.method ?? 'GET', headers });
}

/**
 * Status, headers and body, less the clock and the URL itself: a 404 page
 * names the address it was asked for, whatever lived there.
 */
async function snapshot(
  response: Response,
  url: string,
): Promise<{ status: number; headers: [string, string][]; body: string }> {
  const headers = [...response.headers.entries()].filter(([name]) => name !== 'date');
  const body = (await response.text()).replaceAll(url, '{url}');
  return { status: response.status, headers, body };
}

const NOTICE = /not published[\s\S]*only signed-in users can see it/i;

describe('a hidden post at its permalink, signed in', () => {
  it('is the page, with a banner saying it is not published (AC #1)', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    for (const [kind, url] of Object.entries(HIDDEN)) {
      const response = await agent.get(url);
      assert.equal(response.status, 200, `${kind}: served to the author`);
      const html = await response.text();
      assert.match(html, new RegExp(`The ${kind} post`), `${kind}: the post is drawn`);
      assert.match(html, NOTICE, `${kind}: the banner says it is not published`);
    }
  });

  it('says why each one is hidden', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    assert.match(await (await agent.get(HIDDEN.draft)).text(), /draft/i);
    assert.match(await (await agent.get(HIDDEN.scheduled)).text(), /scheduled/i);
    assert.match(await (await agent.get(HIDDEN.unrecognized)).text(), /members-only/);
  });

  it('carries no banner on a published post', async () => {
    const cms = await site();
    const agent = await signedIn(cms);
    assert.doesNotMatch(await (await agent.get('/published/')).text(), NOTICE);
  });

  it('is private, unstored, unindexed and carries no validator (AC #2)', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    for (const [kind, url] of Object.entries(HIDDEN)) {
      for (const method of ['GET', 'HEAD']) {
        const response = await request(cms, url, { agent, method });
        assert.equal(response.status, 200, `${kind} ${method}: served`);
        assert.equal(
          response.headers.get('cache-control'),
          'private, no-store',
          `${kind} ${method}`,
        );
        assert.equal(response.headers.get('x-robots-tag'), 'noindex', `${kind} ${method}`);
        assert.equal(response.headers.get('etag'), null, `${kind} ${method}: no ETag`);
        assert.equal(response.headers.get('last-modified'), null, `${kind} ${method}`);
        if (method === 'GET') {
          assert.match(
            await response.text(),
            /<meta name="robots" content="noindex">/,
            `${kind}: the robots meta`,
          );
        }
      }

      for (const conditional of [
        { 'if-none-match': '*' },
        { 'if-modified-since': new Date('2030-01-01').toUTCString() },
      ]) {
        const response = await request(cms, url, { agent, headers: conditional });
        assert.equal(response.status, 200, `${kind}: a validator never earns a 304`);
      }
    }
  });
});

describe('a hidden post at its permalink, anonymous', () => {
  it('answers exactly as a URL nothing lives at (AC #3)', async () => {
    const cms = await site();

    const variants: { label: string; method?: string; headers?: Record<string, string> }[] = [
      { label: 'GET' },
      { label: 'HEAD', method: 'HEAD' },
      { label: 'If-None-Match', headers: { 'if-none-match': '*' } },
      { label: 'If-Modified-Since', headers: { 'if-modified-since': NOW.toUTCString() } },
      { label: 'Accept HTML', headers: { accept: 'text/html' } },
      { label: 'Accept JSON', headers: { accept: 'application/json' } },
      { label: 'Accept Markdown', headers: { accept: 'text/markdown' } },
      { label: 'Accept ActivityStreams', headers: { accept: 'application/activity+json' } },
    ];

    for (const variant of variants) {
      const unknown = await snapshot(await request(cms, UNKNOWN, variant), UNKNOWN);
      assert.equal(unknown.status, 404, `${variant.label}: the unknown URL is a 404`);
      for (const [kind, url] of Object.entries({ ...HIDDEN, trashed: TRASHED })) {
        assert.deepEqual(
          await snapshot(await request(cms, url, variant), url),
          unknown,
          `${variant.label}: ${kind} answers as the unknown URL does`,
        );
      }
    }
  });

  it('answers the same to a cookie that is no session', async () => {
    const cms = await site();
    const agent = await signedIn(cms);
    agent.setSession('not-a-session');
    const unknown = await snapshot(await agent.get(UNKNOWN), UNKNOWN);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await snapshot(await agent.get(HIDDEN.draft), HIDDEN.draft), unknown);
  });
});

describe('everything but the HTML page', () => {
  it('keeps a hidden post’s other representations a 404, signed in or not (AC #4)', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    for (const [kind, url] of Object.entries(HIDDEN)) {
      for (const who of [undefined, agent]) {
        const label = `${kind} ${who === undefined ? 'anonymous' : 'signed in'}`;
        for (const suffix of ['index.md', 'index.json']) {
          const response = await request(cms, `${url}${suffix}`, { agent: who });
          assert.equal(response.status, 404, `${label}: ${suffix}`);
        }
        for (const accept of ['text/markdown', 'application/json', 'application/activity+json']) {
          const response = await request(cms, url, { agent: who, headers: { accept } });
          assert.notEqual(response.status, 200, `${label}: Accept ${accept}`);
          assert.doesNotMatch(await response.text(), /lanterns, /, `${label}: ${accept} body`);
        }
      }
    }
  });

  it('lists none of them, signed in or not (AC #4)', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    for (const url of [
      '/',
      '/feed/',
      '/feed/atom/',
      '/feed/json/',
      '/tag/lanterns/',
      '/tag/lanterns/feed/',
      '/sitemap.xml',
      '/search/?q=lanterns',
      '/search/index.json?q=lanterns',
      '/index.json',
    ]) {
      for (const who of [undefined, agent]) {
        const response = await request(cms, url, { agent: who });
        const body = await response.text();
        assert.match(body, /\/published\//, `${url}: the published post is listed`);
        for (const [kind, permalink] of Object.entries({ ...HIDDEN, trashed: TRASHED })) {
          assert.ok(!body.includes(permalink), `${url}: ${kind} is not listed`);
        }
      }
    }
  });
});

describe('a trashed post, signed in', () => {
  it('is still a 404, the same one an unknown URL is (AC #5)', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    const trashed = await snapshot(await agent.get(TRASHED), TRASHED);
    const unknown = await snapshot(await agent.get(UNKNOWN), UNKNOWN);
    assert.equal(trashed.status, 404);
    assert.deepEqual(trashed, unknown);
  });
});
