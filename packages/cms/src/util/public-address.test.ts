import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isLocalAddress,
  isPrivateHost,
  pinnedLookup,
  publicHost,
  withDeniedAddresses,
} from './public-address.ts';
import type { HostLookup } from './public-address.ts';

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

describe('publicHost with a signal', () => {
  it('gives up on a name that never resolves once the signal fires', async () => {
    const never = (): Promise<readonly string[]> => new Promise(() => {});
    await assert.rejects(publicHost('slow-dns.example', never, AbortSignal.timeout(50)));
  });
});

describe('a name or address only this network can reach', () => {
  it('is private when a local name ends in the root dot', () => {
    for (const host of ['localhost.', 'foo.localhost.', 'printer.local.', 'LOCALHOST.']) {
      assert.equal(isPrivateHost(host), true, host);
    }
    assert.equal(isPrivateHost('example.com.'), false);
  });

  it('is refused at the socket when a local name ends in the root dot', async () => {
    const lookup = pinnedLookup(() => Promise.resolve(['203.0.113.10']));
    const error = await new Promise<Error | null>((done) => {
      lookup('printer.local.', { all: true }, (failed) => {
        done(failed);
      });
    });
    assert.match(error?.message ?? '', /not a public address/);
  });

  const SPECIAL = [
    '::ffff:0:a00:1',
    '::ffff:0:7f00:1',
    '192.88.99.1',
    '100::1',
    '100:0:0:1::1',
    '2001:2::1',
    '2001:10::1',
    '5f00::1',
  ];

  it('is private as written on a special-purpose range', () => {
    for (const address of SPECIAL) {
      const host = address.includes(':') ? `[${address}]` : address;
      assert.equal(isPrivateHost(host), true, address);
    }
  });

  it('is refused when a name resolves to a special-purpose range', async () => {
    for (const address of SPECIAL) {
      assert.equal(
        await publicHost('cdn.example', () => Promise.resolve([address])),
        false,
        address,
      );
    }
  });
});

describe('addresses the operator denies', () => {
  const resolving =
    (addresses: readonly string[]): HostLookup =>
    () =>
      Promise.resolve(addresses);

  it('refuses a listed address, written as a literal or resolved from a name', async () => {
    const lookup = withDeniedAddresses(resolving(['198.51.100.20']), ['198.51.100.20']);
    assert.equal(await publicHost('198.51.100.20', lookup), false);
    assert.equal(await publicHost('self.example', lookup), false);
    assert.equal(await publicHost('[::ffff:198.51.100.20]', lookup), false);
  });

  it('refuses an address inside a listed range, IPv4 or IPv6', async () => {
    const lookup = withDeniedAddresses(resolving([]), ['198.51.100.0/24', '2001:db8:1::/48']);
    assert.equal(await publicHost('198.51.100.77', lookup), false);
    assert.equal(await publicHost('[2001:db8:1::5]', lookup), false);
    assert.equal(await publicHost('[2001:db8:2::5]', lookup), true);
  });

  it('refuses the connection when the checked answer is listed', async () => {
    const lookup = pinnedLookup(
      withDeniedAddresses(resolving(['198.51.100.20']), ['198.51.100.20']),
    );
    const error = await new Promise<Error | null>((done) => {
      lookup('self.example', { all: true }, (failed) => {
        done(failed);
      });
    });
    assert.match(error?.message ?? '', /not a public address/);
  });

  it('leaves every other public address alone, and denies nothing by default', async () => {
    const lookup = withDeniedAddresses(resolving(['203.0.113.10']), ['198.51.100.20']);
    assert.equal(await publicHost('other.example', lookup), true);
    assert.equal(await publicHost('198.51.100.20', resolving([])), true);
  });

  it('rejects an entry that is not an address or a range', () => {
    for (const entry of ['self.example', '198.51.100.0/33', '2001:db8::/129', '1.2.3']) {
      assert.throws(() => withDeniedAddresses(resolving([]), [entry]), /not an IP address/, entry);
    }
  });
});
