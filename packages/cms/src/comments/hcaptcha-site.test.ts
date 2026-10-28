import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { resolvePublic, sandbox, signIn } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { settingsOver } from '../__testing__/settings.ts';
import { CONTACT_FIELDS, CONTACT_POST_PATH } from '../contact/form.ts';
import { listContactMessages } from '../contact/records.ts';
import type { CommentSubmission, CommentVerdict } from '../forms/checker.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import { WEBMENTION_PATH } from '../webmention/endpoint.ts';
import { COMMENT_POST_PATH } from './form.ts';
import { HCAPTCHA_RESPONSE_FIELD } from './hcaptcha.ts';
import { commentsFile } from './records.ts';
import { COMMENT_FIELDS } from './submission.ts';

const box = sandbox();

const BASE_URL = 'https://blog.example';
const NOW = new Date('2026-09-20T12:00:00.000Z');
const ADDRESS = '203.0.113.9';

const POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

const CONTACT_PAGE = `---
title: Say hello
permalink: /contact/
contact: true
---

Write to me.
`;

const ADMIN = { username: 'ada', password: 'correct horse battery', email: 'ada@example.com' };

type Answer = 'pass' | 'reject' | 'unreachable';

let answer: Answer = 'pass';
let siteverify: Record<string, string>[] = [];
const pages = new Map<string, string>();

const restoreFetch = stubTheWeb();

after(async () => {
  restoreFetch();
  await box.cleanup();
});

beforeEach(() => {
  answer = 'pass';
  siteverify = [];
  pages.clear();
});

function stubTheWeb(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== 'https://api.hcaptcha.com/siteverify') {
      const page = pages.get(url);
      return Promise.resolve(
        page === undefined
          ? new Response('missing', { status: 404 })
          : new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      );
    }

    const body = init?.body;
    siteverify.push(
      Object.fromEntries(new URLSearchParams(typeof body === 'string' ? body : '').entries()),
    );
    if (answer === 'unreachable') return Promise.reject(new TypeError('fetch failed'));
    return Promise.resolve(
      Response.json(
        answer === 'pass'
          ? { success: true }
          : { success: false, 'error-codes': ['invalid-input-response'] },
      ),
    );
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

interface Site {
  cms: Cms;
  provider: MemoryMailProvider;
  checked: CommentSubmission[];
  contentDir: string;
  dataDir: string;
}

async function site(
  options: { paired?: boolean; verdict?: CommentVerdict; config?: GeekityConfig } = {},
): Promise<Site> {
  const contentDir = await box.dir('geekity-hcaptcha-content-');
  const dataDir = await box.dir('geekity-hcaptcha-data-');
  for (const [relative, contents] of Object.entries({
    'posts/2026-09-19-hello-world.md': POST,
    'pages/contact.md': CONTACT_PAGE,
  })) {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  writeUsers(dataDir, [ADMIN]);
  if (options.paired !== false) await pair({ contentDir, dataDir }, 'the-site-key', '0xsecret');

  const provider = createMemoryMailProvider();
  const checked: CommentSubmission[] = [];
  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    now: () => NOW,
    trustProxy: true,
    mail: { provider, backoffMs: () => 0, logger: { info: () => {}, warn: () => {} } },
    commentChecker: {
      check(submission): CommentVerdict {
        checked.push(submission);
        return options.verdict ?? 'unknown';
      },
    },
    ...options.config,
  });
  return { cms, provider, checked, contentDir, dataDir };
}

async function pair(
  dirs: { contentDir: string; dataDir: string },
  siteKey: string,
  secret: string,
): Promise<void> {
  await settingsOver(dirs).set(
    'hcaptcha',
    new Map<string, unknown>([
      ['site_key', siteKey],
      ['secret', secret],
    ]),
    'admin',
  );
}

function token(value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [HCAPTCHA_RESPONSE_FIELD]: value };
}

async function post(target: Site, url: string, fields: Record<string, string>): Promise<Response> {
  const response = await target.cms.app.request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': ADDRESS,
    },
    body: new URLSearchParams(fields).toString(),
  });
  await target.cms.notifications.settled();
  await target.cms.mail.settled();
  return response;
}

