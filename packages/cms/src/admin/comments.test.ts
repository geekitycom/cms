import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { addComment } from '../comments/records.ts';
import type { NewComment } from '../comments/records.ts';
import type { CommentReport } from '../comments/submission.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import {
  COMMENT_ADMIN_FIELDS,
  COMMENTS_MODERATE_PATH,
  COMMENTS_PATH,
  COMMENTS_REPLY_PATH,
} from './comments.ts';

/**
 * The moderation queue as a moderator meets it: three lists, four actions, and
 * a number on the dashboard that says somebody is waiting.
 */

const box = sandbox();

after(async () => {
  await box.cleanup();
});

/** The post everything below is commented on. */
const POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

/**
 * The moment the site's clock is stopped at: the day after the post, so it is
 * published and still open, whenever these tests are actually run.
 */
const NOW = new Date('2026-09-20T12:00:00.000Z');

/** A signed-in admin over a site with one post. */
async function moderating(
  config: GeekityConfig = {},
): Promise<{ cms: Cms; agent: Browser; token: string }> {
  const contentDir = await box.dir('geekity-moderation-content-');
  const dataDir = await box.dir('geekity-moderation-data-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(path.join(contentDir, 'posts/2026-09-19-hello-world.md'), POST, 'utf8');

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    now: () => NOW,
    ...config,
  });
  const agent = await signedIn(cms);
  const token = csrfField(await (await agent.get(COMMENTS_PATH)).text());
  assert.ok(token !== undefined, 'the queue carried a CSRF token');
  return { cms, agent, token };
}

/** One stored comment on the post. */
function comment(overrides: Partial<NewComment> = {}): NewComment {
  return {
    slug: 'hello-world',
    permalink: '/2026/09/hello-world/',
    source: 'comment',
    kind: 'reply',
    status: 'pending',
    author: { name: 'Ada Lovelace', url: null, email: 'ada@example.com' },
    content: { markdown: 'Good post.', html: '<p>Good post.</p>\n' },
    submitted: '2026-09-19T10:00:00.000Z',
    addressHash: 'deadbeefcafe',
    inReplyTo: null,
    ...overrides,
  };
}

/** Store one comment straight into the files, the way the form would. */
async function stored(cms: Cms, overrides: Partial<NewComment> = {}): Promise<string> {
  const written = await addComment(
    { admin: cms.admin, contentDir: cms.config.contentDir },
    comment(overrides),
  );
  return written.id;
}

