import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { InboxRefusalReason } from '../plugin.ts';
import { createInboxRefusals, REFUSAL_LOG_WINDOW_MS } from './refusals.ts';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const KEY = 'https://remote.example/users/ada#main-key';
const DELETE = {
  '@context': 'https://www.w3.org/ns/activitystreams',
  id: 'https://remote.example/users/ada#delete',
  type: 'Delete',
  actor: 'https://remote.example/users/ada',
  object: 'https://remote.example/users/ada',
};

function inboxPost(headers: Record<string, string> = {}): Request {
  return new Request('https://blog.example/inbox/', {
    method: 'POST',
    headers: { date: NOW.toUTCString(), ...headers },
  });
}

function harness(start = NOW) {
  let now = start;
  const lines: string[] = [];
  const refusals = createInboxRefusals({ now: () => now, warn: (line) => lines.push(line) });
  return {
    lines,
    refusals,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

const invalid: InboxRefusalReason = { type: 'invalidSignature', keyId: new URL(KEY) };

describe('an inbox refusal', () => {
  it('names the inbox, the reason, the keyId and the activity', () => {
    const { lines, refusals } = harness();

    refusals.refused(inboxPost(), DELETE, {
      type: 'keyFetchError',
      keyId: new URL(KEY),
      result: { status: 410 },
    });

    assert.deepEqual(lines, [
      `Refused an inbox POST to /inbox/: key not fetchable (HTTP 410); keyId=${KEY} ` +
        'actor=https://remote.example/users/ada type=Delete id=https://remote.example/users/ada#delete',
    ]);
  });

  it('gives the error when the key fetch failed without a response', () => {
    const { lines, refusals } = harness();

    refusals.refused(inboxPost(), DELETE, {
      type: 'keyFetchError',
      keyId: new URL(KEY),
      result: { error: new TypeError('fetch failed') },
    });

    assert.match(lines[0] ?? '', /: key not fetchable \(TypeError: fetch failed\); keyId=/);
  });

  it('tells a stale Date from a signature that does not match', () => {
    const stale = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toUTCString();
    const { lines, refusals } = harness();

    refusals.refused(inboxPost({ date: stale }), DELETE, invalid);
    refusals.refused(inboxPost(), DELETE, { type: 'invalidSignature', keyId: new URL(`${KEY}2`) });

    assert.match(lines[0] ?? '', new RegExp(`: date out of range \\(Date ${stale}\\); keyId=`));
    assert.match(lines[1] ?? '', /: signature mismatch; keyId=/);
  });

  it('reads a stale RFC 9421 created time when there is no Date header', () => {
    const created = Math.floor(NOW.getTime() / 1000) + 2 * 60 * 60;
    const request = new Request('https://blog.example/inbox/', {
      method: 'POST',
      headers: { 'signature-input': `sig1=("@method" "@target-uri");created=${String(created)}` },
    });
    const { lines, refusals } = harness();

    refusals.refused(request, DELETE, invalid);

    assert.match(lines[0] ?? '', /: date out of range \(created 2026-10-19T14:00:00\.000Z\);/);
  });

  it('says when there is no signature at all', () => {
    const { lines, refusals } = harness();

    refusals.refused(
      inboxPost(),
      { type: 'Follow', actor: { id: 'https://a.example/u' } },
      {
        type: 'noSignature',
      },
    );

    assert.deepEqual(lines, [
      'Refused an inbox POST to /inbox/: no signature; keyId=none actor=https://a.example/u type=Follow id=none',
    ]);
  });
});

describe('a burst of refusals from one keyId', () => {
  it('logs the first, counts the rest, and reports the count once the window is over', () => {
    const { lines, refusals, advance } = harness();

    for (let index = 0; index < 50; index += 1) refusals.refused(inboxPost(), DELETE, invalid);
    assert.equal(lines.length, 1);

    advance(REFUSAL_LOG_WINDOW_MS);
    refusals.refused(inboxPost(), DELETE, invalid);

    assert.equal(lines.length, 3);
    assert.equal(
      lines[1],
      `Suppressed 49 more inbox refusals for keyId=${KEY} after the one logged at ${NOW.toISOString()}`,
    );
    assert.match(lines[2] ?? '', /^Refused an inbox POST/);
  });

  it('does not hold back a different keyId', () => {
    const { lines, refusals } = harness();

    refusals.refused(inboxPost(), DELETE, invalid);
    refusals.refused(inboxPost(), DELETE, { type: 'invalidSignature', keyId: new URL(`${KEY}2`) });

    assert.equal(lines.length, 2);
  });
});