async function contact(target: Site, value: string | undefined): Promise<Response> {
  return await post(target, CONTACT_POST_PATH, {
    [CONTACT_FIELDS.page]: 'contact',
    [CONTACT_FIELDS.name]: 'Grace Hopper',
    [CONTACT_FIELDS.email]: 'grace@example.com',
    [CONTACT_FIELDS.subject]: 'Hello',
    [CONTACT_FIELDS.message]: 'A message.',
    [CONTACT_FIELDS.trap]: '',
    [CONTACT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
    ...token(value),
  });
}

async function comment(target: Site, value: string | undefined): Promise<Response> {
  return await post(target, COMMENT_POST_PATH, {
    [COMMENT_FIELDS.post]: 'hello-world',
    [COMMENT_FIELDS.name]: 'Grace Hopper',
    [COMMENT_FIELDS.email]: 'grace@example.com',
    [COMMENT_FIELDS.url]: '',
    [COMMENT_FIELDS.body]: 'A thought about this.',
    [COMMENT_FIELDS.inReplyTo]: '',
    [COMMENT_FIELDS.trap]: '',
    [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
    ...token(value),
  });
}

async function storedComments(target: Site): Promise<Record<string, unknown>[]> {
  let raw: string;
  try {
    raw = await readFile(commentsFile(target.contentDir, 'hello-world'), 'utf8');
  } catch {
    return [];
  }
  return (JSON.parse(raw) as { comments?: Record<string, unknown>[] }).comments ?? [];
}

interface FormUnderTest {
  name: string;
  send(target: Site, value: string | undefined): Promise<Response>;
  statuses(target: Site): Promise<unknown[]>;
  normal: string;
  type: string;
}

const FORMS: FormUnderTest[] = [
  {
    name: 'the contact form',
    send: contact,
    statuses: (target) =>
      Promise.resolve(listContactMessages(target.dataDir).map((message) => message.status)),
    normal: 'received',
    type: 'contact-form',
  },
  {
    name: "a stranger's comment",
    send: comment,
    statuses: async (target) => (await storedComments(target)).map((stored) => stored['status']),
    normal: 'pending',
    type: 'comment',
  },
];

for (const form of FORMS) {
  describe(`hCaptcha on ${form.name}`, () => {
    it('verifies the token with the secret, the site key and the address (AC #1, #2)', async () => {
      const target = await site();

      assert.equal((await form.send(target, 'a-solved-token')).status, 303);

      assert.deepEqual(siteverify, [
        {
          secret: '0xsecret',
          response: 'a-solved-token',
          sitekey: 'the-site-key',
          remoteip: ADDRESS,
        },
      ]);
      assert.deepEqual(await form.statuses(target), [form.normal]);
      assert.equal(target.provider.sent.length, 1, 'somebody is told, as without hCaptcha');
    });

    it('still asks hCaptcha in dev mode, which holds only what the site sends out (AC #7)', async () => {
      const target = await site({ config: { devMode: true } });

      await form.send(target, 'a-solved-token');

      assert.equal(siteverify.length, 1);
      assert.deepEqual(await form.statuses(target), [form.normal]);
    });

    it('lets the checker judge what the challenge passed (AC #5)', async () => {
      const target = await site({ verdict: 'spam' });

      await form.send(target, 'a-solved-token');

      assert.equal(target.checked.length, 1);
      assert.equal(target.checked[0]?.type ?? 'comment', form.type);
      assert.deepEqual(await form.statuses(target), ['spam']);
    });

    it('files a submission with no token as spam, and tells nobody (AC #3)', async () => {
      const target = await site();

      assert.equal((await form.send(target, undefined)).status, 303);

      assert.equal(siteverify.length, 0, 'there was nothing to ask about');
      assert.deepEqual(await form.statuses(target), ['spam']);
      assert.equal(target.provider.sent.length, 0);
    });

    it('files a token hCaptcha rejects as spam, and tells nobody (AC #3)', async () => {
      answer = 'reject';
      const target = await site();

      assert.equal((await form.send(target, 'a-forged-token')).status, 303);

      assert.equal(siteverify.length, 1);
      assert.deepEqual(await form.statuses(target), ['spam']);
      assert.equal(target.provider.sent.length, 0);
    });

    it('runs the honeypot and the form age before asking hCaptcha (AC #5)', async () => {
      const target = await site();
      const trapField = form.type === 'comment' ? COMMENT_FIELDS.trap : CONTACT_FIELDS.trap;
      const loadedField = form.type === 'comment' ? COMMENT_FIELDS.loaded : CONTACT_FIELDS.loaded;
      const url = form.type === 'comment' ? COMMENT_POST_PATH : CONTACT_POST_PATH;
      const valid =
        form.type === 'comment'
          ? {
              [COMMENT_FIELDS.post]: 'hello-world',
              [COMMENT_FIELDS.name]: 'Grace Hopper',
              [COMMENT_FIELDS.body]: 'A thought.',
            }
          : {
              [CONTACT_FIELDS.page]: 'contact',
              [CONTACT_FIELDS.name]: 'Grace Hopper',
              [CONTACT_FIELDS.email]: 'grace@example.com',
              [CONTACT_FIELDS.message]: 'A message.',
            };

      await post(target, url, {
        ...valid,
        [trapField]: 'https://spam.example/',
        [loadedField]: String(NOW.getTime() - 60_000),
        ...token('a-solved-token'),
      });
      await post(target, url, {
        ...valid,
        [loadedField]: String(NOW.getTime()),
        ...token('a-solved-token'),
      });

      assert.equal(siteverify.length, 0);
      assert.equal(target.checked.length, 0);
      assert.deepEqual(await form.statuses(target), []);
    });

    it('throws away what the challenge failed and the checker said to discard', async () => {
      const target = await site({ verdict: 'discard' });

      assert.equal((await form.send(target, undefined)).status, 303);

      assert.equal(target.checked.length, 1, 'the checker still runs on a failed challenge');
      assert.deepEqual(await form.statuses(target), []);
    });

    it('goes on as if hCaptcha were off when siteverify cannot be reached (AC #4)', async () => {
      answer = 'unreachable';
      const target = await site();

      assert.equal((await form.send(target, 'a-solved-token')).status, 303);

      assert.equal(siteverify.length, 1);
      assert.deepEqual(await form.statuses(target), [form.normal]);
      assert.equal(target.provider.sent.length, 1);
      assert.equal(target.checked.length, 1, 'and the checker is still asked');
    });

    it('challenges nothing while no pair is stored (AC #1, #9)', async () => {
      const target = await site({ paired: false });

      await form.send(target, undefined);

      assert.equal(siteverify.length, 0);
      assert.deepEqual(await form.statuses(target), [form.normal]);
      assert.equal(target.provider.sent.length, 1);
    });

    it('starts and stops challenging when the pair is stored or removed (AC #8)', async () => {
      const target = await site({ paired: false });
      const sorted = async (): Promise<string[]> =>
        (await form.statuses(target)).map(String).sort();

      await form.send(target, undefined);
      assert.deepEqual(await sorted(), [form.normal]);

      await pair(target, 'the-site-key', '0xsecret');
      await form.send(target, undefined);
      assert.deepEqual(await sorted(), [form.normal, 'spam'].sort());

      await pair(target, '', '');
      await form.send(target, undefined);
      assert.deepEqual(await sorted(), [form.normal, form.normal, 'spam'].sort());
    });

    it('uses a challenge the config names instead of hCaptcha (AC #1)', async () => {
      const seen: string[] = [];
      const target = await site({
        config: {
          formChallenge: {
            field: 'my-token',
            widget: () => Promise.resolve(undefined),
            verify: (attempt) => {
              seen.push(`${attempt.type}:${attempt.token}`);
              return Promise.resolve('fail');
            },
          },
        },
      });

      await post(
        target,
        form.type === 'comment' ? COMMENT_POST_PATH : CONTACT_POST_PATH,
        form.type === 'comment'
          ? {
              [COMMENT_FIELDS.post]: 'hello-world',
              [COMMENT_FIELDS.name]: 'Grace Hopper',
              [COMMENT_FIELDS.body]: 'A thought.',
              [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
              'my-token': 'mine',
            }
          : {
              [CONTACT_FIELDS.page]: 'contact',
              [CONTACT_FIELDS.name]: 'Grace Hopper',
              [CONTACT_FIELDS.email]: 'grace@example.com',
              [CONTACT_FIELDS.message]: 'A message.',
              [CONTACT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
              'my-token': 'mine',
            },
      );

      assert.deepEqual(seen, [`${form.type}:mine`]);
      assert.equal(siteverify.length, 0, 'hCaptcha is not asked as well');
      assert.deepEqual(await form.statuses(target), ['spam']);
    });
  });
}

describe('hCaptcha and what is not a form', () => {
  it('never challenges a webmention (AC #6)', async () => {
    const source = 'https://elsewhere.example/a-post/';
    pages.set(
      source,
      `<html><body><div class="h-entry">
        <a class="p-author h-card" href="https://elsewhere.example/me">Grace</a>
        <div class="e-content">Linking to <a href="${BASE_URL}/2026/09/hello-world/">this</a>.</div>
      </div></body></html>`,
    );
    const target = await site({ config: { hostLookup: resolvePublic } });

    const response = await target.cms.app.request(WEBMENTION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ source, target: `${BASE_URL}/2026/09/hello-world/` }).toString(),
    });
    assert.equal(response.status, 202);
    await target.cms.webmentions.settled();

    assert.equal(target.checked.length, 1, 'the checker saw it');
    assert.equal(siteverify.length, 0, 'hCaptcha did not');
    assert.deepEqual(
      (await storedComments(target)).map((stored) => stored['status']),
      ['pending'],
    );
  });
});

describe('hCaptcha and a signed-in commenter', () => {
  it('never challenges somebody signed in (AC #6)', async () => {
    const target = await site();
    const agent = await signIn(target.cms, ADMIN);
    const page = await (await agent.get('/2026/09/hello-world/')).text();
    const csrf = new RegExp(`name="${COMMENT_FIELDS.csrf}" value="([^"]+)"`).exec(page)?.[1];
    assert.ok(csrf !== undefined);

    const response = await agent.post(COMMENT_POST_PATH, {
      [COMMENT_FIELDS.post]: 'hello-world',
      [COMMENT_FIELDS.body]: 'Answering my own post.',
      [COMMENT_FIELDS.inReplyTo]: '',
      [COMMENT_FIELDS.csrf]: csrf,
    });

    assert.equal(response.status, 303);
    assert.match(response.headers.get('location') ?? '', /comment=posted/);
    assert.equal(siteverify.length, 0);
    assert.equal(target.checked.length, 0);
  });
});
