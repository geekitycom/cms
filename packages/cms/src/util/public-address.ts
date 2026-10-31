import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Whether a host is somebody else's, before this site fetches from it.
 *
 * A URL a stranger hands the site (a webmention source) or an author copies
 * into a post (a reply target) could name a machine on this network, and
 * fetching it would make the site a way of reaching machines nobody outside
 * can reach. Two checks, one strict and one cheap. {@link isPrivateHost}
 * reads the spelling alone and needs no network, which is what a synchronous
 * answer to a webmention can afford. {@link publicHost} also resolves a name
 * and refuses it when any address it resolves to is private.
 *
 * Neither pins the address the connection then goes to, so a name that
 * resolves differently a moment later (DNS rebinding) is not stopped.
 */

/** The addresses a host name resolves to. Injected so a test resolves nothing. */
export type HostLookup = (hostname: string) => Promise<readonly string[]>;

/** Resolve a name through the system resolver, every address it has. */
export const systemHostLookup: HostLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((found) => found.address);

type Range = readonly [network: string, prefix: number, type: 'ipv4' | 'ipv6'];

const LOCAL: readonly Range[] = [
  ['10.0.0.0', 8, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['::1', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
];

/**
 * Reserved, plus the IPv6 prefixes that carry an IPv4 address inside them
 * (IPv4-compatible, NAT64, 6to4, Teredo): a gateway or relay turns those
 * into a connection to the embedded address, which may be a private one.
 */
const RESERVED: readonly Range[] = [
  ['0.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 96, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'],
  ['64:ff9b:1::', 48, 'ipv6'],
  ['2001::', 32, 'ipv6'],
  ['2002::', 16, 'ipv6'],
  ['fec0::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
];

function blockList(ranges: readonly Range[]): BlockList {
  const list = new BlockList();
  for (const [network, prefix, type] of ranges) list.addSubnet(network, prefix, type);
  return list;
}

const LOCAL_RANGES = blockList(LOCAL);
const PRIVATE_RANGES = blockList([...LOCAL, ...RESERVED]);

function onRanges(ranges: BlockList, address: string): boolean | undefined {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped !== undefined) return onRanges(ranges, mapped);

  const version = isIP(address);
  if (version === 0) return undefined;
  return ranges.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

/** Whether an IP address is on a loopback, private, link-local or reserved range. */
function isPrivateAddress(address: string): boolean {
  return onRanges(PRIVATE_RANGES, address) ?? true;
}

export function isLocalAddress(address: string): boolean {
  return onRanges(LOCAL_RANGES, address) ?? false;
}

/**
 * Whether a hostname, as written, is one only this network can see: a
 * `localhost` or `.local` name, or an IP literal on a private range. A name
 * that merely resolves to one is {@link publicHost}'s to catch.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  return isIP(host) !== 0 && isPrivateAddress(host);
}

/**
 * Whether a host is on the public internet: not private as written, and every
 * address it resolves to public. A name that does not resolve is not.
 */
export async function publicHost(hostname: string, lookup: HostLookup): Promise<boolean> {
  if (isPrivateHost(hostname)) return false;

  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return true;

  let addresses: readonly string[];
  try {
    addresses = await lookup(host);
  } catch {
    return false;
  }
  return addresses.length > 0 && !addresses.some(isPrivateAddress);
}
