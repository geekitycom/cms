/**
 * Look up (TASK-434): what the web knows about a review's item, from its ID.
 *
 * Each source is asked once, through {@link fetchPublic}, so every request
 * carries the site's User-Agent and the guards on reaching out: public hosts
 * only, one deadline, a byte limit. Open Library answers an ISBN, Crossref a
 * DOI, MusicBrainz a release or release group with its album art from the
 * Cover Art Archive, and TMDb a movie or TV show, and an IMDb title when the
 * site has a TMDb key. Any other page is read the way a cited page is, through
 * its JSON-LD and its own metadata. Nothing throws: a lookup that finds nothing
 * is one sentence saying why.
 */

import { setTimeout as sleep } from 'node:timers/promises';

import type { ReviewKind } from '../content/review.ts';
import { isRecord } from '../util/guards.ts';
import type { HostLookup } from '../util/public-address.ts';
import { fetchPublic } from '../webmention/fetch-public.ts';
import { jsonLdWork } from '../webmention/reply-context/json-ld.ts';
import { canonicalLink, pageSource, readPage } from '../webmention/reply-context/page.ts';
import { plainText } from '../webmention/reply-context/source.ts';
import { parseItemId } from './item-id.ts';
import type { ItemId } from './item-id.ts';

/** What a source says about an item. Only what it knows is set. */
export interface FoundItem {
  /** Who answered, as a sentence names them: "Open Library". */
  readonly source: string;
  /** What it is, where the source says. */
  readonly kind?: ReviewKind;
  readonly name?: string;
  readonly by?: string;
  readonly year?: string;
  readonly url?: string;
  readonly season?: string;
  readonly episode?: string;
  /** Where its cover, poster or album art is on the web. */
  readonly picture?: string;
}

export type ItemLookup =
  | { readonly ok: true; readonly item: FoundItem }
  | { readonly ok: false; readonly message: string };

export interface LookUpItemOptions {
  readonly lookup: HostLookup;
  /** The site's TMDb API key or read access token; empty when it has none. */
  readonly tmdbKey: string;
  /** An email address Crossref's polite pool can reach, when there is one. */
  readonly contact?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export const ITEM_LOOKUP_TIMEOUT_MS = 10_000;

/** The most of an API's answer, or a page, that is read. */
const MAX_BYTES = 1_000_000;

/** MusicBrainz takes one request a second from a client, on average. */
export const MUSICBRAINZ_INTERVAL_MS = 1_000;

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

/** Where the TMDb key is added, as a failed lookup names it. */
export const TMDB_KEY_PLACE = 'Settings > General';

interface Limits {
  readonly lookup: HostLookup;
  readonly signal: AbortSignal;
}

export async function lookUpItem(value: string, options: LookUpItemOptions): Promise<ItemLookup> {
  const id = parseItemId(value);
  if (id === undefined) {
    return fail(`Look up reads an ISBN, a DOI or a web address, not ${value.trim()}.`);
  }
  const limits: Limits = {
    lookup: options.lookup,
    signal: AbortSignal.timeout(options.timeoutMs ?? ITEM_LOOKUP_TIMEOUT_MS),
  };
  switch (id.source) {
    case 'isbn':
      return openLibrary(id.isbn, limits);
    case 'doi':
      return crossref(id.doi, options.contact, limits);
    case 'musicbrainz':
      return musicBrainz(id, limits);
    case 'tmdb':
      return options.tmdbKey === ''
        ? fail(
            `Looking up a TMDb link needs a TMDb API key. Add one on ${TMDB_KEY_PLACE}, or type the details in.`,
          )
        : tmdb(id, options.tmdbKey, limits);
    case 'imdb':
      return imdb(id, options.tmdbKey, limits);
    case 'page':
      return page(id.url, limits);
  }
}

function fail(message: string): ItemLookup {
  return { ok: false, message };
}

type JsonRead =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string; readonly status?: number | undefined };

async function readJson(
  url: string,
  limits: Limits,
  headers: Readonly<Record<string, string>> = {},
): Promise<JsonRead> {
  const fetched = await fetchPublic(url, {
    lookup: limits.lookup,
    signal: limits.signal,
    maxBytes: MAX_BYTES,
    accept: 'application/json',
    headers,
    contentType: { pattern: /^\s*application\/(?:[\w.+-]+\+)?json/i, name: 'JSON' },
  });
  if (!fetched.ok) return fetched;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(fetched.body));
    return isRecord(value) ? { ok: true, value } : { ok: false, reason: 'not a JSON object' };
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
}

/** One sentence for an API that did not answer with the item. */
function unanswered(read: Extract<JsonRead, { ok: false }>, source: string, missing: string) {
  if (read.status === 404) return fail(missing);
  if (read.status === 429 || read.status === 503) {
    return fail(`${source} is busy (it answered ${String(read.status)}). Try again in a minute.`);
  }
  return fail(`Could not look that up on ${source}: ${read.reason}.`);
}

