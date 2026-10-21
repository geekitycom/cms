import { isRecord, withoutTrailingSlash } from '@geekity/cms/plugin';
import type { PluginFetchInit } from '@geekity/cms/plugin';

import type { UmamiSettings } from './settings.ts';

/**
 * A small client for the Umami API, written against Umami 3 and reading the
 * Umami 2 shapes where they differ. Umami Cloud takes an API key; a
 * self-hosted Umami signs a user in for a token, which the client keeps in
 * memory and replaces once when Umami refuses it. Every call reads the
 * settings afresh and gives up after a timeout below the dashboard's widget
 * limit.
 */

export const CLOUD_API_URL = 'https://api.umami.is/v1';

/** Below the dashboard's 3 second widget limit, sign-in and a retry included. */
export const DEFAULT_TIMEOUT_MS = 2500;

/** Why a call came to nothing. */
export type UmamiFailure =
  /** `missing` names each setting to fill in, such as `the API key`. */
  | { readonly kind: 'unconfigured'; readonly missing: readonly string[] }
  /** Umami refused the API key, the username and password, or a fresh token. */
  | { readonly kind: 'unauthorized' }
  /** The self-hosted user signs in with two-factor authentication, which the client cannot. */
  | { readonly kind: 'two-factor' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable'; readonly status: number }
  /** `what` names the answer, such as `the stats`. */
  | { readonly kind: 'invalid-answer'; readonly what: string }
  | { readonly kind: 'timeout'; readonly seconds: number }
  /** The caller's signal stopped the call. */
  | { readonly kind: 'aborted' }
  | { readonly kind: 'network' };

/** A failed call. Its message is plain words that name Umami's host and never a credential. */
export class UmamiError extends Error {
  readonly failure: UmamiFailure;

  constructor(failure: UmamiFailure, message: string) {
    super(message);
    this.name = 'UmamiError';
    this.failure = failure;
  }
}

export interface UmamiRange {
  readonly start: Date;
  readonly end: Date;
}

export interface UmamiCallOptions {
  readonly signal?: AbortSignal | undefined;
}

export interface UmamiWebsite {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
}

/** Umami's totals for a range. `totaltime` is the summed visit time, as Umami reports it. */
export interface UmamiTotals {
  readonly pageviews: number;
  readonly visitors: number;
  readonly visits: number;
  readonly bounces: number;
  readonly totaltime: number;
}

export interface UmamiStats {
  readonly current: UmamiTotals;
  /** The same length of time just before the range, when Umami sends it. */
  readonly previous: UmamiTotals | undefined;
}

export interface UmamiDayCount {
  /** `YYYY-MM-DD` in the time zone asked for. */
  readonly day: string;
  readonly count: number;
}

export interface UmamiDailyCounts {
  readonly pageviews: readonly UmamiDayCount[];
  /** Visitors per day. */
  readonly sessions: readonly UmamiDayCount[];
}

/** Umami 3's metric types the dashboard reads; Umami 2 called `path` `url`. */
export type UmamiMetricType = 'path' | 'referrer' | 'country' | 'browser' | 'device';

export interface UmamiMetric {
  /** A path, a referring domain, a country code, a browser or a device; empty for none. */
  readonly value: string;
  readonly count: number;
}

/** A metric's value with its views and visitors, from `metrics/expanded`. */
export interface UmamiExpandedMetric {
  readonly value: string;
  readonly pageviews: number;
  readonly visitors: number;
}

export interface UmamiClient {
  /** Whether the settings name everything a call needs. */
  configured(): Promise<boolean>;
  /**
   * The configured website. Umami refuses a website the account cannot see
   * as it refuses bad credentials, so a refusal is followed by a look at the
   * account's websites: `not-found` when that answers, `unauthorized` when not.
   */
  website(options?: UmamiCallOptions): Promise<UmamiWebsite>;
  stats(range: UmamiRange, options?: UmamiCallOptions): Promise<UmamiStats>;
  pageviews(
    range: UmamiRange,
    options: UmamiCallOptions & { readonly timezone: string },
  ): Promise<UmamiDailyCounts>;
  metrics(
    type: UmamiMetricType,
    range: UmamiRange,
    options?: UmamiCallOptions & { readonly limit?: number },
  ): Promise<readonly UmamiMetric[]>;
  /**
   * The top values of a metric with their views and visitors, most visitors
   * first. Umami 3's `metrics` counts visitors for every type, the path too;
   * this is where it counts views.
   */
  expandedMetrics(
    type: UmamiMetricType,
    range: UmamiRange,
    options?: UmamiCallOptions & { readonly limit?: number },
  ): Promise<readonly UmamiExpandedMetric[]>;
  /** Visitors on the site in the last few minutes. */
  active(options?: UmamiCallOptions): Promise<number>;
}

export interface UmamiClientOptions {
  /** `host.fetch`, which keeps the credentials on Umami's origin. */
  fetch(url: string, init: PluginFetchInit): Promise<Response>;
  settings(): Promise<UmamiSettings>;
  timeoutMs?: number | undefined;
}

export type Credentials =
  | { readonly kind: 'key'; readonly apiKey: string }
  | { readonly kind: 'login'; readonly username: string; readonly password: string };

export interface Connection {
  /** Such as `https://api.umami.is/v1`, without a trailing slash. */
  readonly base: string;
  readonly host: string;
  readonly websiteId: string;
  readonly credentials: Credentials;
}

export function connectionFrom(
  settings: UmamiSettings,
): Connection | { readonly missing: string[] } {
  const missing: string[] = [];
  const websiteId = settings.website_id.trim();
  if (websiteId === '') missing.push('the website ID');
  const cloud = settings.api_mode === 'cloud';
  let base = settings.api_url.trim();
  if (base === '') {
    if (cloud) base = CLOUD_API_URL;
    else if (settings.umami_url !== '') base = `${withoutTrailingSlash(settings.umami_url)}/api`;
    else missing.push('the Umami URL');
  }
  let credentials: Credentials | undefined;
  if (cloud) {
    if (settings.api_key === undefined || settings.api_key === '') missing.push('the API key');
    else credentials = { kind: 'key', apiKey: settings.api_key };
  } else {
    const username = settings.username.trim();
    if (username === '') missing.push('the username');
    if (settings.password === undefined || settings.password === '') missing.push('the password');
    else credentials = { kind: 'login', username, password: settings.password };
  }
  if (missing.length > 0 || credentials === undefined) return { missing };
  base = withoutTrailingSlash(base);
  return { base, host: new URL(base).host, websiteId, credentials };
}

function describe(failure: UmamiFailure, connection: Connection | undefined): string {
  const host = connection?.host ?? 'Umami';
  switch (failure.kind) {
    case 'unconfigured':
      return `Set ${listed(failure.missing)} on Plugins > Umami to read the stats.`;
    case 'unauthorized':
      return connection?.credentials.kind === 'login'
        ? `${host} refused the username and password. Check them on Plugins > Umami.`
        : `${host} refused the API key. Check it on Plugins > Umami.`;
    case 'two-factor':
      return `The Umami user signs in with two-factor authentication, which the plugin cannot do. Name a user without it on Plugins > Umami.`;
    case 'not-found':
      return `${host} answered, but has no website with the ID ${connection?.websiteId ?? ''} that this account can see.`;
    case 'unavailable':
      return `${host} could not answer (status ${String(failure.status)}). Try again in a while.`;
    case 'invalid-answer':
      return `${host} answered ${failure.what} in a form the plugin does not read. Check the API URL on Plugins > Umami.`;
    case 'timeout':
      return `${host} did not answer within ${String(failure.seconds)} seconds.`;
    case 'aborted':
      return 'The request to Umami was stopped before it finished.';
    case 'network':
      return `${host} could not be reached. Check the Umami URL and the API URL on Plugins > Umami.`;
  }
}

export function listed(items: readonly string[]): string {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

interface Session {
  /** The connection's base and credentials, so a change of settings signs in afresh. */
  readonly key: string;
  readonly token: Promise<string>;
}

export function umamiClient(options: UmamiClientOptions): UmamiClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let session: Session | undefined;

  async function connected(): Promise<Connection> {
    const connection = connectionFrom(await options.settings());
    if ('missing' in connection) {
      const failure = { kind: 'unconfigured', missing: connection.missing } as const;
      throw new UmamiError(failure, describe(failure, undefined));
    }
    return connection;
  }

  async function signInFor(
    connection: Connection,
    login: Credentials & { kind: 'login' },
    send: Send,
  ) {
    const response = await send(`${connection.base}/auth/login`, {
      method: 'POST',
      json: { username: login.username, password: login.password },
      headers: { accept: 'application/json' },
    });
    if (response.status === 401 || response.status === 403)
      throw fail({ kind: 'unauthorized' }, connection);
    if (!response.ok) throw fail({ kind: 'unavailable', status: response.status }, connection);
    const body = await jsonOf(response, connection, 'the sign-in');
    if (isRecord(body) && body['requiresTwoFactor'] === true)
      throw fail({ kind: 'two-factor' }, connection);
    const token = isRecord(body) ? body['token'] : undefined;
    if (typeof token !== 'string' || token === '') {
      throw fail({ kind: 'invalid-answer', what: 'the sign-in' }, connection);
    }
    return token;
  }

  function tokenFor(
    connection: Connection,
    login: Credentials & { kind: 'login' },
    send: Send,
  ): Session {
    const key = JSON.stringify([connection.base, login.username, login.password]);
    if (session?.key === key) return session;
    const started: Session = { key, token: signInFor(connection, login, send) };
    started.token.catch(() => {
      if (session === started) session = undefined;
    });
    session = started;
    return started;
  }

  async function authorization(connection: Connection, send: Send, used?: Session) {
    const { credentials } = connection;
    if (credentials.kind === 'key') {
      return {
        session: undefined,
        headers: {
          authorization: `Bearer ${credentials.apiKey}`,
          'x-umami-api-key': credentials.apiKey,
        },
      };
    }
    if (used !== undefined && session === used) session = undefined;
    const current = tokenFor(connection, credentials, send);
    return { session: current, headers: { authorization: `Bearer ${await current.token}` } };
  }

  /** GET a path under the website, signing in again once if Umami refuses the token. */
  async function get(
    connection: Connection,
    path: string,
    query: Readonly<Record<string, string>>,
    call: UmamiCallOptions,
  ): Promise<unknown> {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any(
      call.signal === undefined ? [deadline] : [deadline, call.signal],
    );
    const send: Send = (url, init) => options.fetch(url, { ...init, signal });
    const search = new URLSearchParams(query).toString();
    const url = `${connection.base}${path}${search === '' ? '' : `?${search}`}`;
    try {
      let auth = await authorization(connection, send);
      let response = await send(url, { headers: { accept: 'application/json', ...auth.headers } });
      if (response.status === 401 && auth.session !== undefined) {
        auth = await authorization(connection, send, auth.session);
        response = await send(url, { headers: { accept: 'application/json', ...auth.headers } });
      }
      if (response.status === 401 || response.status === 403)
        throw fail({ kind: 'unauthorized' }, connection);
      if (response.status === 404) throw fail({ kind: 'not-found' }, connection);
      if (!response.ok) throw fail({ kind: 'unavailable', status: response.status }, connection);
      return await response.json();
    } catch (error) {
      if (error instanceof UmamiError) throw error;
      if (call.signal?.aborted === true) throw fail({ kind: 'aborted' }, connection);
      if (deadline.aborted) throw fail({ kind: 'timeout', seconds: timeoutMs / 1000 }, connection);
      if (error instanceof SyntaxError)
        throw fail({ kind: 'invalid-answer', what: 'a request' }, connection);
      throw fail({ kind: 'network' }, connection);
    }
  }

  async function read<Value>(
    path: (websiteId: string) => string,
    query: Readonly<Record<string, string>>,
    call: UmamiCallOptions,
    what: string,
    parse: (body: unknown) => Value | undefined,
  ): Promise<Value> {
    const connection = await connected();
    const value = parse(
      await get(connection, path(encodeURIComponent(connection.websiteId)), query, call),
    );
    if (value === undefined) throw fail({ kind: 'invalid-answer', what }, connection);
    return value;
  }

  const between = (range: UmamiRange) => ({
    startAt: String(range.start.getTime()),
    endAt: String(range.end.getTime()),
  });

  return {
    async configured() {
      return !('missing' in connectionFrom(await options.settings()));
    },
    async website(call = {}) {
      const connection = await connected();
      let body: unknown;
      try {
        body = await get(
          connection,
          `/websites/${encodeURIComponent(connection.websiteId)}`,
          {},
          call,
        );
      } catch (error) {
        if (!(error instanceof UmamiError) || error.failure.kind !== 'unauthorized') throw error;
        await get(connection, '/websites', { pageSize: '1' }, call);
        throw fail({ kind: 'not-found' }, connection);
      }
      if (body === null) throw fail({ kind: 'not-found' }, connection);
      const website = parseWebsite(body);
      if (website === undefined)
        throw fail({ kind: 'invalid-answer', what: 'the website' }, connection);
      return website;
    },
    stats: (range, call = {}) =>
      read((id) => `/websites/${id}/stats`, between(range), call, 'the stats', parseStats),
    pageviews: (range, call) =>
      read(
        (id) => `/websites/${id}/pageviews`,
        { ...between(range), unit: 'day', timezone: call.timezone },
        call,
        'the views per day',
        parseDailyCounts,
      ),
    metrics: (type, range, call = {}) =>
      read(
        (id) => `/websites/${id}/metrics`,
        {
          ...between(range),
          type,
          ...(call.limit === undefined ? {} : { limit: String(call.limit) }),
        },
        call,
        `the ${type} metrics`,
        parseMetrics,
      ),
    expandedMetrics: (type, range, call = {}) =>
      read(
        (id) => `/websites/${id}/metrics/expanded`,
        {
          ...between(range),
          type,
          ...(call.limit === undefined ? {} : { limit: String(call.limit) }),
        },
        call,
        `the ${type} views and visitors`,
        parseExpandedMetrics,
      ),
    active: (call = {}) =>
      read((id) => `/websites/${id}/active`, {}, call, 'the visitors right now', parseActive),
  };
}

type Send = (url: string, init: PluginFetchInit) => Promise<Response>;

function fail(failure: UmamiFailure, connection: Connection): UmamiError {
  return new UmamiError(failure, describe(failure, connection));
}

async function jsonOf(response: Response, connection: Connection, what: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw fail({ kind: 'invalid-answer', what }, connection);
    throw error;
  }
}

