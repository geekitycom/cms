import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { browser, sandbox, signIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { COMMENT_POST_PATH } from './form.ts';
import { commentsFile } from './records.ts';
import { COMMENT_FIELDS } from './submission.ts';
import type { CommentChecker, CommentSubmission } from './submission.ts';

/**
 * Commenting as yourself: what the form under a post looks like when the
 * request carries a login, what the comment it stores says, and the two things
 * a personalised public page has to get right — a token in front of it and a
 * cache directive behind it (TASK-103).
 *
 * Everything is driven over HTTP through the real app, because every
 * acceptance criterion is about what a browser is sent and what lands in
 * `content/_data/comments/` — none of them is a fact about a function.
 */

const box = sandbox();
after(async () => {
  await box.cleanup();
});

/** Where the site is, so the links in the assertions are stable. */
const BASE_URL = 'https://blog.example';

/** The moment the site's clock is stopped at. */
const NOW = new Date('2026-09-20T12:00:00.000Z');

/** Where the one post lives, and where it is read. */
const POST_URL = '/2026/09/hello-world/';

/** The site's one account, with everything a comment can be attributed from. */
const ADA = {
  username: 'ada',
  password: 'correct horse battery',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
};

const POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: ${POST_URL}
---

Words.
`;

/**
 * A site with one open post and one account, nobody signed in yet.
 *
 * The account is written straight into `users.json` rather than walked through
 * the setup form, because these tests need a display name and an email on it
 * and the setup form asks for neither.
 */
async function site(
  config: GeekityConfig = {},
  user: { displayName?: string } = { displayName: ADA.displayName },
): Promise<Cms> {
  const contentDir = await box.dir('geekity-signed-in-content-');
  const dataDir = await box.dir('geekity-signed-in-data-');

  const file = path.join(contentDir, 'posts', '2026-09-19-hello-world.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, POST, 'utf8');

  writeUsers(dataDir, [
    {
      username: ADA.username,
      password: ADA.password,
      email: ADA.email,
      ...(user.displayName === undefined ? {} : { profile: { displayName: user.displayName } }),
    },
  ]);

  return await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    ...config,
  });
}

/** That site, with Ada signed in through the login form. */
async function signedInSite(config: GeekityConfig = {}): Promise<{ cms: Cms; agent: Browser }> {
  const cms = await site(config);
  return { cms, agent: await signIn(cms, { username: ADA.username, password: ADA.password }) };
}

/** The post's page as one reader is sent it. */
async function postPage(agent: Browser): Promise<string> {
  const response = await agent.get(POST_URL);
  assert.equal(response.status, 200);
  return await response.text();
}

/** The hidden CSRF field the comment form carries, if it carries one. */
function tokenIn(html: string): string | undefined {
  const form = /<form method="post" action="\/_geekity\/comments">[\s\S]*?<\/form>/.exec(html);
  const match = new RegExp(`name="${COMMENT_FIELDS.csrf}" value="([^"]+)"`).exec(form?.[0] ?? '');
  return match?.[1];
}

/** One submitted signed-in form: the comment, the post and the token. */
function submission(token: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [COMMENT_FIELDS.post]: 'hello-world',
    [COMMENT_FIELDS.body]: 'Answering my own post.',
    [COMMENT_FIELDS.inReplyTo]: '',
    [COMMENT_FIELDS.csrf]: token,
    ...overrides,
  };
}

/** What is in the post's comment file right now. */
async function storedComments(cms: Cms): Promise<Record<string, unknown>[]> {
  const source = await readFile(commentsFile(cms.config.contentDir, 'hello-world'), 'utf8');
  return (JSON.parse(source) as { comments: Record<string, unknown>[] }).comments;
}