function text(value: unknown): string | undefined {
  return typeof value === 'number' ? String(value) : plainText(value);
}

/** The year at the start of a date, as the year box takes it. */
function yearOf(value: unknown): string | undefined {
  return /^(\d{4})/.exec(text(value) ?? '')?.[1];
}

function names(values: unknown, key = 'name'): string | undefined {
  const listed = (Array.isArray(values) ? values : [])
    .map((value) => (isRecord(value) ? text(value[key]) : undefined))
    .filter((name) => name !== undefined);
  return listed.length === 0 ? undefined : listed.join(', ');
}

function withDefined(found: Record<string, string | undefined> & { source: string }): FoundItem {
  return Object.fromEntries(
    Object.entries(found).filter(([, value]) => value !== undefined && value !== ''),
  ) as unknown as FoundItem;
}

/** Open Library's Books API, then its cover for the ISBN when the book names none. */
async function openLibrary(isbn: string, limits: Limits): Promise<ItemLookup> {
  const key = `ISBN:${isbn}`;
  const read = await readJson(
    `https://openlibrary.org/api/books?bibkeys=${key}&format=json&jscmd=data`,
    limits,
  );
  const missing = `Open Library has no book with the ISBN ${isbn}.`;
  if (!read.ok) return unanswered(read, 'Open Library', missing);
  const book = read.value[key];
  if (!isRecord(book)) return fail(missing);
  const cover = isRecord(book['cover'])
    ? (text(book['cover']['large']) ?? text(book['cover']['medium']))
    : undefined;
  return {
    ok: true,
    item: withDefined({
      source: 'Open Library',
      kind: 'book',
      name: text(book['title']),
      by: names(book['authors']),
      year: yearOf(/\d{4}/.exec(text(book['publish_date']) ?? '')?.[0]),
      url: text(book['url'])?.replace(/^http:/, 'https:'),
      picture: cover ?? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
    }),
  };
}

/** How many of a paper's authors are named before "and others". */
const CROSSREF_AUTHORS = 3;

async function crossref(
  doi: string,
  contact: string | undefined,
  limits: Limits,
): Promise<ItemLookup> {
  const mailto =
    contact === undefined || contact === '' ? '' : `?mailto=${encodeURIComponent(contact)}`;
  const read = await readJson(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}${mailto}`,
    limits,
  );
  const missing = `Crossref has no work with the DOI ${doi}.`;
  if (!read.ok) return unanswered(read, 'Crossref', missing);
  const work = read.value['message'];
  if (!isRecord(work)) return fail(missing);
  const authors = (Array.isArray(work['author']) ? work['author'] : []).flatMap((author) => {
    if (!isRecord(author)) return [];
    const name = [text(author['given']), text(author['family'])].filter(Boolean).join(' ');
    return name === '' ? (text(author['name']) ?? []) : [name];
  });
  const by =
    authors.length > CROSSREF_AUTHORS
      ? `${authors.slice(0, CROSSREF_AUTHORS).join(', ')} and others`
      : authors.join(', ');
  const issued = isRecord(work['issued']) ? work['issued']['date-parts'] : undefined;
  const year = Array.isArray(issued) && Array.isArray(issued[0]) ? yearOf(issued[0][0]) : undefined;
  return {
    ok: true,
    item: withDefined({
      source: 'Crossref',
      ...(work['type'] === 'book' || work['type'] === 'monograph' ? { kind: 'book' } : {}),
      name: [work['title']].flat().map(text).find(Boolean),
      by,
      year,
      url: text(work['URL']) ?? `https://doi.org/${doi}`,
    }),
  };
}

/** When MusicBrainz will next take a request from this process. */
let musicBrainzFree = 0;

/**
 * Wait for this process's turn at MusicBrainz. Each caller reserves the next
 * free second before it waits, so lookups pressed together go one a second.
 */
async function musicBrainzTurn(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, musicBrainzFree);
  musicBrainzFree = at + MUSICBRAINZ_INTERVAL_MS;
  if (at > now) await sleep(at - now);
}

async function musicBrainz(
  id: Extract<ItemId, { source: 'musicbrainz' }>,
  limits: Limits,
): Promise<ItemLookup> {
  await musicBrainzTurn();
  const read = await readJson(
    `https://musicbrainz.org/ws/2/${id.type}/${id.id}?inc=artist-credits&fmt=json`,
    limits,
  );
  const noun = id.type === 'release' ? 'release' : 'release group';
  if (!read.ok) return unanswered(read, 'MusicBrainz', `MusicBrainz has no ${noun} ${id.id}.`);
  const album = read.value;
  const credit = (Array.isArray(album['artist-credit']) ? album['artist-credit'] : [])
    .map((part) =>
      isRecord(part) ? `${text(part['name']) ?? ''}${text(part['joinphrase']) ?? ''}` : '',
    )
    .join('')
    .trim();
  return {
    ok: true,
    item: withDefined({
      source: 'MusicBrainz',
      kind: 'album',
      name: text(album['title']),
      by: credit,
      year: yearOf(album['first-release-date'] ?? album['date']),
      picture: `https://coverartarchive.org/${id.type}/${id.id}/front-500`,
    }),
  };
}

