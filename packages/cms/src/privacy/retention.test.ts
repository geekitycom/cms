import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { commentEmailsFile, readComments, rebuildCommentIndexes } from '../comments/records.ts';
import { addContactMessage, contactDirectory, readContactMessage } from '../contact/records.ts';
import type { Cms } from '../index.ts';
import { moderationLink } from '../notifications/links.ts';

/**
 * Retention (TASK-135): what a sweep removes once it has outlived the site's
 * periods, and what it must leave exactly as it was.
 */

const box = sandbox();
after(() => box.cleanup());

const NOW = new Date('2026-09-28T12:00:00.000Z');

/** Past every default period, the year contact messages are kept included. */
const ANCIENT = '2025-06-01T10:00:00.000Z';
/** Past the email and address-hash periods: 211 days old. */
const OLD = '2026-03-01T10:00:00.000Z';
/** Past the address-hash period only: 44 days old. */
const MIDDLING = '2026-08-15T10:00:00.000Z';
/** Inside every period. */
const RECENT = '2026-09-20T10:00:00.000Z';

const PERMALINK = '/2026/03/hello-world/';

const POST = `---
title: Hello world
date: '2026-03-01T09:00:00Z'
permalink: ${PERMALINK}
comments: true
---

Words.
`;

interface Entry {
  id: string;
  name: string;
  email: string | null;
  submitted: string;
  status?: string;
  inReplyTo?: string | null;
  notify?: boolean;
}

function entry(one: Entry): Record<string, unknown> {
  return {
    id: one.id,
    source: 'comment',
    kind: 'reply',
    status: one.status ?? 'approved',
    author: { name: one.name, url: 'https://people.example/', email: one.email, avatar: null },
    content: { markdown: `Said by ${one.name}.`, html: `<p>Said by ${one.name}.</p>\n` },
    submitted: one.submitted,
    addressHash: `hash-${one.id}`,
    inReplyTo: one.inReplyTo ?? null,
    url: null,
    notify: one.notify ?? false,
  };
}

/** The recommended periods, which a site has to have chosen for the sweep to remove anything. */
const CHOSEN = {
  commentEmailRetentionDays: 180,
  addressHashRetentionDays: 30,
  contactMessageRetentionDays: 365,
};

/** A site with one post whose comment file holds `entries`, its clock at {@link NOW}. */
async function siteWith(
  entries: Entry[],
  siteJson: Record<string, unknown> = CHOSEN,
): Promise<{ cms: Cms; contentDir: string; dataDir: string; file: string }> {
  const contentDir = await box.dir('geekity-retention-content-');
  const dataDir = await box.dir('geekity-retention-data-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await mkdir(path.join(contentDir, '_data', 'comments'), { recursive: true });
  await writeFile(path.join(contentDir, 'posts', '2026-03-01-hello-world.md'), POST, 'utf8');
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'Retained', url: 'https://blog.example', ...siteJson }),
    'utf8',
  );
  const file = path.join(contentDir, '_data', 'comments', 'hello-world.json');
  await writeFile(
    file,
    `${JSON.stringify({ post: PERMALINK, comments: entries.map(entry) }, null, 2)}\n`,
    'utf8',
  );

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    port: 0,
    now: () => NOW,
  });
  return { cms, contentDir, dataDir, file };
}

async function fileEntries(file: string): Promise<Record<string, unknown>[]> {
  const parsed = JSON.parse(await readFile(file, 'utf8')) as {
    comments: Record<string, unknown>[];
  };
  return parsed.comments;
}

async function message(dataDir: string, received: string, email: string): Promise<string> {
  const stored = await addContactMessage(dataDir, {
    received,
    status: 'received',
    page: { slug: 'contact', permalink: '/contact/', title: 'Contact' },
    from: { name: 'Grace', email },
    subject: 'Hello',
    message: 'A message.',
    addressHash: 'contact-hash',
  });
  return stored.id;
}

