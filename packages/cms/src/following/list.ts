import { statSync } from 'node:fs';

import type { ResolvedConfig } from '../config.ts';
import { readFileIfPresentSync, writeFileAtomically } from '../files/atomic.ts';
import { dataPath, FOLLOWING_LIST } from '../files/data-files.ts';
import { systemNotificationTimers } from '../notifications/digest.ts';
import type { NotificationTimers } from '../notifications/digest.ts';
import { SITE } from '../site/namespace.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { isRecord } from '../util/guards.ts';
import { messageOf } from '../util/errors.ts';
import type { HostLookup } from '../util/public-address.ts';
import { createSerialQueue } from '../util/queue.ts';
import { readWithin, requestPublic } from '../webmention/fetch-public.ts';
import { opmlAlternate, parseOpml } from './opml.ts';
import type { FollowedFeed } from './opml.ts';

export const FOLLOWING_REFRESH_MS = 6 * 60 * 60 * 1000;

const FOLLOWING_EXCHANGE_TIMEOUT_MS = 15_000;

const FOLLOWING_MAX_BYTES = 2_000_000;

const ACCEPT = 'text/x-opml, application/xml;q=0.9, text/xml;q=0.8, text/html;q=0.1';

const HTML_TYPE = /^\s*(?:text\/html|application\/xhtml\+xml)\s*(?:;|$)/i;

export interface FetchedList {
  readonly feeds: readonly FollowedFeed[];
  readonly fetchedAt: string;
  readonly changedAt: string;
  readonly opmlUrl: string;
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface FollowingRecord {
  readonly source: string;
  readonly list?: FetchedList;
  readonly failure?: { readonly at: string; readonly reason: string };
}

const parsedUntilFileChanges = new Map<
  string,
  { readonly stamp: string; readonly record: FollowingRecord | undefined }
>();

export function readFollowing(dataDir: string): FollowingRecord | undefined {
  const file = dataPath(dataDir, FOLLOWING_LIST);
  const stats = statSync(file, { throwIfNoEntry: false });
  if (stats === undefined) return undefined;
  const stamp = `${String(stats.ino)}:${String(stats.mtimeMs)}:${String(stats.size)}`;
  const known = parsedUntilFileChanges.get(file);
  if (known?.stamp === stamp) return known.record;
  const text = readFileIfPresentSync(file);
  let record: FollowingRecord | undefined;
  try {
    record = text === undefined ? undefined : recordOf(JSON.parse(text));
  } catch {
    record = undefined;
  }
  parsedUntilFileChanges.set(file, { stamp, record });
  return record;
}

export function servedFollowing(dataDir: string, source: string): FetchedList | undefined {
  return listFor(readFollowing(dataDir), source);
}

export interface FollowingStatus {
  readonly fetchedAt?: string;
  readonly feedCount?: number;
  readonly failure?: FollowingRecord['failure'];
}

export function followingStatus(dataDir: string, source: string): FollowingStatus | undefined {
  const record = readFollowing(dataDir);
  if (source === '' || record?.source !== source) return undefined;
  return {
    ...(record.list === undefined
      ? {}
      : { fetchedAt: record.list.fetchedAt, feedCount: record.list.feeds.length }),
    ...(record.failure === undefined ? {} : { failure: record.failure }),
  };
}

function listFor(record: FollowingRecord | undefined, source: string): FetchedList | undefined {
  return source !== '' && record?.source === source ? record.list : undefined;
}

type Fetched =
  | {
      readonly kind: 'list';
      readonly feeds: readonly FollowedFeed[];
      readonly opmlUrl: string;
      readonly etag?: string;
      readonly lastModified?: string;
    }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'failed'; readonly reason: string };

type Answer =
  | {
      readonly kind: 'body';
      readonly url: string;
      readonly type: string;
      readonly text: string;
      readonly etag?: string;
      readonly lastModified?: string;
    }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'failed'; readonly reason: string };