/** A count, which Umami sends as a number or, for a big integer column, a string. */
function count(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) return Number(value);
  return undefined;
}

const TOTALS = ['pageviews', 'visitors', 'visits', 'bounces', 'totaltime'] as const;

function totals(
  record: Record<string, unknown>,
  pick: (value: unknown) => unknown,
): UmamiTotals | undefined {
  const entries = TOTALS.map((key) => [key, count(pick(record[key]))] as const);
  if (entries.some(([, value]) => value === undefined)) return undefined;
  return Object.fromEntries(entries) as unknown as UmamiTotals;
}

/** Umami 3: numbers and a `comparison` of the same; Umami 2: `{ value, prev }` for each. */
function parseStats(body: unknown): UmamiStats | undefined {
  const record = Array.isArray(body) ? (body[0] as unknown) : body;
  if (!isRecord(record)) return undefined;
  if (isRecord(record['pageviews'])) {
    const current = totals(record, (entry) => (isRecord(entry) ? entry['value'] : undefined));
    if (current === undefined) return undefined;
    return {
      current,
      previous: totals(record, (entry) => (isRecord(entry) ? entry['prev'] : undefined)),
    };
  }
  const current = totals(record, (entry) => entry);
  if (current === undefined) return undefined;
  const comparison = record['comparison'];
  return {
    current,
    previous: isRecord(comparison) ? totals(comparison, (entry) => entry) : undefined,
  };
}