describe('the form under a post for somebody signed in', () => {
  it('asks only for the comment and says who it posts as', async () => {
    const { agent } = await signedInSite();

    const html = await postPage(agent);

    assert.match(html, /id="respond"/, 'the form is there');
    assert.match(html, /Commenting as/, 'it says who it is for');
    assert.match(
      html,
      new RegExp(`<a href="/author/${ADA.username}/">${ADA.displayName}</a>`),
      'and links their profile under their display name',
    );
    assert.ok(!html.includes(`name="${COMMENT_FIELDS.name}"`), 'no name box');
    assert.ok(!html.includes(`name="${COMMENT_FIELDS.email}"`), 'no email box');
    assert.ok(!html.includes(`name="${COMMENT_FIELDS.url}"`), 'no website box');
    assert.ok(!html.includes(`name="${COMMENT_FIELDS.trap}"`), 'and no honeypot');
    assert.match(html, new RegExp(`name="${COMMENT_FIELDS.body}"`), 'the comment box stays');
    assert.ok(!html.includes(ADA.email), 'the account email is nowhere on the page');
  });
});

describe('a comment from somebody signed in', () => {
  it('is attributed to the account, archive and email rather than to a form', async () => {
    const { cms, agent } = await signedInSite();
    const token = tokenIn(await postPage(agent));
    assert.ok(token !== undefined, 'the form carried a token');

    const posted = await agent.post(COMMENT_POST_PATH, submission(token));
    assert.equal(posted.status, 303);

    const [comment] = await storedComments(cms);
    assert.ok(comment !== undefined, 'the comment was written to the post file');
    assert.deepEqual(comment['author'], {
      name: ADA.displayName,
      url: `/author/${ADA.username}/`,
      email: ADA.email,
      avatar: null,
    });
  });

  it('is called by their username when the account has no display name', async () => {
    const cms = await site({}, {});
    const agent = await signIn(cms, { username: ADA.username, password: ADA.password });
    const token = tokenIn(await postPage(agent));
    assert.ok(token !== undefined);

    await agent.post(COMMENT_POST_PATH, submission(token));

    const [comment] = await storedComments(cms);
    assert.equal((comment?.['author'] as Record<string, unknown>)['name'], ADA.username);
  });

  it('ignores a name, email and website smuggled into the submission', async () => {
    const { cms, agent } = await signedInSite();
    const token = tokenIn(await postPage(agent));
    assert.ok(token !== undefined);

    await agent.post(
      COMMENT_POST_PATH,
      submission(token, {
        [COMMENT_FIELDS.name]: 'Somebody Else',
        [COMMENT_FIELDS.email]: 'nobody@example.net',
        [COMMENT_FIELDS.url]: 'https://elsewhere.example/',
      }),
    );

    const [comment] = await storedComments(cms);
    assert.deepEqual(comment?.['author'], {
      name: ADA.displayName,
      url: `/author/${ADA.username}/`,
      email: ADA.email,
      avatar: null,
    });
  });
});

describe('moderating a comment from the person who would moderate it', () => {
  it('approves it on arrival and never asks the spam checker', async () => {
    const asked: CommentSubmission[] = [];
    const checker: CommentChecker = {
      check(submission) {
        asked.push(submission);
        return 'spam';
      },
    };
    const { cms, agent } = await signedInSite({ commentChecker: checker });
    const token = tokenIn(await postPage(agent));
    assert.ok(token !== undefined);

    const posted = await agent.post(COMMENT_POST_PATH, submission(token));

    assert.equal(posted.status, 303);
    const [comment] = await storedComments(cms);
    assert.equal(comment?.['status'], 'approved', 'it is on the page, not in a queue');
    assert.deepEqual(asked, [], 'and the checker was never called');
    // And it really is on the page, which is what "approved" is for.
    assert.match(await postPage(agent), /Answering my own post\./);
  });

  it('still holds a stranger’s comment and still asks the checker about it', async () => {
    const asked: CommentSubmission[] = [];
    const checker: CommentChecker = {
      check(submission) {
        asked.push(submission);
        return 'unknown';
      },
    };
    const cms = await site({ commentChecker: checker });

    const posted = await cms.app.request(COMMENT_POST_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        [COMMENT_FIELDS.post]: 'hello-world',
        [COMMENT_FIELDS.name]: 'A Stranger',
        [COMMENT_FIELDS.body]: 'Hello from outside.',
        [COMMENT_FIELDS.inReplyTo]: '',
        [COMMENT_FIELDS.trap]: '',
        [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
      }).toString(),
    });

    assert.equal(posted.status, 303);
    const [comment] = await storedComments(cms);
    assert.equal(comment?.['status'], 'pending');
    assert.equal(asked.length, 1, 'the checker is still asked about a stranger');
  });
});

