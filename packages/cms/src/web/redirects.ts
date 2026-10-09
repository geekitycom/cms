import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { MiddlewareHandler } from 'hono';

import type { GeekityEnv } from '../env.ts';

/**
 * The site's own redirects, relative to the content directory (TASK-128).
 * Content rather than data, like `site.json`: a site's old URLs are part of the
 * site, and belong in the same git history as the posts they lead to
 * (decision-9).
 */
export const REDIRECTS_FILE = '_data/redirects.json';

const REDIRECTS_DIR = '_data/redirects';

/** What `X-Redirect-By` says on every redirect the CMS sends. */
export const REDIRECT_BY = 'Geekity CMS';

const STATUSES = [301, 302, 307, 308] as const;

/** A redirect's status: permanent (301, 308) or temporary (302, 307). */
export type RedirectStatus = (typeof STATUSES)[number];

/** One declared redirect, parsed and checked. */
export interface Redirect {
  /** The source as the file spells it, for messages. */
  from: string;
  /** The `Location` to send, already URL-safe. */
  location: string;
  status: RedirectStatus;
  /**
   * Whether the request's query goes on to the target: true for a source
   * without a query of its own whose target names none either, so
   * `/old/?utm=x` lands on `/new/?utm=x`.
   */
  passQuery: boolean;
}

/**
 * Every declared redirect, keyed the way a request is looked up: by decoded
 * path for a source without a query, and by decoded path plus its sorted query
 * for one with.
 */
export interface RedirectTable {
  readonly paths: ReadonlyMap<string, Redirect>;
  readonly queries: ReadonlyMap<string, Redirect>;
}

const EMPTY: RedirectTable = { paths: new Map(), queries: new Map() };

/** Anything resolved against this is a site path; nothing is ever sent to it. */
const SITE = 'http://site.invalid';

/** One redirect file as read: its path, for messages, and its text. */
export interface RedirectFile {
  readonly name: string;
  readonly text: string;
}

/**
 * Parse the redirect files, in order, into the redirects they can serve and a
 * line for every one they cannot: an entry that is not a well-formed
 * redirect, a source declared twice (the first wins, so the earlier file
 * does), and every entry that leads into a loop. A file is a list of
 * `{ "from", "to", "status" }` or an object mapping each source to its target.
 */
export function parseRedirects(files: readonly RedirectFile[]): {
  table: RedirectTable;
  problems: string[];
} {
  const problems: string[] = [];
  const paths = new Map<string, Redirect>();
  const queries = new Map<string, Redirect>();
  const fileOf = new Map<Redirect, string>();

  for (const { name, text } of files) {
    const entries = entriesOf(text);
    if (typeof entries === 'string') {
      problems.push(`${name}: ${entries}`);
      continue;
    }
    entries.forEach((entry, index) => {
      const result = parseEntry(entry);
      if (typeof result === 'string') {
        problems.push(`${name}: entry ${String(index + 1)} ${result}`);
        return;
      }
      const { key, query, redirect } = result;
      const table = query === '' ? paths : queries;
      if (table.has(key)) {
        problems.push(
          `${name}: "${redirect.from}" is declared more than once; the first declaration is used.`,
        );
        return;
      }
      table.set(key, redirect);
      fileOf.set(redirect, name);
    });
  }

  // Every loop is found before any entry is dropped, or dropping one half of
  // a loop would make the other half look like an ordinary redirect.
  const table = { paths, queries };
  const looping = [paths, queries].flatMap((map) =>
    [...map]
      .filter(([, redirect]) => leadsIntoLoop(table, redirect))
      .map(([key, redirect]) => ({ map, key, redirect })),
  );
  for (const { map, key, redirect } of looping) {
    problems.push(
      `${fileOf.get(redirect) ?? ''}: "${redirect.from}" leads into a redirect loop and is not served.`,
    );
    map.delete(key);
  }

  return { table, problems };
}

function entriesOf(text: string): unknown[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `it is not valid JSON (${reason}).`;
  }
  if (Array.isArray(parsed)) return parsed as unknown[];
  if (typeof parsed === 'object' && parsed !== null) {
    return Object.entries(parsed as Record<string, unknown>).map(([from, to]) => ({ from, to }));
  }
  return 'it must be a list of { "from", "to", "status" }, or an object of "from": "to".';
}

