import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * tags.pub on loopback, so the tests reach no real server (TASK-279). It
 * answers as tags.pub did on 2026-10-08: `/user/<tag>/followers` is an
 * `OrderedCollection` with `totalItems` for any tag in `[a-z0-9]`, zero for one
 * nobody follows, and any other spelling is a 500 problem document, because
 * tags.pub folds the tag and refuses the mismatch.
 */

export interface Lookup {
  path: string;
  headers: IncomingHttpHeaders;
}

export interface FakeTagsPub {
  /** Such as `http://127.0.0.1:40123`. */
  url: string;
  lookups: Lookup[];
  /** The most lookups that were in flight at once. */
  mostAtOnce: number;
  /** Followers by tag; a tag not here has none. */
  followers: Map<string, number>;
  /** How long each answer waits. */
  delayMs: number;
  /** A status to answer every lookup with instead, such as 503. */
  failWith: number | undefined;
  reset(): void;
  close(): Promise<void>;
}

const FOLLOWERS = /^\/user\/([^/]+)\/followers$/;

export async function fakeTagsPub(): Promise<FakeTagsPub> {
  let inFlight = 0;
  const fake: FakeTagsPub = {
    url: '',
    lookups: [],
    mostAtOnce: 0,
    followers: new Map(),
    delayMs: 0,
    failWith: undefined,
    reset() {
      fake.lookups.length = 0;
      fake.mostAtOnce = 0;
      fake.followers.clear();
      fake.delayMs = 0;
      fake.failWith = undefined;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };

  const server: Server = createServer((request, response) => {
    const path = request.url ?? '';
    fake.lookups.push({ path, headers: request.headers });
    inFlight += 1;
    fake.mostAtOnce = Math.max(fake.mostAtOnce, inFlight);
    setTimeout(() => {
      inFlight -= 1;
      if (response.destroyed) return;
      const tag = decodeURIComponent(FOLLOWERS.exec(path)?.[1] ?? '');
      if (fake.failWith !== undefined) {
        response.writeHead(fake.failWith, { 'content-type': 'text/plain' });
        response.end('unavailable');
        return;
      }
      if (!/^[a-z0-9]+$/.test(tag)) {
        response.writeHead(500, { 'content-type': 'application/problem+json; charset=utf-8' });
        response.end(
          JSON.stringify({
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
            detail: `Mismatched context: ${tag} !== ${tag.toLowerCase()}`,
          }),
        );
        return;
      }
      const id = `${fake.url}/user/${tag}`;
      response.writeHead(200, { 'content-type': 'application/activity+json' });
      response.end(
        JSON.stringify({
          '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/fep/5711'],
          id: `${id}/followers`,
          type: 'OrderedCollection',
          followersOf: id,
          attributedTo: id,
          first: `${id}/followers/1`,
          last: `${id}/followers/1`,
          to: 'as:Public',
          totalItems: fake.followers.get(tag) ?? 0,
        }),
      );
    }, fake.delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return fake;
}
