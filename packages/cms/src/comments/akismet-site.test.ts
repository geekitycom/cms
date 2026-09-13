import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { writeAkismetKey } from './akismet.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { COMMENT_POST_PATH } from './form.ts';
import { COMMENT_FIELDS } from './submission.ts';
import { commentsFile } from './records.ts';
import { WEBMENTION_PATH } from '../webmention/routes.ts';

/**
 * Akismet where it actually runs: a whole CMS, a comment posted through the
 * public form, a webmention arriving at the endpoint, and a key in `data/`.
 *
 * The web is a stub, as it is everywhere else in this suite. What these prove
 * that {@link ./akismet.test.ts} cannot is the wiring — that a site with a key
 * file gets the checker without naming one, that a site without a key sends
 * nothing, and that a fediverse reply never goes near it.
 */

const BASE_URL = 'https://blog.example';
/**
 * The moment the site's clock is stopped at, and the day before it for the
 * post. Both are in the past of any machine running this: a post dated in the
 * real future has no ActivityStreams id, which would quietly take the
 * fediverse case below with it.
 */
const NOW = new Date('2026-09-03T12:00:00.000Z');

const POST = `---
title: Hello world
date: '2026-09-02T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

const started: Cms[] = [];
const temporaryDirs: string[] = [];

/** Every Akismet call the stubbed web saw. */
interface AkismetCall {
  method: string;
  fields: Record<string, string>;
}

let akismet: AkismetCall[] = [];
/** What the stub answers a comment-check with. */
let answer: { body: string; status?: number; proTip?: string } = { body: 'false' };
/** Pages the make-believe web serves, for the webmention cases. */
const pages = new Map<string, string>();

const restoreFetch = stubTheWeb();

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  akismet = [];
  answer = { body: 'false' };
  pages.clear();
});

function stubTheWeb(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.startsWith('https://rest.akismet.com/')) {
      const body = init?.body;
      const fields: Record<string, string> = {};
      for (const [name, value] of new URLSearchParams(
        typeof body === 'string' ? body : '',
      ).entries()) {
        fields[name] = value;
      }
      akismet.push({ method: url.slice(url.lastIndexOf('/') + 1), fields });

      if (fields['api_key'] === undefined) {
        return Promise.resolve(new Response('invalid', { status: 200 }));
      }
      return Promise.resolve(
        new Response(answer.body, {
          status: answer.status ?? 200,
          ...(answer.proTip === undefined
            ? {}
            : { headers: { 'x-akismet-pro-tip': answer.proTip } }),
        }),
      );
    }

    const page = pages.get(url);
    if (page !== undefined) {
      return Promise.resolve(
        new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      );
    }

    return Promise.resolve(new Response('missing', { status: 404 }));
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** A CMS over one post, optionally with an Akismet key already stored. */
async function site(
  options: { key?: string | undefined; config?: GeekityConfig } = {},
): Promise<{ cms: Cms; contentDir: string; dataDir: string }> {
  const contentDir = await temporaryDir('geekity-akismet-content-');
  const dataDir = await temporaryDir('geekity-akismet-data-');

  const file = path.join(contentDir, 'posts/2026-09-02-hello-world.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, POST, 'utf8');

  if (options.key !== undefined) {
    await writeAkismetKey(dataDir, {
      key: options.key,
      status: 'valid',
      checkedAt: '2026-09-04T00:00:00.000Z',
    });
  }

  const instance = createCms({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    ...options.config,
  });
  started.push(instance);
  await instance.sync();
  return { cms: instance, contentDir, dataDir };
}

/** Post the comment form. */
async function comment(cms: Cms, overrides: Record<string, string> = {}): Promise<Response> {
  return await cms.app.request(COMMENT_POST_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (a reader)',
      referer: `${BASE_URL}/2026/09/hello-world/`,
    },
    body: new URLSearchParams({
      [COMMENT_FIELDS.post]: 'hello-world',
      [COMMENT_FIELDS.name]: 'Ada Lovelace',
      [COMMENT_FIELDS.email]: 'ada@example.com',
      [COMMENT_FIELDS.url]: 'https://ada.example/',
      [COMMENT_FIELDS.body]: 'Cheap watches.',
      [COMMENT_FIELDS.inReplyTo]: '',
      [COMMENT_FIELDS.trap]: '',
      [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
      ...overrides,
    }).toString(),
  });
}

/** The comments stored for the post, as the file has them. */
async function stored(contentDir: string): Promise<Record<string, unknown>[]> {
  let raw: string;
  try {
    raw = await readFile(commentsFile(contentDir, 'hello-world'), 'utf8');
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw) as { comments?: Record<string, unknown>[] };
  return parsed.comments ?? [];
}

describe('a site with an Akismet key in data/', () => {
  it('checks every submitted comment, with no checker in its config (AC #1)', async () => {
    const { cms, contentDir } = await site({ key: 'the-key' });

    await comment(cms);

    assert.equal(akismet.length, 1);
    assert.equal(akismet[0]?.method, 'comment-check');
    assert.equal(akismet[0]?.fields['api_key'], 'the-key');
    assert.equal(akismet[0]?.fields['blog'], BASE_URL);
    assert.equal(akismet[0]?.fields['user_ip'], undefined, 'a test request has no address');
    assert.equal(akismet[0]?.fields['user_agent'], 'Mozilla/5.0 (a reader)');
    assert.equal(akismet[0]?.fields['referrer'], `${BASE_URL}/2026/09/hello-world/`);
    assert.equal(akismet[0]?.fields['permalink'], `${BASE_URL}/2026/09/hello-world/`);
    assert.equal(akismet[0]?.fields['comment_type'], 'comment');
    assert.equal(akismet[0]?.fields['comment_author'], 'Ada Lovelace');
    assert.equal(akismet[0]?.fields['comment_author_email'], 'ada@example.com');
    assert.equal(akismet[0]?.fields['comment_author_url'], 'https://ada.example/');
    assert.equal(akismet[0]?.fields['comment_content'], 'Cheap watches.');
    assert.equal(akismet[0]?.fields['blog_lang'], 'en');
    assert.ok(akismet[0]?.fields['comment_date_gmt'] !== undefined);

    // `false`, so the comment is on the ordinary moderation path.
    const comments = await stored(contentDir);
    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.['status'], 'pending');
  });

  it('files a comment Akismet calls spam as spam (AC #2)', async () => {
    answer = { body: 'true' };
    const { cms, contentDir } = await site({ key: 'the-key' });

    await comment(cms);

    const comments = await stored(contentDir);
    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.['status'], 'spam');
  });

  it('drops one the pro tip says to discard without a queue entry (AC #2)', async () => {
    answer = { body: 'true', proTip: 'discard' };
    const { cms, contentDir } = await site({ key: 'the-key' });

    const response = await comment(cms);

    assert.equal(response.status, 303, 'the sender is told nothing about why');
    assert.deepEqual(await stored(contentDir), [], 'and nothing was written');
  });

  it('holds the comment and logs it when Akismet cannot be reached (AC #4)', async () => {
    answer = { body: 'oh dear', status: 503 };
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: unknown) => {
      warnings.push(String(message));
    };

    try {
      const { cms, contentDir } = await site({ key: 'the-key' });
      await comment(cms);

      const comments = await stored(contentDir);
      assert.equal(comments.length, 1, 'the comment was not lost');
      assert.equal(comments[0]?.['status'], 'pending');
      assert.ok(
        warnings.some((line) => /Akismet.*503/.test(line)),
        `the failure was logged, saw ${JSON.stringify(warnings)}`,
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  it('checks an incoming webmention as a webmention (AC #6)', async () => {
    const source = 'https://elsewhere.example/a-post/';
    pages.set(
      source,
      `<html><body><div class="h-entry">
        <a class="p-author h-card" href="https://elsewhere.example/me">Grace</a>
        <div class="e-content">Linking to <a href="${BASE_URL}/2026/09/hello-world/">this</a>.</div>
      </div></body></html>`,
    );

    const { cms } = await site({ key: 'the-key' });
    const response = await cms.app.request(WEBMENTION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        source,
        target: `${BASE_URL}/2026/09/hello-world/`,
      }).toString(),
    });
    assert.equal(response.status, 202);
    await cms.webmentions.settled();

    const checks = akismet.filter((call) => call.method === 'comment-check');
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.fields['comment_type'], 'webmention');
    assert.equal(checks[0]?.fields['api_key'], 'the-key');
  });

  it('never sends a fediverse reply, which does not use the seam (AC #1)', async () => {
    const { cms } = await site({ key: 'the-key' });

    cms.admin.logInboxActivity({
      activityId: 'https://remote.example/creates/1',
      activityType: 'Create',
      actorId: 'https://remote.example/users/grace',
      objectId: 'https://remote.example/notes/1',
      json: JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/creates/1',
        type: 'Create',
        actor: 'https://remote.example/users/grace',
        object: {
          id: 'https://remote.example/notes/1',
          type: 'Note',
          attributedTo: 'https://remote.example/users/grace',
          content: '<p>Free money at example.biz.</p>',
          inReplyTo: `${BASE_URL}/2026/09/hello-world/`,
          published: '2026-09-03T09:00:00Z',
        },
      }),
    });

    const page = await (await cms.app.request('/2026/09/hello-world/')).text();
    assert.match(page, /Free money at example\.biz\./, 'the reply is on the page');
    assert.deepEqual(akismet, [], 'and Akismet heard nothing about it');
  });
});

describe('a site with no Akismet key', () => {
  it('sends nothing to Akismet at all (AC #1)', async () => {
    const { cms, contentDir } = await site();

    await comment(cms);

    assert.deepEqual(akismet, []);
    const comments = await stored(contentDir);
    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.['status'], 'pending');
  });
});

describe('a site that named a commentChecker of its own', () => {
  it('is asked instead of Akismet, key or no key', async () => {
    const asked: string[] = [];
    const { cms, contentDir } = await site({
      key: 'the-key',
      config: {
        commentChecker: {
          check(submission) {
            asked.push(submission.comment.author.name);
            return 'spam';
          },
        },
      },
    });

    await comment(cms);

    assert.deepEqual(asked, ['Ada Lovelace'], 'the site’s own checker was asked');
    assert.deepEqual(akismet, [], 'and Akismet was not');
    assert.equal((await stored(contentDir))[0]?.['status'], 'spam');
  });
});