describe('the token on the signed-in form', () => {
  it('refuses a submission carrying somebody else’s token', async () => {
    const { cms, agent } = await signedInSite();

    const refused = await agent.post(
      COMMENT_POST_PATH,
      submission('0'.repeat(64), { [COMMENT_FIELDS.body]: 'Posted from another site.' }),
    );

    assert.equal(refused.status, 403);
    await assert.rejects(storedComments(cms), 'nothing was written');
  });

  it('refuses one carrying no token at all', async () => {
    const { cms, agent } = await signedInSite();
    const fields = submission('');
    delete fields[COMMENT_FIELDS.csrf];

    const refused = await agent.post(COMMENT_POST_PATH, fields);

    assert.equal(refused.status, 403);
    await assert.rejects(storedComments(cms), 'nothing was written');
  });

  it('is not asked of a stranger, whose form acts on nobody’s behalf', async () => {
    const cms = await site();

    const posted = await cms.app.request(COMMENT_POST_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        [COMMENT_FIELDS.post]: 'hello-world',
        [COMMENT_FIELDS.name]: 'A Stranger',
        [COMMENT_FIELDS.body]: 'No token here.',
        [COMMENT_FIELDS.inReplyTo]: '',
        [COMMENT_FIELDS.trap]: '',
        [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
      }).toString(),
    });

    assert.equal(posted.status, 303);
  });
});

describe('what a cache in front of the site is told', () => {
  it('keeps a personalised page out of every shared cache', async () => {
    const { agent } = await signedInSite();

    const response = await agent.get(POST_URL);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /\bprivate\b/);
    assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/);
    assert.equal(response.headers.get('etag'), null, 'and hands out no validator for it');
    assert.equal(response.headers.get('last-modified'), null);
  });

  it('leaves the page a stranger gets exactly as cacheable as it was', async () => {
    const cms = await site();

    const response = await cms.app.request(POST_URL);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(response.headers.get('vary'), 'Accept');
    assert.ok(response.headers.get('etag') !== null, 'it still has a validator');
    assert.ok(!(await response.text()).includes('Commenting as'));
  });
});

describe('a session cookie that is worth nothing', () => {
  it('falls back to the stranger’s form when the cookie is forged', async () => {
    const cms = await site();

    const response = await cms.app.request(POST_URL, {
      headers: { cookie: `geekity_session=${'a'.repeat(64)}` },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(!html.includes('Commenting as'), 'no name is printed');
    assert.match(html, new RegExp(`name="${COMMENT_FIELDS.trap}"`), 'the honeypot is back');
    assert.match(html, new RegExp(`name="${COMMENT_FIELDS.name}"`), 'and so is the name box');
  });

  it('falls back to it when the session has expired', async () => {
    const cms = await site({ sessionLifetime: 0.25 });
    const agent = await signIn(cms, { username: ADA.username, password: ADA.password });
    assert.match(await postPage(agent), /Commenting as/, 'good while it lasts');

    const held = agent.session();
    await setTimeout(300);
    agent.setSession(held);

    assert.ok(!(await postPage(agent)).includes('Commenting as'));
  });

  it('falls back to it for the anonymous session a login form hands out', async () => {
    const cms = await site();
    const agent = browser(cms);
    // Visiting the login form mints a session that holds a CSRF token and
    // names nobody. It is a live session, and it is not a login.
    await agent.get('/admin/login');
    assert.ok(agent.session() !== undefined, 'the login form handed out a cookie');

    assert.ok(!(await postPage(agent)).includes('Commenting as'));
  });
});