/** A v3 API key goes in the query; a read access token is a bearer token. */
function tmdbRequest(path: string, key: string): { url: string; headers: Record<string, string> } {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  if (key.includes('.')) return { url: url.href, headers: { authorization: `Bearer ${key}` } };
  url.searchParams.set('api_key', key);
  return { url: url.href, headers: {} };
}

async function tmdb(
  id: Extract<ItemId, { source: 'tmdb' }>,
  key: string,
  limits: Limits,
): Promise<ItemLookup> {
  const request = tmdbRequest(
    `/${id.type}/${id.id}${id.type === 'movie' ? '?append_to_response=credits' : ''}`,
    key,
  );
  const read = await readJson(request.url, limits, request.headers);
  const noun = id.type === 'movie' ? 'movie' : 'TV show';
  if (!read.ok) {
    if (read.status === 401) {
      return fail(`TMDb refused the site’s API key. Check it on ${TMDB_KEY_PLACE}.`);
    }
    return unanswered(read, 'TMDb', `TMDb has no ${noun} ${id.id}.`);
  }
  const found = read.value;
  const credits = isRecord(found['credits']) ? found['credits']['crew'] : undefined;
  const directors = (Array.isArray(credits) ? credits : []).filter(
    (person) => isRecord(person) && person['job'] === 'Director',
  );
  const poster = text(found['poster_path']);
  return {
    ok: true,
    item: withDefined({
      source: 'TMDb',
      kind: id.type,
      name: text(found[id.type === 'movie' ? 'title' : 'name']),
      by: id.type === 'movie' ? names(directors) : names(found['networks']),
      year: yearOf(found[id.type === 'movie' ? 'release_date' : 'first_air_date']),
      url: text(found['homepage']),
      season: id.season,
      episode: id.episode,
      picture: poster === undefined ? undefined : `${TMDB_IMAGE_BASE}${poster}`,
    }),
  };
}

/**
 * An IMDb title, found on TMDb by its IMDb ID when the site has a key. IMDb
 * answers a site's request for one of its pages with a challenge for a
 * browser, so without a key its page is read like any other, and usually has
 * nothing to give.
 */
async function imdb(
  id: Extract<ItemId, { source: 'imdb' }>,
  key: string,
  limits: Limits,
): Promise<ItemLookup> {
  if (key === '') {
    const read = await page(id.url, limits);
    if (read.ok) return read;
    return fail(
      `${read.message} IMDb does not let other sites read its pages; with a TMDb API key on ${TMDB_KEY_PLACE}, Look up finds IMDb links through TMDb.`,
    );
  }
  const request = tmdbRequest(`/find/${id.id}?external_source=imdb_id`, key);
  const read = await readJson(request.url, limits, request.headers);
  if (!read.ok) {
    if (read.status === 401) {
      return fail(`TMDb refused the site’s API key. Check it on ${TMDB_KEY_PLACE}.`);
    }
    return unanswered(read, 'TMDb', `TMDb knows no IMDb title ${id.id}.`);
  }
  const first = (results: unknown): unknown => (Array.isArray(results) ? results[0] : undefined);
  const movie = first(read.value['movie_results']);
  const show = first(read.value['tv_results']);
  const match = isRecord(movie)
    ? { type: 'movie' as const, found: movie }
    : isRecord(show)
      ? { type: 'tv' as const, found: show }
      : undefined;
  const tmdbId = match === undefined ? undefined : text(match.found['id']);
  if (match === undefined || tmdbId === undefined) {
    return fail(`TMDb knows no movie or TV show with the IMDb ID ${id.id}.`);
  }
  return tmdb({ source: 'tmdb', type: match.type, id: tmdbId }, key, limits);
}

/** Any other page: its JSON-LD first, then its own title, author and picture. */
async function page(url: string, limits: Limits): Promise<ItemLookup> {
  const read = await readPage(url, {
    lookup: limits.lookup,
    deadline: limits.signal,
    maxBytes: MAX_BYTES,
  });
  if (!read.ok) return fail(`Could not read ${url}: ${read.reason}.`);
  if (read.page === undefined) return fail(`${url} is an image, not a page about the item.`);
  const { root, url: at } = read.page;
  const work = jsonLdWork(root, at);
  const meta = pageSource(root, at);
  const name = work?.name ?? (typeof meta.name === 'string' ? meta.name : undefined);
  if (name === undefined) return fail(`${url} names nothing Look up can fill in.`);
  return {
    ok: true,
    item: withDefined({
      source: new URL(at).hostname.replace(/^www\./, ''),
      name,
      by: work?.by ?? meta.author?.name,
      year: yearOf(work?.published ?? meta.published),
      url: work?.url ?? canonicalLink(root, at) ?? at,
      picture: work?.picture ?? meta.picture?.url,
    }),
  };
}
