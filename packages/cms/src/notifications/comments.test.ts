import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserNotification } from '../admin/accounts.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import { COMMENT_FIELDS } from '../comments/submission.ts';
import type { CommentChecker } from '../comments/submission.ts';
import { COMMENT_POST_PATH } from '../comments/form.ts';
import { readComments, updateComment } from '../comments/records.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import type { OutgoingMail } from '../mail/provider.ts';

/**
 * The notices a comment sets off, and the links they carry.
 *
 * Everything here goes through the app and the mail service, because that
 * chain is the feature: a comment arriving, a message going to whoever asked
 * for one, and a link in that message doing the thing it says without a login.
 * The provider is {@link createMemoryMailProvider}, so the message that would
 * have been sent is readable without a network.
 */

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** Where the site is. */
const BASE_URL = 'https://blog.example';

/** The moment every site below has its clock stopped at. */
const NOW = new Date('2026-09-20T12:00:00.000Z');

/** The post everything here is a comment on. */
const POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

/** What a booted site hands back. */
interface Site {
  cms: Cms;
  provider: MemoryMailProvider;
  contentDir: string;
  dataDir: string;
}

/** A CMS over one post, with one admin who has an address, and mail in a list. */
async function site(
  options: {
    /** Left out for a site that sends no mail at all. */
    mail?: boolean | undefined;
    /** What the admin's address is, or none at all. */
    email?: string | undefined;
    config?: GeekityConfig;
  } = {},
): Promise<Site> {
  const contentDir = await temporaryDir('geekity-notify-content-');
  const dataDir = await temporaryDir('geekity-notify-data-');
  const provider = createMemoryMailProvider();

  const file = path.join(contentDir, 'posts/2026-09-19-hello-world.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, POST, 'utf8');
  await writeSiteJson({
    contentDir,
    settings: { ...DEFAULT_SITE_SETTINGS, title: 'A Site', baseUrl: BASE_URL },
  });

  const cms = createCms({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    ...(options.mail === false
      ? {}
      : { mail: { provider, backoffMs: () => 0, logger: { info: () => {}, warn: () => {} } } }),
    ...options.config,
  });
  started.push(cms);
  await cms.sync();

  await createUser({
    dataDir,
    username: 'ada',
    password: 'correct horse battery',
    ...(options.email === undefined ? {} : { email: options.email }),
  });

  return { cms, provider, contentDir, dataDir };
}

/** One submitted comment form, with everything a valid submission needs. */
function submission(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [COMMENT_FIELDS.post]: 'hello-world',
    [COMMENT_FIELDS.name]: 'Grace Hopper',
    [COMMENT_FIELDS.email]: 'grace@example.com',
    [COMMENT_FIELDS.url]: '',
    [COMMENT_FIELDS.body]: 'A thought about this.',
    [COMMENT_FIELDS.inReplyTo]: '',
    [COMMENT_FIELDS.trap]: '',
    [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
    ...overrides,
  };
}

/** Post a comment form and wait for whatever it set off. */
async function submit(site: Site, fields: Record<string, string>): Promise<Response> {
  const response = await site.cms.app.request(COMMENT_POST_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  await site.cms.mail.settled();
  return response;
}

/** The one message that went, or a failed assertion saying none did. */
function onlyMessage(provider: MemoryMailProvider): OutgoingMail {
  assert.equal(provider.sent.length, 1, `exactly one message went, not ${provider.sent.length}`);
  const message = provider.sent[0];
  assert.ok(message !== undefined);
  return message;
}

/** Every `/_geekity/` link a message carries, in the order it carries them. */
function linksIn(message: OutgoingMail): string[] {
  return message.text.match(/https:\/\/blog\.example\/_geekity\/\S+/g) ?? [];
}

/** The one link in a message whose query says it does `action`. */
function linkFor(message: OutgoingMail, action: string): string {
  const found = linksIn(message).find(
    (link) => link.includes(`/${action}?`) || linkAction(link) === action,
  );
  assert.ok(found !== undefined, `no ${action} link in:\n${message.text}`);
  return found;
}

/** The `action` a moderation link names, read off its query. */
function linkAction(link: string): string {
  return new URL(link).searchParams.get('action') ?? '';
}

/** Just the path and query, which is what the test app answers on. */
function pathOf(link: string): string {
  const url = new URL(link);
  return `${url.pathname}${url.search}`;
}

/** Open a link the way somebody clicking it in a mail reader would. */
async function open(site: Site, link: string): Promise<{ status: number; html: string }> {
  const response = await site.cms.app.request(pathOf(link));
  return { status: response.status, html: await response.text() };
}

/** Confirm a link, which is what the button on the landing page does. */
async function confirm(site: Site, link: string): Promise<{ status: number; html: string }> {
  const url = new URL(link);
  const response = await site.cms.app.request(url.pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: url.searchParams.toString(),
  });
  await site.cms.mail.settled();
  return { status: response.status, html: await response.text() };
}

/** The comments the file holds, which is what a comment really is. */
function stored(site: Site) {
  return readComments(site.contentDir, 'hello-world');
}

describe('a comment waiting for a moderator (AC #1)', () => {
  it('emails every admin who has an address and wants to hear', async () => {
    const box = await site({ email: 'ada@example.com' });

    await submit(box, submission());

    const message = onlyMessage(box.provider);
    assert.deepEqual(
      message.to.map((recipient) => recipient.address),
      ['ada@example.com'],
    );
    assert.match(message.subject, /Hello world/);
    assert.match(message.text, /Grace Hopper/);
    assert.match(message.text, /A thought about this\./);
    assert.match(message.text, /https:\/\/blog\.example\/2026\/09\/hello-world\//);
  });

  it('carries a working approve, spam and delete link', async () => {
    const box = await site({ email: 'ada@example.com' });
    await submit(box, submission());

    const message = onlyMessage(box.provider);

    for (const action of ['approve', 'spam', 'delete']) {
      assert.ok(
        linksIn(message).some((link) => linkAction(link) === action),
        `the message carries a ${action} link`,
      );
    }
  });

  it('does not act on a link that is merely fetched, so a mail scanner cannot moderate', async () => {
    const box = await site({ email: 'ada@example.com' });
    await submit(box, submission());
    const link = linkFor(onlyMessage(box.provider), 'delete');

    const landing = await open(box, link);

    assert.equal(landing.status, 200);
    assert.match(landing.html, /Delete/i);
    assert.equal(stored(box).length, 1, 'nothing happened just because the link was opened');
  });

  it('approves the comment when the link is confirmed, with nobody signed in', async () => {
    const box = await site({ email: 'ada@example.com' });
    await submit(box, submission());
    const link = linkFor(onlyMessage(box.provider), 'approve');

    const done = await confirm(box, link);

    assert.equal(done.status, 200);
    assert.equal(stored(box)[0]?.status, 'approved');
  });

  it('files it as spam, or deletes it, from the other two links', async () => {
    const spam = await site({ email: 'ada@example.com' });
    await submit(spam, submission());
    await confirm(spam, linkFor(onlyMessage(spam.provider), 'spam'));
    assert.equal(stored(spam)[0]?.status, 'spam');

    const gone = await site({ email: 'ada@example.com' });
    await submit(gone, submission());
    await confirm(gone, linkFor(onlyMessage(gone.provider), 'delete'));
    assert.deepEqual(stored(gone), []);
  });

  it('spends the link, so a second use does nothing', async () => {
    const box = await site({ email: 'ada@example.com' });
    await submit(box, submission());
    const link = linkFor(onlyMessage(box.provider), 'approve');
    await confirm(box, link);

    // Put it back where it was, so a link that still worked would show.
    await updateComment(
      { admin: box.cms.admin, contentDir: box.contentDir },
      stored(box)[0]?.id ?? '',
      { status: 'pending' },
    );

    const again = await confirm(box, link);

    assert.match(again.html, /already been used|no longer/i);
    assert.equal(stored(box)[0]?.status, 'pending');
  });

  it('refuses a token somebody made up', async () => {
    const box = await site({ email: 'ada@example.com' });
    await submit(box, submission());
    const link = new URL(linkFor(onlyMessage(box.provider), 'approve'));
    link.searchParams.set('token', 'not.a-token');

    const landing = await open(box, link.href);

    assert.equal(landing.status, 400);
    assert.equal(stored(box)[0]?.status, 'pending');
  });

  it('says nothing to an admin with no address, and nothing to one who turned it off', async () => {
    const nobody = await site();
    await submit(nobody, submission());
    assert.equal(nobody.provider.sent.length, 0);

    const off = await site({ email: 'ada@example.com' });
    await setUserNotification({
      dataDir: off.dataDir,
      userId: 1,
      event: 'comments',
      on: false,
    });
    await submit(off, submission());
    assert.equal(off.provider.sent.length, 0);
  });

  it('says nothing about a comment that was approved rather than queued', async () => {
    const box = await site({ email: 'ada@example.com' });
    // WordPress's rule: an author already approved once does not queue again.
    await submit(box, submission());
    await confirm(box, linkFor(onlyMessage(box.provider), 'approve'));
    box.provider.clear();

    await submit(box, submission({ [COMMENT_FIELDS.body]: 'And another thought.' }));

    assert.equal(box.provider.sent.length, 0, 'nothing is waiting, so nothing was sent');
  });
});

describe('a comment the checker threw away (AC #4)', () => {
  it('sends nothing at all', async () => {
    const discarding: CommentChecker = { check: () => 'discard' };
    const box = await site({
      email: 'ada@example.com',
      config: { commentChecker: discarding },
    });

    await submit(box, submission());

    assert.deepEqual(stored(box), [], 'it was never stored');
    assert.equal(box.provider.sent.length, 0);
  });

  it('still says nothing when the checker only called it spam', async () => {
    const spamming: CommentChecker = { check: () => 'spam' };
    const box = await site({ email: 'ada@example.com', config: { commentChecker: spamming } });

    await submit(box, submission());

    assert.equal(stored(box)[0]?.status, 'spam');
    assert.equal(box.provider.sent.length, 0, 'spam is not a queue anybody is waiting on');
  });
});

describe('telling a commenter about a reply (AC #2)', () => {
  /** A comment from Grace who asked to hear about replies, already approved. */
  async function graceCommented(box: Site): Promise<string> {
    await submit(box, submission({ [COMMENT_FIELDS.notify]: '1' }));
    const first = stored(box)[0];
    assert.ok(first !== undefined);
    await confirm(box, linkFor(onlyMessage(box.provider), 'approve'));
    box.provider.clear();
    return first.id;
  }

  it('keeps the box off the form when the site cannot send mail', async () => {
    const box = await site({ mail: false });

    const page = await (await box.cms.app.request('/2026/09/hello-world/')).text();

    assert.doesNotMatch(page, new RegExp(`name="${COMMENT_FIELDS.notify}"`));
  });

  it('offers the box when the site can send mail', async () => {
    const box = await site({ email: 'ada@example.com' });

    const page = await (await box.cms.app.request('/2026/09/hello-world/')).text();

    assert.match(page, new RegExp(`name="${COMMENT_FIELDS.notify}"`));
  });

  it('emails them when a reply is approved, and not before', async () => {
    const box = await site({ email: 'ada@example.com' });
    const parent = await graceCommented(box);

    await submit(
      box,
      submission({
        [COMMENT_FIELDS.name]: 'Alan Turing',
        [COMMENT_FIELDS.email]: 'alan@example.com',
        [COMMENT_FIELDS.body]: 'I agree.',
        [COMMENT_FIELDS.inReplyTo]: parent,
      }),
    );

    // What went is the moderation notice, addressed to the admin. Grace hears
    // nothing about a reply nobody has approved.
    assert.deepEqual(
      box.provider.sent.flatMap((message) => message.to.map((to) => to.address)),
      ['ada@example.com'],
    );

    const moderation = onlyMessage(box.provider);
    box.provider.clear();
    await confirm(box, linkFor(moderation, 'approve'));

    const told = onlyMessage(box.provider);
    assert.deepEqual(
      told.to.map((to) => to.address),
      ['grace@example.com'],
    );
    assert.match(told.text, /Alan Turing/);
    assert.match(told.text, /I agree\./);
  });

  it('says nothing to somebody who never ticked the box', async () => {
    const box = await site({ email: 'ada@example.com' });
    await submit(box, submission());
    const parent = stored(box)[0];
    assert.ok(parent !== undefined);
    await confirm(box, linkFor(onlyMessage(box.provider), 'approve'));
    box.provider.clear();

    await submit(
      box,
      submission({
        [COMMENT_FIELDS.name]: 'Alan Turing',
        [COMMENT_FIELDS.email]: 'alan@example.com',
        [COMMENT_FIELDS.body]: 'I agree.',
        [COMMENT_FIELDS.inReplyTo]: parent.id,
      }),
    );
    const moderation = onlyMessage(box.provider);
    box.provider.clear();
    await confirm(box, linkFor(moderation, 'approve'));

    assert.equal(box.provider.sent.length, 0);
  });

  it('stops writing once the unsubscribe link is used', async () => {
    const box = await site({ email: 'ada@example.com' });
    const parent = await graceCommented(box);

    /**
     * One reply from Alan, ending up approved.
     *
     * His first goes through the queue; his second is let straight through,
     * because a name and email approved once does not queue again. Both are
     * the same thing from Grace's side, which is what is being asked about.
     */
    async function replyAndApprove(body: string): Promise<void> {
      await submit(
        box,
        submission({
          [COMMENT_FIELDS.name]: 'Alan Turing',
          [COMMENT_FIELDS.email]: 'alan@example.com',
          [COMMENT_FIELDS.body]: body,
          [COMMENT_FIELDS.inReplyTo]: parent,
        }),
      );

      const queued = box.provider.sent.find((message) =>
        message.to.some((to) => to.address === 'ada@example.com'),
      );
      if (queued === undefined) return;

      box.provider.clear();
      await confirm(box, linkFor(queued, 'approve'));
    }

    await replyAndApprove('I agree.');
    const told = onlyMessage(box.provider);
    const unsubscribe = linkFor(told, 'unsubscribe');
    box.provider.clear();

    const landing = await open(box, unsubscribe);
    assert.equal(landing.status, 200);
    assert.match(landing.html, /grace@example\.com/);
    const done = await confirm(box, unsubscribe);
    assert.equal(done.status, 200);

    await replyAndApprove('And another thing.');

    assert.equal(box.provider.sent.length, 0, 'nothing was sent to Grace after she unsubscribed');
  });
});

describe('a site with no mail configured (AC #5)', () => {
  it('takes a comment, queues it and breaks nothing', async () => {
    const box = await site({ mail: false, email: 'ada@example.com' });

    const response = await submit(box, submission());

    assert.equal(response.status, 303);
    assert.equal(stored(box)[0]?.status, 'pending');
    assert.equal(box.provider.sent.length, 0);
  });

  it('records no reply opt-in it could never honour', async () => {
    const box = await site({ mail: false });

    await submit(box, submission({ [COMMENT_FIELDS.notify]: '1' }));

    assert.equal(stored(box)[0]?.notify, false);
  });
});

describe('what a comment file gives away', () => {
  it('keeps the address out of every public representation of the comment', async () => {
    const box = await site({ email: 'ada@example.com' });
    await submit(box, submission({ [COMMENT_FIELDS.notify]: '1' }));
    await confirm(box, linkFor(onlyMessage(box.provider), 'approve'));

    for (const [what, request] of [
      ['the page', box.cms.app.request('/2026/09/hello-world/')],
      [
        'the JSON representation',
        box.cms.app.request('/2026/09/hello-world/', { headers: { accept: 'application/json' } }),
      ],
      [
        'the Markdown representation',
        box.cms.app.request('/2026/09/hello-world/', { headers: { accept: 'text/markdown' } }),
      ],
      ['the post comments feed', box.cms.app.request('/2026/09/hello-world/feed/')],
      ['the site comments feed', box.cms.app.request('/comments/feed/')],
    ] as const) {
      const body = await (await request).text();
      assert.doesNotMatch(body, /grace@example\.com/, `${what} does not carry the address`);
    }
  });
});