describe('the retention sweep', () => {
  it('removes emails, address hashes and contact messages past their periods, from the files and the index', async () => {
    const { cms, dataDir, file } = await siteWith([
      { id: 'old', name: 'Ada', email: 'ada@example.com', submitted: OLD, notify: true },
      { id: 'middling', name: 'Grace', email: 'grace@example.com', submitted: MIDDLING },
      { id: 'recent', name: 'Alan', email: 'alan@example.com', submitted: RECENT },
    ]);
    const oldMessage = await message(dataDir, ANCIENT, 'old@example.com');
    const middlingMessage = await message(dataDir, MIDDLING, 'middling@example.com');
    const recentMessage = await message(dataDir, RECENT, 'recent@example.com');

    await cms.retention.sweep();

    const emails = await readFile(commentEmailsFile(dataDir, 'hello-world'), 'utf8');
    assert.doesNotMatch(emails, /ada@example\.com/, 'the 211-day-old email is gone from data/');
    const [old, middling, recent] = readComments(cms.config, 'hello-world');
    assert.equal(old?.author.email, null, 'and from the comment as the files say it');
    assert.equal(old?.addressHash, null);
    assert.equal(old?.notify, false, 'and with it the reply subscription');
    assert.deepEqual(old?.redacted, ['email', 'addressHash']);
    assert.deepEqual((await fileEntries(file))[0]?.['redacted'], ['email', 'addressHash']);

    assert.equal(middling?.author.email, 'grace@example.com', 'a 44-day-old email stays');
    assert.equal(middling?.addressHash, null, 'but its address hash is past 30 days');
    assert.deepEqual(middling?.redacted, ['addressHash']);

    assert.equal(recent?.author.email, 'alan@example.com');
    assert.equal(recent?.addressHash, 'hash-recent');
    assert.equal(recent?.redacted, undefined, 'nothing removed, nothing marked');

    const indexed = cms.admin.getComment('old');
    assert.equal(indexed?.author.email, null, 'the index says what the file says');
    assert.equal(indexed?.addressHash, null);
    assert.equal(indexed?.notify, false);
    assert.equal(cms.admin.getComment('middling')?.addressHash, null);
    assert.equal(cms.admin.getComment('recent')?.author.email, 'alan@example.com');

    assert.equal(
      readContactMessage(dataDir, oldMessage),
      undefined,
      'a year-old message is deleted',
    );
    assert.equal(readContactMessage(dataDir, middlingMessage)?.addressHash, null);
    assert.equal(readContactMessage(dataDir, middlingMessage)?.from.email, 'middling@example.com');
    assert.equal(readContactMessage(dataDir, recentMessage)?.addressHash, 'contact-hash');
  });

  it('changes nothing the second time', async () => {
    const { cms, dataDir, file } = await siteWith([
      { id: 'old', name: 'Ada', email: 'ada@example.com', submitted: OLD },
      { id: 'recent', name: 'Alan', email: 'alan@example.com', submitted: RECENT },
    ]);
    await message(dataDir, MIDDLING, 'middling@example.com');

    const first = await cms.retention.sweep();
    assert.deepEqual(first, { comments: 1, messagesDeleted: 0, messagesRedacted: 1 });

    const comments = await readFile(file, 'utf8');
    const contact = await readdir(contactDirectory(dataDir));
    const bytes = await Promise.all(
      contact.map((name) => readFile(path.join(contactDirectory(dataDir), name), 'utf8')),
    );

    const second = await cms.retention.sweep();
    assert.deepEqual(second, { comments: 0, messagesDeleted: 0, messagesRedacted: 0 });
    assert.equal(
      await readFile(file, 'utf8'),
      comments,
      'the comment file is byte for byte the same',
    );
    assert.deepEqual(
      await Promise.all(
        contact.map((name) => readFile(path.join(contactDirectory(dataDir), name), 'utf8')),
      ),
      bytes,
    );
  });

  it('keeps everything forever when every period is 0', async () => {
    const { cms, dataDir, file } = await siteWith(
      [{ id: 'old', name: 'Ada', email: 'ada@example.com', submitted: OLD }],
      { commentEmailRetentionDays: 0, addressHashRetentionDays: 0, contactMessageRetentionDays: 0 },
    );
    const oldMessage = await message(dataDir, ANCIENT, 'old@example.com');
    const before = await readFile(file, 'utf8');

    await cms.retention.sweep();

    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal(readContactMessage(dataDir, oldMessage)?.addressHash, 'contact-hash');
  });

  it('removes nothing on an upgraded site whose site.json never chose a period', async () => {
    const { cms, dataDir, file } = await siteWith(
      [{ id: 'old', name: 'Ada', email: 'ada@example.com', submitted: OLD, notify: true }],
      {},
    );
    const oldMessage = await message(dataDir, ANCIENT, 'old@example.com');
    const before = await readFile(file, 'utf8');

    const report = await cms.retention.sweep();

    assert.deepEqual(report, { comments: 0, messagesDeleted: 0, messagesRedacted: 0 });
    assert.equal(await readFile(file, 'utf8'), before, 'the old email and hash are still there');
    assert.equal(cms.admin.getComment('old')?.author.email, 'ada@example.com');
    assert.equal(readContactMessage(dataDir, oldMessage)?.from.email, 'old@example.com');
    assert.equal(readContactMessage(dataDir, oldMessage)?.addressHash, 'contact-hash');
  });

  it('runs once the site serves', async () => {
    const { cms } = await siteWith([
      { id: 'old', name: 'Ada', email: 'ada@example.com', submitted: OLD },
    ]);

    await cms.serve();
    await cms.retention.settled();

    assert.equal(readComments(cms.config, 'hello-world')[0]?.author.email, null);
    await cms.close();
  });
});