function parseSeries(body: unknown): UmamiDayCount[] | undefined {
  if (!Array.isArray(body)) return undefined;
  const days: UmamiDayCount[] = [];
  for (const entry of body) {
    const x: unknown = isRecord(entry) ? entry['x'] : undefined;
    const y = isRecord(entry) ? count(entry['y']) : undefined;
    const day = typeof x === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(x)?.[0] : undefined;
    if (day === undefined || y === undefined) return undefined;
    days.push({ day, count: y });
  }
  return days;
}

function parseDailyCounts(body: unknown): UmamiDailyCounts | undefined {
  if (!isRecord(body)) return undefined;
  const pageviews = parseSeries(body['pageviews']);
  const sessions = parseSeries(body['sessions']);
  return pageviews === undefined || sessions === undefined ? undefined : { pageviews, sessions };
}

function parseMetrics(body: unknown): UmamiMetric[] | undefined {
  if (!Array.isArray(body)) return undefined;
  const metrics: UmamiMetric[] = [];
  for (const entry of body) {
    const x: unknown = isRecord(entry) ? entry['x'] : undefined;
    const y = isRecord(entry) ? count(entry['y']) : undefined;
    if ((typeof x !== 'string' && x !== null) || y === undefined) return undefined;
    metrics.push({ value: x ?? '', count: y });
  }
  return metrics;
}

function parseExpandedMetrics(body: unknown): UmamiExpandedMetric[] | undefined {
  if (!Array.isArray(body)) return undefined;
  const metrics: UmamiExpandedMetric[] = [];
  for (const entry of body) {
    if (!isRecord(entry)) return undefined;
    const { name } = entry;
    const pageviews = count(entry['pageviews']);
    const visitors = count(entry['visitors']);
    if (typeof name !== 'string' || pageviews === undefined || visitors === undefined) {
      return undefined;
    }
    metrics.push({ value: name, pageviews, visitors });
  }
  return metrics;
}

/** Umami 3: `{ visitors }`; Umami 2: `{ x }`, or a list of one. */
function parseActive(body: unknown): number | undefined {
  const record = Array.isArray(body) ? (body[0] as unknown) : body;
  if (!isRecord(record)) return undefined;
  return count(record['visitors'] ?? record['x']);
}

function parseWebsite(body: unknown): UmamiWebsite | undefined {
  if (!isRecord(body)) return undefined;
  const { id, name, domain } = body;
  if (typeof id !== 'string') return undefined;
  return {
    id,
    name: typeof name === 'string' ? name : '',
    domain: typeof domain === 'string' ? domain : '',
  };
}
