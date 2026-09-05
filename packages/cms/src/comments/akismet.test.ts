import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { PostComment } from '../admin/store.ts';
import { createAkismetChecker, verifyAkismetKey, writeAkismetKey } from './akismet.ts';
import type { CommentReport, CommentSubmission } from './submission.ts';

/**
 * Akismet, against a stub of Akismet.
 *
 * Nothing here reaches the network: every test hands the module a `fetch` of
 * its own and reads the request it was given. That is the only honest way to
 * assert on a field set — a live call would tell us whether Akismet liked the
 * request, not what was in it.
 */

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dir(): Promise<string> {
  const made = await mkdtemp(path.join(tmpdir(), 'geekity-akismet-'));
  dirs.push(made);
  return made;
}

/** One request the module made, as the stub saw it. */
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  fields: Record<string, string>;
}

/** The urlencoded body a request carried, as its fields. */
function fieldsOf(init: RequestInit | undefined): Record<string, string> {
  const body = init?.body;
  const fields: Record<string, string> = {};
  for (const [name, value] of new URLSearchParams(typeof body === 'string' ? body : '').entries()) {
    fields[name] = value;
  }
  return fields;
}

/** A `fetch` that answers with `reply` and remembers what it was asked. */
function stub(reply: (call: Call) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    for (const [name, value] of new Headers(init?.headers).entries()) headers[name] = value;

    const fields = fieldsOf(init);

    const call: Call = { url, method: init?.method ?? 'GET', headers, fields };
    calls.push(call);
    return await reply(call);
  }) as typeof fetch;

  return { fetch: impl, calls };
}

describe('verifying an Akismet key', () => {
  it('posts the key and the blog to verify-key and believes "valid" (AC #5)', async () => {
    const { fetch: stubbed, calls } = stub(() => new Response('valid'));

    const status = await verifyAkismetKey({
      key: 'secret-key',
      blog: 'https://blog.example',
      fetch: stubbed,
    });

    assert.equal(status, 'valid');
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call?.url, 'https://rest.akismet.com/1.1/verify-key');
    assert.equal(call?.method, 'POST');
    assert.equal(call?.fields['api_key'], 'secret-key');
    assert.equal(call?.fields['blog'], 'https://blog.example');
    assert.match(call?.headers['user-agent'] ?? '', /Geekity CMS\/.+ \| Akismet\//);
    assert.match(call?.headers['content-type'] ?? '', /application\/x-www-form-urlencoded/);
  });

  it('reports a key Akismet refuses (AC #5)', async () => {
    const { fetch: stubbed } = stub(
      () =>
        new Response('invalid', {
          headers: { 'x-akismet-debug-help': 'Invalid API key.' },
        }),
    );

    assert.equal(
      await verifyAkismetKey({ key: 'nope', blog: 'https://blog.example', fetch: stubbed }),
      'invalid',
    );
  });

  it('reports a key it could not check rather than guessing (AC #4, #5)', async () => {
    const { fetch: stubbed } = stub(() => {
      throw new TypeError('fetch failed');
    });

    assert.equal(
      await verifyAkismetKey({ key: 'unknowable', blog: 'https://blog.example', fetch: stubbed }),
      'unchecked',
    );
  });

  it('treats a 500 as unchecked too (AC #4)', async () => {
    const { fetch: stubbed } = stub(() => new Response('oh dear', { status: 500 }));

    assert.equal(
      await verifyAkismetKey({ key: 'k', blog: 'https://blog.example', fetch: stubbed }),
      'unchecked',
    );
  });
});

describe('the stored Akismet key', () => {
  it('is nothing at all until one is written', async () => {
    const { readAkismetKey } = await import('./akismet.ts');
    assert.equal(readAkismetKey(await dir()), undefined);
  });

  it('comes back as it was written, and only to its owner', async () => {
    const { readAkismetKey } = await import('./akismet.ts');
    const dataDir = await dir();

    await writeAkismetKey(dataDir, {
      key: 'abc123',
      status: 'valid',
      checkedAt: '2026-09-04T00:00:00.000Z',
    });

    assert.deepEqual(readAkismetKey(dataDir), {
      key: 'abc123',
      status: 'valid',
      checkedAt: '2026-09-04T00:00:00.000Z',
    });
    assert.equal(statSync(path.join(dataDir, 'akismet.json')).mode & 0o777, 0o600);
  });
});

/** The comment every checker test below is asked about. */
const COMMENT: Omit<PostComment, 'id'> = {
  slug: 'hello-world',
  permalink: '/2026/09/hello-world/',
  source: 'comment',
  kind: 'reply',
  status: 'pending',
  author: {
    name: 'A Commenter',
    email: 'commenter@example.com',
    url: 'https://commenter.example/',
    avatar: null,
  },
  content: { markdown: 'Buy my things.', html: '<p>Buy my things.</p>' },
  submitted: '2026-09-04T11:22:33.000Z',
  addressHash: 'deadbeef',
  inReplyTo: null,
  url: null,
  notify: false,
};

