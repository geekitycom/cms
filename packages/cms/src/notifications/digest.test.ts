import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserNotification, setUserNotificationMode } from '../admin/accounts.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import { COMMENT_FIELDS } from '../comments/submission.ts';
import { COMMENT_POST_PATH } from '../comments/form.ts';
import { readComments, updateComment } from '../comments/records.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import type { OutgoingMail } from '../mail/provider.ts';
import { createCommentDigest, readDigestTimes } from './digest.ts';
import type { NotificationTimers } from './digest.ts';

/**
 * The hourly and daily digest: one message per user per window, listing what
 * is still waiting, instead of one message per comment.
 *
 * Everything here goes through the app, the users file and the mail service,
 * because that chain is the feature. The clock is a variable a test moves,
 * which is what makes an hour pass without an hour passing.
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

/** The moment every site below starts at. */
const START = new Date('2026-09-20T12:00:00.000Z');

/** An hour and a day, in milliseconds, as the windows are. */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
  /** Move the clock every part of the site reads. */
  advance(ms: number): void;
  /** What the clock says now. */
  at(): Date;
}

/** A CMS over one post, with a movable clock and mail in a list. */
async function site(
  options: {
    /** Left out for a site that sends no mail at all. */
    mail?: boolean | undefined;
    /** Boot over directories a previous site used, for the restart tests. */
    contentDir?: string | undefined;
    dataDir?: string | undefined;
    /** Where the clock starts. */
    now?: Date | undefined;
    config?: GeekityConfig;
  } = {},
): Promise<Site> {
  const contentDir = options.contentDir ?? (await temporaryDir('geekity-digest-content-'));
  const dataDir = options.dataDir ?? (await temporaryDir('geekity-digest-data-'));
  const provider = createMemoryMailProvider();
  let clock = options.now ?? START;

  if (options.contentDir === undefined) {
    const file = path.join(contentDir, 'posts/2026-09-19-hello-world.md');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, POST, 'utf8');
    await writeSiteJson({
      contentDir,
      settings: { ...DEFAULT_SITE_SETTINGS, title: 'A Site', baseUrl: BASE_URL },
    });
  }

  const cms = createCms({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => clock,
    ...(options.mail === false
      ? {}
      : { mail: { provider, backoffMs: () => 0, logger: { info: () => {}, warn: () => {} } } }),
    ...options.config,
  });
  started.push(cms);
  await cms.sync();

  return {
    cms,
    provider,
    contentDir,
    dataDir,
    advance(ms) {
      clock = new Date(clock.getTime() + ms);
    },
    at() {
      return clock;
    },
  };
}

/** Add an admin who wants the comments notice in one message per window. */
async function digestUser(
  box: Site,
  username: string,
  email: string,
  mode: 'hourly' | 'daily' = 'hourly',
): Promise<number> {
  const user = await createUser({
    dataDir: box.dataDir,
    username,
    password: 'correct horse battery',
    email,
  });
  await setUserNotificationMode({
    dataDir: box.dataDir,
    userId: user.id,
    event: 'comments',
    mode,
  });
  return user.id;
}

/** One submitted comment form, with everything a valid submission needs. */
function submission(box: Site, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [COMMENT_FIELDS.post]: 'hello-world',
    [COMMENT_FIELDS.name]: 'Grace Hopper',
    [COMMENT_FIELDS.email]: 'grace@example.com',
    [COMMENT_FIELDS.url]: '',
    [COMMENT_FIELDS.body]: 'A thought about this.',
    [COMMENT_FIELDS.inReplyTo]: '',
    [COMMENT_FIELDS.trap]: '',
    [COMMENT_FIELDS.loaded]: String(box.at().getTime() - 60_000),
    ...overrides,
  };
}

