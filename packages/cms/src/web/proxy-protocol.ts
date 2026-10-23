/**
 * The PROXY protocol (HAProxy's, versions 1 and 2): the header a layer-4
 * proxy writes ahead of a client's own bytes to say who the client is
 * (TASK-485). Gemini reaches the site through such a proxy, which passes TLS
 * through untouched, so this header is the only place the visitor's address
 * can come from.
 */

import net from 'node:net';

/**
 * What the first bytes of a connection are: the start of a header that has
 * not all come yet, no header at all, a header that cannot be read, or a
 * header `length` bytes long naming the client's `address`. A header without
 * an address is a proxy speaking for itself (v2 LOCAL, v1 UNKNOWN), or a
 * client that is not on TCP.
 */
export type ProxyPreamble =
  | { readonly kind: 'partial' }
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'header'; readonly length: number; readonly address: string | undefined };

const V1_SIGNATURE = Buffer.from('PROXY ');
/** The spec's longest v1 line, CR LF included. */
const V1_MAX_BYTES = 107;
const V2_SIGNATURE = Buffer.from('0d0a0d0a000d0a515549540a', 'hex');
const V2_FIXED_BYTES = 16;
/** Room for the addresses and any TLVs a proxy adds; a proxy that sends more is not one this site trusts. */
const V2_MAX_BYTES = V2_FIXED_BYTES + 2048;

const PARTIAL = { kind: 'partial' } as const;
const NONE = { kind: 'none' } as const;
const INVALID = { kind: 'invalid' } as const;

/**
 * Read `received`, the bytes a connection has sent so far. A TLS record opens
 * with 0x16, which neither signature does, so a client that sends no header is
 * known from its first byte.
 */
export function readProxyPreamble(received: Buffer): ProxyPreamble {
  if (startsLike(received, V1_SIGNATURE)) return readV1(received);
  if (startsLike(received, V2_SIGNATURE)) return readV2(received);
  return NONE;
}

/** Whether `received` and `signature` agree as far as both go. */
function startsLike(received: Buffer, signature: Buffer): boolean {
  const length = Math.min(received.length, signature.length);
  return received.subarray(0, length).equals(signature.subarray(0, length));
}

function readV1(received: Buffer): ProxyPreamble {
  const end = received.indexOf('\r\n');
  if (end < 0) return received.length < V1_MAX_BYTES ? PARTIAL : INVALID;
  if (end + 2 > V1_MAX_BYTES) return INVALID;
  const length = end + 2;
  const [, protocol, source, destination, sourcePort, destinationPort, ...rest] = received
    .subarray(0, end)
    .toString('latin1')
    .split(' ');
  if (protocol === 'UNKNOWN') return { kind: 'header', length, address: undefined };
  const family = protocol === 'TCP4' ? 4 : protocol === 'TCP6' ? 6 : undefined;
  if (
    family === undefined ||
    rest.length > 0 ||
    source === undefined ||
    net.isIP(source) !== family ||
    net.isIP(destination ?? '') !== family ||
    !isPort(sourcePort) ||
    !isPort(destinationPort)
  ) {
    return INVALID;
  }
  return { kind: 'header', length, address: source };
}

function isPort(value: string | undefined): boolean {
  return value !== undefined && /^\d{1,5}$/.test(value) && Number(value) <= 65_535;
}

function readV2(received: Buffer): ProxyPreamble {
  if (received.length < V2_FIXED_BYTES) return PARTIAL;
  const versionAndCommand = received[12] ?? 0;
  const family = (received[13] ?? 0) >> 4;
  const length = V2_FIXED_BYTES + received.readUInt16BE(14);
  if (versionAndCommand >> 4 !== 2 || length > V2_MAX_BYTES) return INVALID;
  const command = versionAndCommand & 0x0f;
  if (command > 1) return INVALID;
  const addressBytes = family === 1 ? 12 : family === 2 ? 36 : 0;
  if (length < V2_FIXED_BYTES + addressBytes) return INVALID;
  if (received.length < length) return PARTIAL;
  if (command === 0 || addressBytes === 0) return { kind: 'header', length, address: undefined };
  const source = received.subarray(V2_FIXED_BYTES);
  return {
    kind: 'header',
    length,
    address: family === 1 ? [...source.subarray(0, 4)].join('.') : ipv6(source.subarray(0, 16)),
  };
}

/** Sixteen bytes as an IPv6 address in its shortest form, as a socket's own address is written. */
function ipv6(bytes: Buffer): string {
  const groups = Array.from({ length: 8 }, (_, index) =>
    bytes.readUInt16BE(index * 2).toString(16),
  );
  return new URL(`http://[${groups.join(':')}]/`).hostname.slice(1, -1);
}
