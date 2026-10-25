import { isRecord, withoutTrailingSlash } from '@geekity/cms/plugin';
import type { PluginFetchInit } from '@geekity/cms/plugin';

import type { UmamiSettings } from './settings.ts';

export const CLOUD_API_URL = 'https://api.umami.is/v1';

const DEFAULT_TIMEOUT_MS = 2500;

export type UmamiFailure =
  | { readonly kind: 'unconfigured'; readonly missing: readonly string[] }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'two-factor' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable'; readonly status: number }
  | { readonly kind: 'invalid-answer'; readonly what: string }
  | { readonly kind: 'timeout'; readonly seconds: number }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'network' };

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
  readonly previous: UmamiTotals | undefined;
}

export interface UmamiDayCount {
  readonly day: string;
  readonly count: number;
}

export interface UmamiDailyCounts {
  readonly pageviews: readonly UmamiDayCount[];
  readonly visitors: readonly UmamiDayCount[];
}

export type UmamiMetricType = 'path' | 'referrer' | 'country' | 'browser' | 'device';

export interface UmamiMetric {
  readonly value: string;
  readonly count: number;
}

export interface UmamiExpandedMetric {
  readonly value: string;
  readonly pageviews: number;
  readonly visitors: number;
}

export interface UmamiClient {
  configured(): Promise<boolean>;
  /**
   * The configured website. Umami refuses a website the account cannot see
   * as it refuses bad credentials, so a refusal is followed by a look at the
   * account's websites: `not-found` when that answers, `unauthorized` when not.
   */
  website(options?: UmamiCallOptions): Promise<UmamiWebsite>;
  stats(
    range: UmamiRange,
    options?: UmamiCallOptions & { readonly path?: string },
  ): Promise<UmamiStats>;
  pageviews(
    range: UmamiRange,
    options: UmamiCallOptions & { readonly timezone: string },
  ): Promise<UmamiDailyCounts>;
  metrics(
    type: UmamiMetricType,
    range: UmamiRange,
    options?: UmamiCallOptions & { readonly limit?: number; readonly path?: string },
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
  active(options?: UmamiCallOptions): Promise<number>;
}

export interface UmamiClientOptions {
  fetch(url: string, init: PluginFetchInit): Promise<Response>;
  settings(): Promise<UmamiSettings>;
  timeoutMs?: number | undefined;
}

export type Credentials =
  | { readonly kind: 'key'; readonly apiKey: string }
  | { readonly kind: 'login'; readonly username: string; readonly password: string };

export interface Connection {
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

  async function get(
    connection: Connection,
    path: string,
    query: Readonly<Record<string, string>>,
    call: UmamiCallOptions,
  ): Promise<unknown> {
    const signal = call.signal ?? AbortSignal.timeout(timeoutMs);
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
      if (signal.aborted) {
        throw fail(
          call.signal === undefined
            ? { kind: 'timeout', seconds: timeoutMs / 1000 }
            : { kind: 'aborted' },
          connection,
        );
      }
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
      read(
        (id) => `/websites/${id}/stats`,
        { ...between(range), ...pathFilter(call.path) },
        call,
        'the stats',
        parseStats,
      ),
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
        { ...metricQuery(type, range, call.limit), ...pathFilter(call.path) },
        call,
        `the ${type} metrics`,
        parseMetrics,
      ),
    expandedMetrics: (type, range, call = {}) =>
      read(
        (id) => `/websites/${id}/metrics/expanded`,
        metricQuery(type, range, call.limit),
        call,
        `the ${type} views and visitors`,
        parseExpandedMetrics,
      ),
    active: (call = {}) =>
      read((id) => `/websites/${id}/active`, {}, call, 'the visitors right now', parseActive),
  };
}

type Send = (url: string, init: PluginFetchInit) => Promise<Response>;

function between(range: UmamiRange): Record<string, string> {
  return { startAt: String(range.start.getTime()), endAt: String(range.end.getTime()) };
}

/** Umami 3's filter to the views of one path. */
function pathFilter(path: string | undefined): Record<string, string> {
  return path === undefined ? {} : { path: `eq.${path}` };
}

function metricQuery(
  type: UmamiMetricType,
  range: UmamiRange,
  limit: number | undefined,
): Record<string, string> {
  return { ...between(range), type, ...(limit === undefined ? {} : { limit: String(limit) }) };
}

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

function totals(
  record: Record<string, unknown>,
  pick: (value: unknown) => unknown,
): UmamiTotals | undefined {
  const pageviews = count(pick(record['pageviews']));
  const visitors = count(pick(record['visitors']));
  const visits = count(pick(record['visits']));
  const bounces = count(pick(record['bounces']));
  const totaltime = count(pick(record['totaltime']));
  if (
    pageviews === undefined ||
    visitors === undefined ||
    visits === undefined ||
    bounces === undefined ||
    totaltime === undefined
  ) {
    return undefined;
  }
  return { pageviews, visitors, visits, bounces, totaltime };
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
  const visitors = parseSeries(body['sessions']);
  return pageviews === undefined || visitors === undefined ? undefined : { pageviews, visitors };
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
