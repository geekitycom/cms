import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isLocalAddress, isPrivateHost, pinnedLookup, publicHost } from './public-address.ts';

describe('isLocalAddress', () => {
  it('is true for loopback, private and link-local peers, written plainly or IPv4-mapped', () => {
    for (const address of [
      '127.0.0.1',
      '127.8.9.10',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.20',
      '169.254.1.1',
      '::1',
      'fd00::1',
      'fc00::5',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:172.17.0.1',
      '::FFFF:192.168.0.1',
    ]) {
      assert.equal(isLocalAddress(address), true, address);
    }
  });

  it('is false for any other peer, a reserved range, or no address at all', () => {
    for (const address of [
      '203.0.113.7',
      '8.8.8.8',
      '172.32.0.1',
      '100.64.0.1',
      '2001:db8::7',
      '::ffff:203.0.113.7',
      '::',
      'localhost',
      '',
    ]) {
      assert.equal(isLocalAddress(address), false, address);
    }
  });
});

describe('an IPv6 prefix that carries an IPv4 address', () => {
  const EMBEDDED = [
    '::7f00:1',
    '::a00:1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::a00:1',
    '2002:7f00:1::',
    '2002:a00:1::1',
    '2001:0:1:2::7f00:1',
    'fec0::1',
  ];

  it('is private as written', () => {
    for (const address of EMBEDDED) {
      assert.equal(isPrivateHost(`[${address}]`), true, address);
    }
  });

  it('is refused when a name resolves to it', async () => {
    for (const address of EMBEDDED) {
      const resolved = await publicHost('cdn.example', () => Promise.resolve([address]));
      assert.equal(resolved, false, address);
    }
    assert.equal(await publicHost('cdn.example', () => Promise.resolve(['2001:db8::7'])), true);
  });
});

describe('the resolver a public fetch hands its socket', () => {
  function resolve(
    addresses: readonly string[] | Error,
    all: boolean,
  ): Promise<{ error: Error | null; answer: unknown; family: number | undefined }> {
    const lookup = pinnedLookup(() =>
      addresses instanceof Error ? Promise.reject(addresses) : Promise.resolve(addresses),
    );
    return new Promise((done) => {
      lookup('cdn.example', { all }, (error, answer, family) => {
        done({ error, answer, family });
      });
    });
  }

  it('hands the socket every address the checked lookup answered', async () => {
    const found = await resolve(['203.0.113.10', '2001:db8::7'], true);
    assert.equal(found.error, null);
    assert.deepEqual(found.answer, [
      { address: '203.0.113.10', family: 4 },
      { address: '2001:db8::7', family: 6 },
    ]);

    const one = await resolve(['203.0.113.10'], false);
    assert.equal(one.error, null);
    assert.equal(one.answer, '203.0.113.10');
    assert.equal(one.family, 4);
  });

  it('refuses the connection when any answer is private, or there is none', async () => {
    for (const answers of [['127.0.0.1'], ['203.0.113.10', '10.0.0.5'], ['::7f00:1'], []]) {
      const refused = await resolve(answers, true);
      assert.match(refused.error?.message ?? '', /not a public address/, answers.join(','));
    }
  });

  it('passes a failed lookup on as the socket error', async () => {
    const failed = await resolve(new Error('getaddrinfo ENOTFOUND cdn.example'), true);
    assert.match(failed.error?.message ?? '', /ENOTFOUND/);
  });
});
