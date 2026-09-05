import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { readNotificationToken, signNotificationToken } from './tokens.ts';

/**
 * The signed links a notification carries.
 *
 * Every assertion here is about what a stranger holding the URL can and cannot
 * do with it, because that is the whole of what the token is for: it stands in
 * for a login on a link somebody opens out of an inbox.
 */

const made: string[] = [];

after(async () => {
  await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A data directory of its own, which is a site with a secret of its own. */
async function dataDir(): Promise<string> {
  const created = await mkdtemp(path.join(tmpdir(), 'geekity-tokens-'));
  made.push(created);
  return created;
}

describe('a notification token', () => {
  it('reads back the claim it was signed with', async () => {
    const dir = await dataDir();

    const token = signNotificationToken(dir, {
      action: 'approve',
      subject: 'a-comment-id',
      lifetimeSeconds: 60,
    });

    assert.deepEqual(readNotificationToken(dir, token), {
      action: 'approve',
      subject: 'a-comment-id',
    });
  });

  it('is URL safe, so it survives being pasted out of a mail reader', async () => {
    const dir = await dataDir();

    const token = signNotificationToken(dir, {
      action: 'approve',
      subject: 'a-comment-id',
      lifetimeSeconds: 60,
    });

    assert.equal(encodeURIComponent(token), token);
  });

  it('is refused once it has expired', async () => {
    const dir = await dataDir();
    const now = new Date('2026-09-04T12:00:00.000Z');

    const token = signNotificationToken(
      dir,
      { action: 'approve', subject: 'a-comment-id', lifetimeSeconds: 60 },
      now,
    );

    assert.notEqual(readNotificationToken(dir, token, new Date(now.getTime() + 59_000)), undefined);
    assert.equal(readNotificationToken(dir, token, new Date(now.getTime() + 61_000)), undefined);
  });

  it('is refused when the payload has been edited', async () => {
    const dir = await dataDir();

    const token = signNotificationToken(dir, {
      action: 'approve',
      subject: 'a-comment-id',
      lifetimeSeconds: 60,
    });
    const [payload, signature] = token.split('.');
    assert.ok(payload !== undefined && signature !== undefined);

    const forged = Buffer.from(
      JSON.stringify({ a: 'delete', s: 'a-comment-id', x: 4102444800 }),
    ).toString('base64url');

    assert.equal(readNotificationToken(dir, `${forged}.${signature}`), undefined);
  });

  it('is refused by a site that did not sign it', async () => {
    const one = await dataDir();
    const other = await dataDir();

    const token = signNotificationToken(one, {
      action: 'approve',
      subject: 'a-comment-id',
      lifetimeSeconds: 60,
    });

    assert.equal(readNotificationToken(other, token), undefined);
  });

  it('is nothing at all when it is not a token', async () => {
    const dir = await dataDir();

    assert.equal(readNotificationToken(dir, ''), undefined);
    assert.equal(readNotificationToken(dir, 'nonsense'), undefined);
    assert.equal(readNotificationToken(dir, 'nonsense.nonsense'), undefined);
  });
});