describe('the comments screen', () => {
  it('opens on what is waiting, and counts each list', async () => {
    const { cms, agent } = await moderating();
    await stored(cms);
    await stored(cms, {
      status: 'approved',
      content: { markdown: 'Let through.', html: '<p>Let through.</p>' },
    });
    await stored(cms, {
      status: 'spam',
      content: { markdown: 'Buy pills.', html: '<p>Buy pills.</p>' },
    });

    const html = await (await agent.get(COMMENTS_PATH)).text();

    assert.match(html, /Pending \(1\)/);
    assert.match(html, /Approved \(1\)/);
    assert.match(html, /Spam \(1\)/);
    assert.match(html, /Good post\./);
    assert.ok(!html.includes('Buy pills.'), 'the spam list is not the pending one');
    // The email is the one thing only this screen shows.
    assert.match(html, /ada@example\.com/);
  });

  it('shows the spam list when asked for it', async () => {
    const { cms, agent } = await moderating();
    await stored(cms, {
      status: 'spam',
      content: { markdown: 'Buy pills.', html: '<p>Buy pills.</p>' },
    });

    const html = await (await agent.get(`${COMMENTS_PATH}?status=spam`)).text();
    assert.match(html, /Buy pills\./);
  });

  it('approves a comment, which puts it on the page', async () => {
    const { cms, agent, token } = await moderating();
    const id = await stored(cms);

    const response = await agent.post(COMMENTS_MODERATE_PATH, {
      csrf_token: token,
      [COMMENT_ADMIN_FIELDS.id]: id,
      [COMMENT_ADMIN_FIELDS.action]: 'approve',
      [COMMENT_ADMIN_FIELDS.status]: 'pending',
    });

    assert.equal(response.status, 303);
    assert.equal(cms.admin.getComment(id)?.status, 'approved');
    assert.match(await (await cms.app.request('/2026/09/hello-world/')).text(), /Good post\./);
  });

  it('files a comment as spam and takes it off the page', async () => {
    const { cms, agent, token } = await moderating();
    const id = await stored(cms, { status: 'approved' });

    await agent.post(COMMENTS_MODERATE_PATH, {
      csrf_token: token,
      [COMMENT_ADMIN_FIELDS.id]: id,
      [COMMENT_ADMIN_FIELDS.action]: 'spam',
      [COMMENT_ADMIN_FIELDS.status]: 'approved',
    });

    assert.equal(cms.admin.getComment(id)?.status, 'spam');
    assert.ok(
      !(await (await cms.app.request('/2026/09/hello-world/')).text()).includes('Good post.'),
      'spam is off the page',
    );
  });

  it('deletes a comment from the file as well as the index', async () => {
    const { cms, agent, token } = await moderating();
    const id = await stored(cms);

    await agent.post(COMMENTS_MODERATE_PATH, {
      csrf_token: token,
      [COMMENT_ADMIN_FIELDS.id]: id,
      [COMMENT_ADMIN_FIELDS.action]: 'delete',
      [COMMENT_ADMIN_FIELDS.status]: 'pending',
    });

    assert.equal(cms.admin.getComment(id), undefined);
    assert.equal(cms.admin.listComments({}).length, 0);
  });

  it('posts a reply under the comment it answers, already approved', async () => {
    const { cms, agent, token } = await moderating();
    const id = await stored(cms, { status: 'approved' });

    await agent.post(COMMENTS_REPLY_PATH, {
      csrf_token: token,
      [COMMENT_ADMIN_FIELDS.id]: id,
      [COMMENT_ADMIN_FIELDS.body]: 'Thanks, **Ada**.',
      [COMMENT_ADMIN_FIELDS.status]: 'approved',
    });

    const written = cms.admin.listCommentsFor('hello-world');
    assert.equal(written.length, 2);
    const reply = written.find((entry) => entry.inReplyTo === id);
    assert.equal(reply?.status, 'approved');
    assert.match(reply?.content.html ?? '', /<strong>Ada<\/strong>/);

    const html = await (await cms.app.request('/2026/09/hello-world/')).text();
    assert.ok(
      /<ol class="comment-replies">[\s\S]*?Thanks, <strong>Ada<\/strong>[\s\S]*?<\/ol>/.test(html),
      `the reply is nested under the comment: ${html}`,
    );
  });

  it('refuses a reply with nothing in it', async () => {
    const { cms, agent, token } = await moderating();
    const id = await stored(cms);

    await agent.post(COMMENTS_REPLY_PATH, {
      csrf_token: token,
      [COMMENT_ADMIN_FIELDS.id]: id,
      [COMMENT_ADMIN_FIELDS.body]: '   ',
      [COMMENT_ADMIN_FIELDS.status]: 'pending',
    });

    assert.equal(cms.admin.listCommentsFor('hello-world').length, 1);
  });

  it('shows how many comments are waiting on the dashboard', async () => {
    const { cms, agent } = await moderating();
    await stored(cms);
    await stored(cms, { author: { name: 'Grace', url: null, email: 'g@example.com' } });

    const html = await (await agent.get('/admin')).text();

    assert.match(html, /Comments waiting/);
    assert.match(html, /<dd><a href="\/admin\/comments\?status=pending">2<\/a><\/dd>/);
  });
});