function parseEntry(entry: unknown): { key: string; query: string; redirect: Redirect } | string {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return 'is not an object with "from" and "to".';
  }
  const { from, to, status = 301 } = entry as Record<string, unknown>;

  if (typeof from !== 'string' || !isSitePath(from)) {
    return `has a "from" of ${JSON.stringify(from)}: it must be a path on this site, starting with "/".`;
  }
  if (!STATUSES.includes(status as RedirectStatus)) {
    return `("${from}") has a "status" of ${JSON.stringify(status)}: it must be one of ${STATUSES.join(', ')}.`;
  }
  const location = typeof to === 'string' ? locationOf(to) : undefined;
  if (location === undefined) {
    return `("${from}") has a "to" of ${JSON.stringify(to)}: it must be a path on this site or an http(s) URL.`;
  }

  const source = new URL(from, SITE);
  const query = sortedQuery(source.search);
  const key =
    query === '' ? decodedPath(source.pathname) : `${decodedPath(source.pathname)}?${query}`;
  const passQuery = query === '' && !location.includes('?');
  return { key, query, redirect: { from, location, status: status as RedirectStatus, passQuery } };
}

function isSitePath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('#');
}

/** A target as a URL-safe `Location`, or `undefined` when it is not one. */
function locationOf(to: string): string | undefined {
  if (to.startsWith('/') && !to.startsWith('//')) {
    const url = new URL(to, SITE);
    return `${url.pathname}${url.search}${url.hash}`;
  }
  try {
    const url = new URL(to);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether following a redirect through the table ever comes back to a source
 * already visited. A target on another host, or one the table has nothing
 * for, ends the chain.
 */
function leadsIntoLoop(table: RedirectTable, start: Redirect): boolean {
  const seen = new Set<Redirect>([start]);
  let current = start;
  for (;;) {
    if (!current.location.startsWith('/')) return false;
    const url = new URL(current.location, SITE);
    const next = findRedirect(table, decodedPath(url.pathname), url.search);
    if (next === undefined) return false;
    if (seen.has(next)) return true;
    seen.add(next);
    current = next;
  }
}

/**
 * The redirect a request names: a source with exactly this query first, then
 * one with no query at all. `pathname` is decoded, as `requestPath` gives it.
 */
function findRedirect(
  table: RedirectTable,
  pathname: string,
  search: string,
): Redirect | undefined {
  return findQueryRedirect(table, pathname, search) ?? table.paths.get(pathname);
}

/** The redirect whose source names this path with exactly this query. */
export function findQueryRedirect(
  table: RedirectTable,
  pathname: string,
  search: string,
): Redirect | undefined {
  const query = sortedQuery(search);
  return query === '' ? undefined : table.queries.get(`${pathname}?${query}`);
}

/** Where a redirect sends a request that came with `search`. */
export function redirectLocation(redirect: Redirect, search: string): string {
  if (!redirect.passQuery || search === '' || search === '?') return redirect.location;
  const hash = redirect.location.indexOf('#');
  return hash === -1
    ? `${redirect.location}${search}`
    : `${redirect.location.slice(0, hash)}${search}${redirect.location.slice(hash)}`;
}

function sortedQuery(search: string): string {
  const params = new URLSearchParams(search);
  params.sort();
  return params.toString();
}

function decodedPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** The site's declared redirects, read from the files as they are now. */
export interface RedirectSource {
  current(): RedirectTable;
}

/**
 * Read `content/_data/redirects.json` and every file in
 * `content/_data/redirects/` per call, parsing them again only when one has
 * changed, so an edit takes effect on the next request with no restart and
 * with the watcher off. Each problem is logged once per change rather than on
 * every request; the CMS asks once at boot, so a file with problems says so
 * before the first request arrives.
 */
export function createRedirectSource(options: {
  contentDir: string;
  logger?: { warn(message: string): void } | undefined;
}): RedirectSource {
  const logger = options.logger ?? console;
  const file = path.join(options.contentDir, ...REDIRECTS_FILE.split('/'));
  const dir = path.join(options.contentDir, ...REDIRECTS_DIR.split('/'));
  let cachedKey = JSON.stringify([]);
  let cached: RedirectTable = EMPTY;

  return {
    current() {
      const files = [file, ...jsonFilesIn(dir)].flatMap((name) => {
        const text = readIfPresent(name);
        return text === undefined ? [] : [{ name, text }];
      });
      const key = JSON.stringify(files);
      if (key === cachedKey) return cached;

      cachedKey = key;
      const { table, problems } = parseRedirects(files);
      cached = table;
      for (const problem of problems) logger.warn(problem);
      return cached;
    },
  };
}

function jsonFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function readIfPresent(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Stamp `X-Redirect-By` on every redirect the CMS answers with, whichever part
 * of it sent one, so somebody tracing a chain of redirects through a proxy can
 * tell this layer's from the others'.
 */
export const redirectBy: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  await next();
  if (c.res.status >= 300 && c.res.status < 400 && c.res.headers.has('Location')) {
    c.res.headers.set('X-Redirect-By', REDIRECT_BY);
  }
};
