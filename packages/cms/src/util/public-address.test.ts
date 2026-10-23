import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isLocalAddress } from './public-address.ts';

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
