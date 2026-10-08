/**
 * Follower counts from tags.pub, which runs one ActivityPub account per
 * hashtag at `/user/<tag>` and publishes how many follow it as its followers
 * collection's `totalItems`. Any tag answers, so zero means nobody follows it.
 * tags.pub publishes no rate limits, so lookups run a few at a time and each
 * count is kept for a day in the plugin's data folder.
 */

import type { PluginDataFolder, PluginFetchInit } from '@geekity/cms/plugin';

/** The file in the plugin's data folder that keeps the counts. */
const CACHE_FILE = 'followers.json';

/** How long a count is kept before tags.pub is asked again. */
const CACHE_MS = 24 * 60 * 60 * 1000;

/** How many lookups run at once. */
const AT_ONCE = 4;

/** How long one lookup may take. */
export const LOOKUP_TIMEOUT_MS = 5_000;

/** A tag's count, or why there is none. */
export type FollowerCount =
  | { readonly known: true; readonly followers: number }
  | { readonly known: false; readonly reason: string };

interface Cached {
  readonly followers: number;
  /** When tags.pub was asked, as an ISO instant. */
  readonly at: string;
}

type Cache = Readonly<Record<string, Cached>>;

export interface FollowerLookup {
  fetch(url: string, init: PluginFetchInit): Promise<Response>;
  /** Such as `https://tags.pub`. */
  readonly server: string;
  readonly userAgent: string;
  readonly data: PluginDataFolder;
  readonly timeoutMs: number;
  /** Ends every lookup still running. */
  readonly signal: AbortSignal;
}

/** The count for each key, from the cache when it is under a day old and from tags.pub otherwise. */
export async function followerCounts(
  keys: readonly string[],
  lookup: FollowerLookup,
): Promise<Map<string, FollowerCount>> {
  const now = Date.now();
  const cache = readCache(lookup.data);
  const counts = new Map<string, FollowerCount>();
  const missing: string[] = [];
  for (const key of keys) {
    const cached = cache[key];
    if (cached !== undefined && isFresh(cached, now)) {
      counts.set(key, { known: true, followers: cached.followers });
    } else {
      missing.push(key);
    }
  }

  const queue = [...missing];
  const worker = async () => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      counts.set(key, await askTagsPub(key, lookup));
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker));

  const learned = missing.flatMap((key) => {
    const count = counts.get(key);
    return count?.known === true ? [[key, count.followers] as const] : [];
  });
  if (learned.length > 0) {
    try {
      await remember(lookup.data, learned, now);
    } catch (error) {
      console.warn(`Tag suggestions could not keep follower counts: ${String(error)}`);
    }
  }
  return counts;
}

async function askTagsPub(key: string, lookup: FollowerLookup): Promise<FollowerCount> {
  const url = `${lookup.server.replace(/\/+$/, '')}/user/${encodeURIComponent(key)}/followers`;
  try {
    const response = await lookup.fetch(url, {
      headers: { accept: 'application/activity+json', 'user-agent': lookup.userAgent },
      signal: AbortSignal.any([lookup.signal, AbortSignal.timeout(lookup.timeoutMs)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return unknown(`tags.pub answered ${String(response.status)}`);
    }
    const body = (await response.json()) as { totalItems?: unknown };
    const total = body.totalItems;
    return typeof total === 'number' && Number.isInteger(total) && total >= 0
      ? { known: true, followers: total }
      : unknown('tags.pub sent no count');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return unknown('tags.pub did not answer in time');
    }
    return unknown('tags.pub could not be reached');
  }
}

function unknown(reason: string): FollowerCount {
  return { known: false, reason };
}

function isFresh(entry: Cached, now: number): boolean {
  const at = Date.parse(entry.at);
  return Number.isFinite(at) && now - at < CACHE_MS && at <= now;
}

function readCache(data: PluginDataFolder): Cache {
  try {
    return parseCache(data.read(CACHE_FILE));
  } catch {
    return {};
  }
}

/** The cache as stored, keeping only well-formed entries; anything else is no cache. */
function parseCache(text: string | undefined): Cache {
  if (text === undefined) return {};
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null) return {};
  const cache: Record<string, Cached> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    const { followers, at } = (entry ?? {}) as Partial<Cached>;
    if (typeof followers === 'number' && typeof at === 'string') cache[key] = { followers, at };
  }
  return cache;
}

/** Add the counts just learned and drop every entry past its day. */
async function remember(
  data: PluginDataFolder,
  learned: readonly (readonly [string, number])[],
  now: number,
): Promise<void> {
  const at = new Date(now).toISOString();
  await data.update(CACHE_FILE, (current) => {
    let kept: Cache;
    try {
      kept = parseCache(current);
    } catch {
      kept = {};
    }
    const next: Record<string, Cached> = Object.fromEntries(
      Object.entries(kept).filter(([, entry]) => isFresh(entry, now)),
    );
    for (const [key, followers] of learned) next[key] = { followers, at };
    return `${JSON.stringify(next, null, 2)}\n`;
  });
}
