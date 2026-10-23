import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { proxyV2 } from '../gemini/__testing__/client.ts';
import { readProxyPreamble } from './proxy-protocol.ts';

const CLIENT_HELLO_START = Buffer.from([0x16, 0x03, 0x01, 0x02, 0x00, 0x01]);

describe('readProxyPreamble', () => {
  it('reads a v1 header and the client address it names', () => {
    const header = 'PROXY TCP4 203.0.113.7 192.0.2.1 51000 1965\r\n';
    const bytes = Buffer.concat([Buffer.from(header), CLIENT_HELLO_START]);
    assert.deepEqual(readProxyPreamble(bytes), {
      kind: 'header',
      length: header.length,
      address: '203.0.113.7',
    });
    assert.deepEqual(
      readProxyPreamble(Buffer.from('PROXY TCP6 2001:db8::7 2001:db8::1 51000 1965\r\n')),
      { kind: 'header', length: 47, address: '2001:db8::7' },
    );
  });

  it('reads a v1 UNKNOWN header as one with no address', () => {
    assert.deepEqual(readProxyPreamble(Buffer.from('PROXY UNKNOWN\r\n')), {
      kind: 'header',
      length: 15,
      address: undefined,
    });
  });

  it('reads a v2 header for IPv4 and IPv6, skipping its TLVs', () => {
    const four = proxyV2({
      address: '203.0.113.7',
      tlv: Buffer.from([0x04, 0x00, 0x02, 0x61, 0x62]),
    });
    assert.deepEqual(readProxyPreamble(Buffer.concat([four, CLIENT_HELLO_START])), {
      kind: 'header',
      length: four.length,
      address: '203.0.113.7',
    });
    const six = proxyV2({ address: '2001:db8::7' });
    assert.deepEqual(readProxyPreamble(six), {
      kind: 'header',
      length: six.length,
      address: '2001:db8::7',
    });
  });

  it('reads a v2 LOCAL header, a proxy health check, as one with no address', () => {
    const local = proxyV2({ local: true });
    assert.deepEqual(readProxyPreamble(local), {
      kind: 'header',
      length: local.length,
      address: undefined,
    });
  });

  it('waits on any prefix of a header', () => {
    const v1 = Buffer.from('PROXY TCP4 203.0.113.7 192.0.2.1 51000 1965\r\n');
    const v2 = proxyV2({ address: '203.0.113.7' });
    for (const whole of [v1, v2]) {
      for (let length = 1; length < whole.length; length += 1) {
        assert.deepEqual(
          readProxyPreamble(whole.subarray(0, length)),
          { kind: 'partial' },
          `${String(length)} bytes of ${whole.toString('latin1')}`,
        );
      }
    }
  });

  it('knows a TLS ClientHello from its first byte, however little of it has come', () => {
    for (let length = 1; length <= CLIENT_HELLO_START.length; length += 1) {
      assert.deepEqual(readProxyPreamble(CLIENT_HELLO_START.subarray(0, length)), { kind: 'none' });
    }
    assert.deepEqual(readProxyPreamble(Buffer.from('gemini://example.com/\r\n')), {
      kind: 'none',
    });
  });

  it('refuses a malformed or oversized header', () => {
    const invalid = [
      'PROXY TCP4 not-an-address 192.0.2.1 51000 1965\r\n',
      'PROXY TCP4 2001:db8::7 192.0.2.1 51000 1965\r\n',
      'PROXY SCTP 203.0.113.7 192.0.2.1 51000 1965\r\n',
      'PROXY TCP4 203.0.113.7 192.0.2.1 51000\r\n',
      `PROXY TCP4 203.0.113.7 192.0.2.1 51000 1965${' '.repeat(80)}\r\n`,
    ];
    for (const header of invalid) {
      assert.deepEqual(readProxyPreamble(Buffer.from(header)), { kind: 'invalid' }, header);
    }
    assert.deepEqual(readProxyPreamble(Buffer.from(`PROXY ${'x'.repeat(120)}`)), {
      kind: 'invalid',
    });

    const tooLong = proxyV2({ address: '203.0.113.7', tlv: Buffer.alloc(4096) });
    assert.deepEqual(readProxyPreamble(tooLong.subarray(0, 16)), { kind: 'invalid' });
    const version1 = proxyV2({ address: '203.0.113.7' });
    version1[12] = 0x11;
    assert.deepEqual(readProxyPreamble(version1), { kind: 'invalid' });
    const short = proxyV2({ address: '203.0.113.7' });
    short.writeUInt16BE(4, 14);
    assert.deepEqual(readProxyPreamble(short.subarray(0, 20)), { kind: 'invalid' });
  });
});
