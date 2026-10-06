import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

/**
 * Preloaded into every test process: a fetch or DNS lookup of a host that is
 * not this machine is refused, so a test that forgets to stub its network
 * fails instead of reaching a real server.
 */

let remoteHostsMissing = false;

/**
 * From now on, answer every remote host the way the real network answers a
 * `.example` name, as one that does not exist, rather than failing the test.
 * For a test file whose posts link to hosts it has no reason to stub.
 */
export function remoteHostsDoNotExist(): void {
  remoteHostsMissing = true;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}

function refuse(host: string): Error {
  if (remoteHostsMissing) {
    return Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  }
  const error = new Error(`A test reached ${host} without stubbing it; tests stay off the network`);
  // The code under test often catches a failed request and only logs it, so
  // the refusal is also thrown where nothing can catch it and the test fails.
  process.nextTick(() => {
    throw error;
  });
  return error;
}

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (isLoopback(url.hostname)) return realFetch(input, init);
  return Promise.reject(new TypeError('fetch failed', { cause: refuse(url.hostname) }));
};

const realLookup = dns.lookup;
dns.lookup = ((hostname: string, ...rest: unknown[]) => {
  if (isLoopback(hostname)) {
    Reflect.apply(realLookup, dns, [hostname, ...rest]);
    return;
  }
  const callback = rest.at(-1) as (error: Error) => void;
  const error = refuse(hostname);
  process.nextTick(() => callback(error));
}) as typeof dns.lookup;

const realPromisesLookup = dns.promises.lookup;
dns.promises.lookup = ((hostname: string, options?: dns.LookupOptions) =>
  isLoopback(hostname)
    ? realPromisesLookup(hostname, options ?? {})
    : Promise.reject(refuse(hostname))) as typeof dns.promises.lookup;

syncBuiltinESMExports();
