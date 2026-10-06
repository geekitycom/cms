import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

let remoteHostsMissing = false;

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