describe('the checker the moderation actions correct', () => {
  /** A checker that remembers what it was told, and has no opinion on the way in. */
  function recorder(): {
    spam: CommentReport[];
    ham: CommentReport[];
    check: () => 'unknown';
    reportSpam: (report: CommentReport) => void;
    reportHam: (report: CommentReport) => void;
  } {
    const spam: CommentReport[] = [];
    const ham: CommentReport[] = [];
    return {
      spam,
      ham,
      check: () => 'unknown',
      reportSpam: (report) => spam.push(report),
      reportHam: (report) => ham.push(report),
    };
  }

  it('is told when a moderator files something as spam', async () => {
    const checker = recorder();
    const { cms, agent, token } = await moderating({ commentChecker: checker });
    const id = await stored(cms, { status: 'approved' });

    await agent.post(COMMENTS_MODERATE_PATH, {
      csrf_token: token,
      [COMMENT_ADMIN_FIELDS.id]: id,
      [COMMENT_ADMIN_FIELDS.action]: 'spam',
      [COMMENT_ADMIN_FIELDS.status]: 'approved',
    });

    assert.equal(checker.spam.length, 1);
    assert.equal(checker.spam[0]?.comment.id, id);
    assert.equal(checker.spam[0]?.url, 'https://blog.example/2026/09/hello-world/');
    assert.equal(checker.ham.length, 0);
  });

  it('is told when a moderator lets something out of the spam list', async () => {
    const checker = recorder();
    const { cms, agent, token } = await moderating({ commentChecker: checker });
    const id = await stored(cms, { status: 'spam' });

    await agent.post(COMMENTS_MODERATE_PATH, {
      csrf_token: token,
      [COMMENT_ADMIN_FIELDS.id]: id,
      [COMMENT_ADMIN_FIELDS.action]: 'approve',
      [COMMENT_ADMIN_FIELDS.status]: 'spam',
    });

    assert.equal(checker.ham.length, 1);
    assert.equal(checker.ham[0]?.comment.id, id);
    assert.equal(checker.spam.length, 0);
  });

  it('is not told when approving something that was only waiting', async () => {
    const checker = recorder();
    const { cms, agent, token } = await moderating({ commentChecker: checker });
    const id = await stored(cms);

    await agent.post(COMMENTS_MODERATE_PATH, {
      csrf_token: token,
      [COMMENT_ADMIN_FIELDS.id]: id,
      [COMMENT_ADMIN_FIELDS.action]: 'approve',
      [COMMENT_ADMIN_FIELDS.status]: 'pending',
    });

    assert.equal(checker.ham.length, 0);
    assert.equal(checker.spam.length, 0);
  });
});

describe('the editor’s Comments field', () => {
  /** The editor for the fixture post, and the token to save it with. */
  async function editing(agent: Browser): Promise<{ html: string; token: string }> {
    const html = await (await agent.get('/admin/posts/hello-world')).text();
    const token = csrfField(html);
    assert.ok(token !== undefined, 'the editor carried a CSRF token');
    return { html, token };
  }

  it('offers three answers and starts on the site’s own rules', async () => {
    const { agent } = await moderating();
    const { html } = await editing(agent);

    assert.match(html, /<select id="editor-comments" name="comments">/);
    assert.match(html, /<option value=""[^>]* selected>Follow the site settings<\/option>/);
    assert.match(html, /<option value="open">Open<\/option>/);
    assert.match(html, /<option value="closed">Closed<\/option>/);
  });

  it('writes comments: false into the front matter, and closes the post', async () => {
    const { cms, agent } = await moderating();
    const { token } = await editing(agent);

    await agent.post('/admin/posts/hello-world', {
      csrf_token: token,
      title: 'Hello world',
      slug: 'hello-world',
      permalink: '/2026/09/hello-world/',
      date: '2026-09-19T09:00:00Z',
      tags: '',
      categories: '',
      description: '',
      comments: 'closed',
      body: 'Words.',
      hash: cms.store.getBySlug('hello-world')?.hash ?? '',
      action: 'update',
    });
    await cms.sync();

    assert.equal(cms.store.getBySlug('hello-world')?.extra['comments'], false);
    assert.ok(
      !(await (await cms.app.request('/2026/09/hello-world/')).text()).includes('id="respond"'),
      'the post is closed',
    );
    // And the editor comes back showing what the file says.
    assert.match((await editing(agent)).html, /<option value="closed" selected>Closed<\/option>/);
  });
});