/** Post a comment form and wait for whatever it set off. */
async function submit(box: Site, fields: Record<string, string>): Promise<Response> {
  const response = await box.cms.app.request(COMMENT_POST_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  await box.cms.mail.settled();
  return response;
}

/** One comment by somebody nobody has approved before, so it queues. */
async function comment(box: Site, name: string, said: string): Promise<void> {
  await submit(
    box,
    submission(box, {
      [COMMENT_FIELDS.name]: name,
      [COMMENT_FIELDS.email]: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      [COMMENT_FIELDS.body]: said,
    }),
  );
}

/** Run the digests and let whatever they sent settle. */
async function runDigests(box: Site): Promise<number> {
  const sent = await box.cms.digests.run();
  await box.cms.mail.settled();
  return sent;
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

/** The `action` a moderation link names, read off its query. */
function linkAction(link: string): string {
  return new URL(link).searchParams.get('action') ?? '';
}

/** Every link in a message that does `action`. */
function linksFor(message: OutgoingMail, action: string): string[] {
  return linksIn(message).filter((link) => linkAction(link) === action);
}

/** Confirm a link, which is what the button on the landing page does. */
async function confirm(box: Site, link: string): Promise<number> {
  const url = new URL(link);
  const response = await box.cms.app.request(url.pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: url.searchParams.toString(),
  });
  await box.cms.mail.settled();
  return response.status;
}

/** The comments the file holds, which is what a comment really is. */
function stored(box: Site) {
  return readComments(box.contentDir, 'hello-world');
}

describe('a user who has asked for a digest (AC #2)', () => {
  it('is told nothing at the moment a comment arrives', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com');

    await comment(box, 'Grace Hopper', 'A thought about this.');

    assert.equal(box.provider.sent.length, 0, 'nothing went out with the comment');
  });

  it('gets one message listing everything still waiting when the digest runs', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com');
    await comment(box, 'Grace Hopper', 'The first thought.');
    await comment(box, 'Alan Turing', 'The second thought.');

    const sent = await runDigests(box);

    assert.equal(sent, 1, 'one message, not one per comment');
    const message = onlyMessage(box.provider);
    assert.deepEqual(
      message.to.map((recipient) => recipient.address),
      ['ada@example.com'],
    );
    assert.match(message.text, /The first thought\./);
    assert.match(message.text, /The second thought\./);
    assert.match(message.text, /Hello world/);
  });

  it('carries approve, spam and delete for every item, each one working', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com');
    await comment(box, 'Grace Hopper', 'The first thought.');
    await comment(box, 'Alan Turing', 'The second thought.');
    await runDigests(box);

    const message = onlyMessage(box.provider);
    for (const action of ['approve', 'spam', 'delete']) {
      assert.equal(linksFor(message, action).length, 2, `two ${action} links, one per comment`);
    }

    assert.equal(await confirm(box, linksFor(message, 'approve')[0] ?? ''), 200);
    assert.equal(await confirm(box, linksFor(message, 'spam')[1] ?? ''), 200);

    const statuses = stored(box)
      .map((entry) => entry.status)
      .sort();
    assert.deepEqual(statuses, ['approved', 'spam'], 'each link acted on its own comment');
  });

  it('sends one message each to two users who both asked', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com');
    await digestUser(box, 'grace', 'grace.admin@example.com', 'daily');
    await comment(box, 'Grace Hopper', 'A thought about this.');

    const sent = await runDigests(box);

    assert.equal(sent, 2);
    assert.deepEqual(
      box.provider.sent.flatMap((message) => message.to.map((who) => who.address)).sort(),
      ['ada@example.com', 'grace.admin@example.com'],
    );
  });

  it('leaves a user in the immediate mode exactly as they were', async () => {
    const box = await site();
    await createUser({
      dataDir: box.dataDir,
      username: 'ada',
      password: 'correct horse battery',
      email: 'ada@example.com',
    });

    await comment(box, 'Grace Hopper', 'A thought about this.');
    assert.equal(box.provider.sent.length, 1, 'the moderation notice went at once');
    assert.match(onlyMessage(box.provider).subject, /New comment/);

    box.provider.clear();
    assert.equal(await runDigests(box), 0, 'and there is no digest for them');
    assert.equal(box.provider.sent.length, 0);
  });

  it('says nothing to a user who turned the notice off altogether', async () => {
    const box = await site();
    const ada = await digestUser(box, 'ada', 'ada@example.com');
    await setUserNotification({
      dataDir: box.dataDir,
      userId: ada,
      event: 'comments',
      on: false,
    });
    await comment(box, 'Grace Hopper', 'A thought about this.');

    assert.equal(await runDigests(box), 0);
  });

  it('says nothing to a user with a mode but no address', async () => {
    const box = await site();
    const user = await createUser({
      dataDir: box.dataDir,
      username: 'ada',
      password: 'correct horse battery',
    });
    await setUserNotificationMode({
      dataDir: box.dataDir,
      userId: user.id,
      event: 'comments',
      mode: 'hourly',
    });
    await comment(box, 'Grace Hopper', 'A thought about this.');

    assert.equal(await runDigests(box), 0);
  });
});

describe('what a digest is built from (AC #3)', () => {
  it('sends nothing at all when nothing is waiting', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com');

    assert.equal(await runDigests(box), 0);
    assert.equal(box.provider.sent.length, 0);
  });

  it('does not start the clock on a window in which nothing was sent', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com');

    await runDigests(box);
    assert.deepEqual(readDigestTimes(box.dataDir), {}, 'an empty run records nothing');

    await comment(box, 'Grace Hopper', 'A thought about this.');
    assert.equal(await runDigests(box), 1, 'so the first thing waiting goes out at once');
  });

  it('leaves out an item that was moderated before the run', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com');
    await comment(box, 'Grace Hopper', 'The first thought.');
    await comment(box, 'Alan Turing', 'The second thought.');

    // Approved on the moderation screen, before anybody was told about it.
    const first = stored(box).find((entry) => entry.content.markdown.includes('first'));
    assert.ok(first !== undefined);
    await updateComment({ admin: box.cms.admin, contentDir: box.contentDir }, first.id, {
      status: 'approved',
    });

    await runDigests(box);

    const message = onlyMessage(box.provider);
    assert.doesNotMatch(message.text, /The first thought\./, 'the approved one is gone');
    assert.match(message.text, /The second thought\./, 'the one still waiting is there');
  });
});