const SUBMISSION: CommentSubmission = {
  comment: COMMENT,
  post: {
    slug: 'hello-world',
    title: 'Hello world',
    url: 'https://blog.example/2026/09/hello-world/',
  },
  address: '203.0.113.9',
  userAgent: 'Mozilla/5.0 (a browser)',
  referrer: 'https://blog.example/2026/09/hello-world/',
  baseUrl: 'https://blog.example',
};

/** A site with a key already in it. */
async function keyed(key = 'the-key'): Promise<string> {
  const dataDir = await dir();
  await writeAkismetKey(dataDir, {
    key,
    status: 'valid',
    checkedAt: '2026-09-04T00:00:00.000Z',
  });
  return dataDir;
}

/** Somewhere for a checker's complaints to go. */
function log(): { warn(message: string): void; warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    warn(message) {
      warnings.push(message);
    },
  };
}

describe('asking Akismet about a comment', () => {
  it('sends every field the API documents (AC #1)', async () => {
    const { fetch: stubbed, calls } = stub(() => new Response('false'));
    const checker = createAkismetChecker({
      dataDir: await keyed('the-key'),
      language: () => 'en-GB',
      fetch: stubbed,
    });

    await checker.check(SUBMISSION);

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call?.url, 'https://rest.akismet.com/1.1/comment-check');
    assert.equal(call?.method, 'POST');
    assert.match(call?.headers['user-agent'] ?? '', /Geekity CMS\/.+ \| Akismet\//);
    assert.deepEqual(
      { ...call?.fields },
      {
        api_key: 'the-key',
        blog: 'https://blog.example',
        blog_charset: 'UTF-8',
        blog_lang: 'en',
        user_ip: '203.0.113.9',
        user_agent: 'Mozilla/5.0 (a browser)',
        referrer: 'https://blog.example/2026/09/hello-world/',
        permalink: 'https://blog.example/2026/09/hello-world/',
        comment_type: 'comment',
        comment_author: 'A Commenter',
        comment_author_email: 'commenter@example.com',
        comment_author_url: 'https://commenter.example/',
        comment_content: 'Buy my things.',
        comment_date_gmt: '2026-09-04T11:22:33.000Z',
        honeypot_field_name: 'website',
      },
    );
  });

  it('sends nothing at all when the site has no key (AC #1)', async () => {
    const { fetch: stubbed, calls } = stub(() => new Response('true'));
    const checker = createAkismetChecker({
      dataDir: await dir(),
      language: () => 'en',
      fetch: stubbed,
    });

    assert.equal(await checker.check(SUBMISSION), 'unknown');
    assert.equal(calls.length, 0, 'nothing was sent anywhere');
  });

  it('calls a true answer spam (AC #2)', async () => {
    const { fetch: stubbed } = stub(() => new Response('true'));
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
    });

    assert.equal(await checker.check(SUBMISSION), 'spam');
  });

  it('discards what the pro tip says to discard (AC #2)', async () => {
    const { fetch: stubbed } = stub(
      () => new Response('true', { headers: { 'x-akismet-pro-tip': 'discard' } }),
    );
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
    });

    assert.equal(await checker.check(SUBMISSION), 'discard');
  });

  it('leaves a false answer to the site’s own rules (AC #2)', async () => {
    const { fetch: stubbed } = stub(() => new Response('false'));
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
    });

    // Not `ham`: `ham` is a positive opinion that approves a comment outright,
    // and Akismet's `false` only means it saw nothing wrong. What happens next
    // is TASK-50's rule — approved for a name and email that have been
    // approved before, pending otherwise.
    assert.equal(await checker.check(SUBMISSION), 'unknown');
  });

  it('has no opinion when Akismet is unreachable, and says so (AC #4)', async () => {
    const logger = log();
    const { fetch: stubbed } = stub(() => {
      throw new TypeError('fetch failed');
    });
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
      logger,
    });

    assert.equal(await checker.check(SUBMISSION), 'unknown');
    assert.equal(logger.warnings.length, 1);
    assert.match(logger.warnings[0] ?? '', /Akismet/);
  });

  it('has no opinion when Akismet answers invalid, and says why (AC #4)', async () => {
    const logger = log();
    const { fetch: stubbed } = stub(
      () =>
        new Response('invalid', {
          headers: { 'x-akismet-debug-help': 'Invalid API key.' },
        }),
    );
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
      logger,
    });

    assert.equal(await checker.check(SUBMISSION), 'unknown');
    assert.match(logger.warnings[0] ?? '', /Invalid API key\./);
  });

  it('has no opinion when Akismet answers a 503 (AC #4)', async () => {
    const logger = log();
    const { fetch: stubbed } = stub(() => new Response('busy', { status: 503 }));
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
      logger,
    });

    assert.equal(await checker.check(SUBMISSION), 'unknown');
    assert.match(logger.warnings[0] ?? '', /503/);
  });

  it('calls an incoming webmention a webmention (AC #6)', async () => {
    const { fetch: stubbed, calls } = stub(() => new Response('false'));
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
    });

    await checker.check({
      ...SUBMISSION,
      comment: {
        ...COMMENT,
        source: 'webmention',
        url: 'https://elsewhere.example/a-post/',
      },
    });

    assert.equal(calls[0]?.fields['comment_type'], 'webmention');
    assert.equal(calls[0]?.fields['comment_author_url'], 'https://commenter.example/');
    // A webmention has no form, so there is no honeypot to name.
    assert.equal(calls[0]?.fields['honeypot_field_name'], undefined);
  });

  it('calls a contact message a contact-form when the caller says so (TASK-56)', async () => {
    const { fetch: stubbed, calls } = stub(() => new Response('false'));
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
    });

    await checker.check({ ...SUBMISSION, type: 'contact-form' });

    assert.equal(calls[0]?.fields['comment_type'], 'contact-form');
    // It went through a form, so the honeypot is still worth naming.
    assert.equal(calls[0]?.fields['honeypot_field_name'], 'website');
  });

  it('marks a test call as one when it is told to (AC #1)', async () => {
    const { fetch: stubbed, calls } = stub(() => new Response('false'));
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
      isTest: true,
    });

    await checker.check(SUBMISSION);
    assert.equal(calls[0]?.fields['is_test'], '1');
  });
});