describe('a comment whose email has been removed', () => {
  it('keeps its place in the thread, its status and its words on the page', async () => {
    const { cms } = await siteWith([
      { id: 'parent', name: 'Ada', email: 'ada@example.com', submitted: OLD, notify: true },
      {
        id: 'reply',
        name: 'Alan',
        email: 'alan@example.com',
        submitted: RECENT,
        inReplyTo: 'parent',
      },
    ]);

    await cms.retention.sweep();

    const parent = cms.admin.getComment('parent');
    assert.equal(parent?.status, 'approved');
    assert.equal(parent?.author.name, 'Ada');
    assert.equal(cms.admin.getComment('reply')?.inReplyTo, 'parent');

    const page = await (await cms.app.request(PERMALINK)).text();
    assert.match(page, /Said by Ada\./);
    assert.match(page, /Said by Alan\./);
    assert.doesNotMatch(page, /ada@example\.com/);

    const agent = await signedIn(cms);
    const queue = await (await agent.get('/admin/comments?status=approved')).text();
    assert.match(queue, /Said by Ada\./, 'the moderation screen still lists it');
    assert.match(queue, /email removed after the retention period/);
  });

  it('does not make every emailless comment under that name auto-approved', async () => {
    const { cms } = await siteWith([
      { id: 'old', name: 'Ada', email: 'ada@example.com', submitted: OLD },
    ]);
    assert.equal(cms.admin.hasApprovedAuthor('Ada', null), false, 'before the sweep');

    await cms.retention.sweep();

    assert.equal(cms.admin.hasApprovedAuthor('Ada', null), false, 'nor after it');
    assert.equal(cms.admin.hasApprovedAuthor('Ada', 'ada@example.com'), false);
  });

  it('can still be moderated from the link in a notice', async () => {
    const { cms, dataDir } = await siteWith([
      { id: 'waiting', name: 'Ada', email: 'ada@example.com', submitted: OLD, status: 'pending' },
    ]);
    const link = moderationLink(
      { dataDir, baseUrl: 'https://blog.example', now: NOW },
      'waiting',
      'approve',
    );

    await cms.retention.sweep();

    const token = new URL(link).searchParams.get('token') ?? '';
    const response = await cms.app.request('https://blog.example/_geekity/moderate', {
      method: 'POST',
      body: new URLSearchParams({ token, action: 'approve' }),
    });
    assert.equal(response.status, 200);
    assert.equal(cms.admin.getComment('waiting')?.status, 'approved');
    assert.deepEqual(cms.admin.getComment('waiting')?.redacted, ['email', 'addressHash']);
  });

  it('survives a rebuild of the index', async () => {
    const { cms } = await siteWith([
      { id: 'old', name: 'Ada', email: 'ada@example.com', submitted: OLD },
    ]);
    await cms.retention.sweep();

    cms.admin.replaceComments([]);
    rebuildCommentIndexes({
      admin: cms.admin,
      contentDir: cms.config.contentDir,
      dataDir: cms.config.dataDir,
    });

    assert.deepEqual(cms.admin.getComment('old')?.redacted, ['email', 'addressHash']);
    assert.equal(cms.admin.hasApprovedAuthor('Ada', null), false);
  });
});