async function fetchFollowing(
  source: string,
  held: FetchedList | undefined,
  lookup: HostLookup,
): Promise<Fetched> {
  const signal = AbortSignal.timeout(FOLLOWING_EXCHANGE_TIMEOUT_MS);
  const ask = (url: string): Promise<Answer> =>
    get(url, held?.opmlUrl === url ? held : undefined, lookup, signal);

  let opmlUrl = source;
  let answer = await ask(source);
  if (answer.kind === 'body' && HTML_TYPE.test(answer.type)) {
    const alternate = opmlAlternate(answer.text, answer.url);
    if (alternate === undefined) {
      return { kind: 'failed', reason: 'it answered a web page that names no OPML alternate' };
    }
    opmlUrl = alternate;
    answer = await ask(alternate);
    if (answer.kind === 'body' && HTML_TYPE.test(answer.type)) {
      return { kind: 'failed', reason: `its OPML alternate ${alternate} answered a web page` };
    }
  }
  if (answer.kind !== 'body') return answer;

  const parsed = parseOpml(answer.text);
  if (!parsed.ok) return { kind: 'failed', reason: `it is not OPML: ${parsed.problem}` };
  return {
    kind: 'list',
    feeds: parsed.feeds,
    opmlUrl,
    ...(answer.etag === undefined ? {} : { etag: answer.etag }),
    ...(answer.lastModified === undefined ? {} : { lastModified: answer.lastModified }),
  };
}