describe('a queue too long to put in one message', () => {
  it('lists what it can, counts the rest and points at the queue', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com');
    await comment(box, 'Grace Hopper', 'The first thought.');
    await comment(box, 'Alan Turing', 'The second thought.');
    await comment(box, 'Edsger Dijkstra', 'The third thought.');

    const digests = createCommentDigest({
      admin: box.cms.admin,
      store: box.cms.store,
      mail: box.cms.mail,
      config: box.cms.config,
      maxItems: 1,
    });
    assert.equal(await digests.run(), 1);
    await box.cms.mail.settled();

    const message = onlyMessage(box.provider);
    assert.equal(linksFor(message, 'approve').length, 1, 'one item was listed');
    assert.match(message.text, /3 comments are waiting/);
    assert.match(message.text, /2 more waiting/);
    assert.match(message.text, /https:\/\/blog\.example\/admin\/comments/);
  });
});

describe('one message per window', () => {
  it('says nothing again until the window is up', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com');
    await comment(box, 'Grace Hopper', 'The first thought.');
    assert.equal(await runDigests(box), 1);
    box.provider.clear();

    box.advance(HOUR - 1000);
    await comment(box, 'Alan Turing', 'The second thought.');
    assert.equal(await runDigests(box), 0, 'still inside the hour');

    box.advance(2000);
    assert.equal(await runDigests(box), 1, 'and out the other side of it');
    assert.match(onlyMessage(box.provider).text, /The second thought\./);
  });

  it('waits a day for a user who asked for a day', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com', 'daily');
    await comment(box, 'Grace Hopper', 'The first thought.');
    assert.equal(await runDigests(box), 1);
    box.provider.clear();

    box.advance(2 * HOUR);
    await comment(box, 'Alan Turing', 'The second thought.');
    assert.equal(await runDigests(box), 0, 'an hour is not a day');

    box.advance(DAY);
    assert.equal(await runDigests(box), 1);
  });
});

describe('the record of what has been sent (AC #4)', () => {
  it('is a file under data/, so it survives a restart', async () => {
    const first = await site();
    await digestUser(first, 'ada', 'ada@example.com');
    await comment(first, 'Grace Hopper', 'The first thought.');
    assert.equal(await runDigests(first), 1);

    const recorded = readDigestTimes(first.dataDir);
    assert.deepEqual(recorded, { comments: { '1': START.toISOString() } });
  });

  it('neither resends nor skips a window across a restart', async () => {
    const first = await site();
    await digestUser(first, 'ada', 'ada@example.com');
    await comment(first, 'Grace Hopper', 'The first thought.');
    await runDigests(first);
    await first.cms.close();

    // The same directories, half an hour later, with the database deleted the
    // way `geekity rebuild` deletes it.
    await rm(path.join(first.dataDir, 'geekity.db'), { force: true });
    const again = await site({
      contentDir: first.contentDir,
      dataDir: first.dataDir,
      now: new Date(START.getTime() + HOUR / 2),
    });

    assert.equal(await runDigests(again), 0, 'the window it was already in is remembered');

    again.advance(HOUR);
    assert.equal(await runDigests(again), 1, 'and the next one still comes');
  });
});

describe('a site that sends no mail (AC #6)', () => {
  it('runs the digests, sends nothing and writes nothing down', async () => {
    const box = await site({ mail: false });
    await digestUser(box, 'ada', 'ada@example.com');
    await comment(box, 'Grace Hopper', 'A thought about this.');

    assert.equal(await runDigests(box), 0);
    assert.equal(box.provider.sent.length, 0);
    assert.deepEqual(readDigestTimes(box.dataDir), {});
  });
});

describe('the timer', () => {
  it('runs a digest on its own, and stops when it is stopped', async () => {
    const box = await site();
    await digestUser(box, 'ada', 'ada@example.com');
    await comment(box, 'Grace Hopper', 'A thought about this.');

    const ticks: (() => void)[] = [];
    let cleared = 0;
    const timers: NotificationTimers = {
      set(callback) {
        ticks.push(callback);
        return ticks.length;
      },
      clear() {
        cleared += 1;
      },
    };

    const digests = createCommentDigest({
      admin: box.cms.admin,
      store: box.cms.store,
      mail: box.cms.mail,
      config: box.cms.config,
      timers,
    });

    digests.start();
    assert.equal(ticks.length, 1, 'starting armed the tick');

    ticks[0]?.();
    await digests.settled();
    await box.cms.mail.settled();
    assert.equal(box.provider.sent.length, 1, 'the tick sent the digest');

    digests.stop();
    assert.equal(cleared, 1, 'stopping cleared it');
  });
});