describe('telling Akismet a moderator disagreed', () => {
  const stored: PostComment = { ...COMMENT, id: 'c1', status: 'spam' };
  const report: CommentReport = {
    comment: stored,
    url: 'https://blog.example/2026/09/hello-world/',
    baseUrl: 'https://blog.example',
  };

  it('posts submit-spam with the fields the check carried (AC #3)', async () => {
    const { fetch: stubbed, calls } = stub(
      () => new Response('Thanks for making the web a better place.'),
    );
    const checker = createAkismetChecker({
      dataDir: await keyed('the-key'),
      language: () => 'en',
      fetch: stubbed,
    });

    await checker.reportSpam?.(report);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://rest.akismet.com/1.1/submit-spam');
    assert.equal(calls[0]?.fields['api_key'], 'the-key');
    assert.equal(calls[0]?.fields['blog'], 'https://blog.example');
    assert.equal(calls[0]?.fields['permalink'], 'https://blog.example/2026/09/hello-world/');
    assert.equal(calls[0]?.fields['comment_type'], 'comment');
    assert.equal(calls[0]?.fields['comment_author'], 'A Commenter');
    assert.equal(calls[0]?.fields['comment_author_email'], 'commenter@example.com');
    assert.equal(calls[0]?.fields['comment_author_url'], 'https://commenter.example/');
    assert.equal(calls[0]?.fields['comment_content'], 'Buy my things.');
    assert.equal(calls[0]?.fields['comment_date_gmt'], '2026-09-04T11:22:33.000Z');
    assert.equal(calls[0]?.fields['blog_lang'], 'en');
  });

  it('posts submit-ham when one comes back out of the spam list (AC #3)', async () => {
    const { fetch: stubbed, calls } = stub(
      () => new Response('Thanks for making the web a better place.'),
    );
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
    });

    await checker.reportHam?.({ ...report, comment: { ...stored, status: 'approved' } });

    assert.equal(calls[0]?.url, 'https://rest.akismet.com/1.1/submit-ham');
    assert.equal(calls[0]?.fields['comment_content'], 'Buy my things.');
  });

  it('sends no correction when the site has no key (AC #3)', async () => {
    const { fetch: stubbed, calls } = stub(() => new Response('ok'));
    const checker = createAkismetChecker({
      dataDir: await dir(),
      language: () => 'en',
      fetch: stubbed,
    });

    await checker.reportSpam?.(report);
    await checker.reportHam?.(report);
    assert.equal(calls.length, 0);
  });

  it('logs a correction Akismet would not take rather than throwing (AC #4)', async () => {
    const logger = log();
    const { fetch: stubbed } = stub(() => {
      throw new TypeError('fetch failed');
    });
    const checker = createAkismetChecker({
      dataDir: await keyed(),
      language: () => 'en',
      fetch: stubbed,
      logger,
    });

    await checker.reportSpam?.(report);
    assert.match(logger.warnings[0] ?? '', /Akismet/);
  });
});