async function get(
  url: string,
  validators: FetchedList | undefined,
  lookup: HostLookup,
  signal: AbortSignal,
): Promise<Answer> {
  const headers: Record<string, string> = { accept: ACCEPT };
  if (validators?.etag !== undefined) headers['if-none-match'] = validators.etag;
  if (validators?.lastModified !== undefined) {
    headers['if-modified-since'] = validators.lastModified;
  }
  const answered = await requestPublic(url, { lookup, signal, headers });
  if (!answered.ok) return { kind: 'failed', reason: answered.reason };
  const { response } = answered;
  try {
    if (response.status === 304) {
      await response.body?.cancel();
      return { kind: 'unchanged' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { kind: 'failed', reason: `${url} answered ${String(response.status)}` };
    }
    const read = await readWithin(response, FOLLOWING_MAX_BYTES, 'refuse');
    if (read === undefined) {
      return {
        kind: 'failed',
        reason: `${url} is larger than ${String(FOLLOWING_MAX_BYTES)} bytes`,
      };
    }
    const etag = response.headers.get('etag') ?? undefined;
    const lastModified = response.headers.get('last-modified') ?? undefined;
    return {
      kind: 'body',
      url: answered.url,
      type: response.headers.get('content-type') ?? '',
      text: new TextDecoder().decode(read.body),
      ...(etag === undefined ? {} : { etag }),
      ...(lastModified === undefined ? {} : { lastModified }),
    };
  } catch (thrown) {
    return { kind: 'failed', reason: messageOf(thrown) };
  }
}

function afterFetch(
  record: FollowingRecord | undefined,
  source: string,
  fetched: Fetched,
  now: Date,
): FollowingRecord {
  const at = now.toISOString();
  const held = listFor(record, source);
  switch (fetched.kind) {
    case 'failed':
      return {
        source,
        ...(held === undefined ? {} : { list: held }),
        failure: { at, reason: fetched.reason },
      };
    case 'unchanged':
      return held === undefined
        ? { source, failure: { at, reason: 'it answered 304 to a request that held no list' } }
        : { source, list: { ...held, fetchedAt: at } };
    case 'list': {
      const { kind: _kind, ...fresh } = fetched;
      const same =
        held !== undefined && JSON.stringify(held.feeds) === JSON.stringify(fetched.feeds);
      return { source, list: { ...fresh, fetchedAt: at, changedAt: same ? held.changedAt : at } };
    }
  }
}

export interface CreateFollowingServiceOptions {
  readonly config: Pick<ResolvedConfig, 'dataDir' | 'hostLookup' | 'now'>;
  readonly settings: Pick<SettingsRegistry, 'get'>;
  readonly timers?: NotificationTimers | undefined;
  readonly logger?: { warn(message: string): void } | undefined;
}

export interface FollowingService {
  refresh(): Promise<FollowingRecord | undefined>;
  start(): void;
  settingChanged(): void;
  stop(): void;
  settled(): Promise<void>;
}

export function createFollowingService(options: CreateFollowingServiceOptions): FollowingService {
  const { config, settings } = options;
  const timers = options.timers ?? systemNotificationTimers;
  const logger = options.logger ?? console;
  const fetches = createSerialQueue();
  let handle: unknown;

  async function refreshOnce(): Promise<FollowingRecord | undefined> {
    const source = await settings.get(SITE.following_opml);
    if (source === '') return undefined;
    const record = readFollowing(config.dataDir);
    const fetched = await fetchFollowing(source, listFor(record, source), config.hostLookup);
    const next = afterFetch(record, source, fetched, config.now());
    await writeFileAtomically(
      dataPath(config.dataDir, FOLLOWING_LIST),
      `${JSON.stringify(next, null, 2)}\n`,
    );
    if (next.failure !== undefined) {
      logger.warn(`The subscription list at ${source} was not fetched: ${next.failure.reason}`);
    }
    return next;
  }

  async function due(): Promise<boolean> {
    const source = await settings.get(SITE.following_opml);
    if (source === '') return false;
    const list = servedFollowing(config.dataDir, source);
    return (
      list === undefined ||
      config.now().getTime() - new Date(list.fetchedAt).getTime() >= FOLLOWING_REFRESH_MS
    );
  }

  const service: FollowingService = {
    refresh() {
      return fetches.run(refreshOnce).catch((thrown: unknown) => {
        logger.warn(`The subscription list could not be refreshed: ${messageOf(thrown)}`);
        return undefined;
      });
    },

    start() {
      if (handle !== undefined) return;
      handle = timers.set(() => void service.refresh(), FOLLOWING_REFRESH_MS);
      void fetches
        .run(async () => ((await due()) ? await refreshOnce() : undefined))
        .catch((thrown: unknown) => {
          logger.warn(`The subscription list could not be refreshed: ${messageOf(thrown)}`);
        });
    },

    settingChanged() {
      if (handle !== undefined) void service.refresh();
    },

    stop() {
      if (handle !== undefined) timers.clear(handle);
      handle = undefined;
    },

    async settled() {
      await fetches.settled();
    },
  };
  return service;
}

function recordOf(raw: unknown): FollowingRecord | undefined {
  if (!isRecord(raw) || typeof raw['source'] !== 'string') return undefined;
  const list = listOf(raw['list']);
  const failure = raw['failure'];
  return {
    source: raw['source'],
    ...(list === undefined ? {} : { list }),
    ...(isRecord(failure) &&
    typeof failure['at'] === 'string' &&
    typeof failure['reason'] === 'string'
      ? { failure: { at: failure['at'], reason: failure['reason'] } }
      : {}),
  };
}

function listOf(raw: unknown): FetchedList | undefined {
  if (!isRecord(raw) || !Array.isArray(raw['feeds'])) return undefined;
  const { fetchedAt, changedAt, opmlUrl, etag, lastModified } = raw;
  if (
    typeof fetchedAt !== 'string' ||
    typeof changedAt !== 'string' ||
    typeof opmlUrl !== 'string'
  ) {
    return undefined;
  }
  return {
    feeds: raw['feeds'].filter(isFeed),
    fetchedAt,
    changedAt,
    opmlUrl,
    ...(typeof etag === 'string' ? { etag } : {}),
    ...(typeof lastModified === 'string' ? { lastModified } : {}),
  };
}

function isFeed(raw: unknown): raw is FollowedFeed {
  return (
    isRecord(raw) &&
    typeof raw['text'] === 'string' &&
    typeof raw['xmlUrl'] === 'string' &&
    ['htmlUrl', 'description', 'category'].every(
      (key) => raw[key] === undefined || typeof raw[key] === 'string',
    )
  );
}
