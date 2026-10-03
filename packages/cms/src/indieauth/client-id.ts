import { isIP } from 'node:net';

/**
 * A client_id the IndieAuth spec allows, as given, or `undefined`.
 *
 * http or https, with no fragment, credentials or dot segments, and a domain
 * name for a host: an IP address only when it is the loopback one a client
 * in development runs on.
 */
export function clientIdentifier(value: string): string | undefined {
  const url = URL.parse(value);
  if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) return undefined;
  if (url.username !== '' || url.password !== '' || value.includes('#')) return undefined;
  const path =
    value
      .slice(url.protocol.length + 2)
      .replace(/^[^/?]*/, '')
      .split('?')[0] ?? '';
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return undefined;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0 && host !== '127.0.0.1' && host !== '::1') return undefined;
  return value;
}

export function sameClient(a: string, b: string): boolean {
  const left = URL.parse(a);
  return left !== null && left.href === URL.parse(b)?.href;
}
