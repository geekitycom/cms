import { setTimeout as sleep } from 'node:timers/promises';

import type { ReviewKind } from '../content/review.ts';
import { isRecord } from '../util/guards.ts';
import type { HostLookup } from '../util/public-address.ts';
import { fetchPublic, webUrl } from '../webmention/fetch-public.ts';
import { jsonLdWork } from '../webmention/reply-context/json-ld.ts';
import { canonicalLink, pageSource, readPage } from '../webmention/reply-context/page.ts';
import { plainText } from '../webmention/reply-context/source.ts';
import { parseItemId } from './item-id.ts';
import type { ItemId } from './item-id.ts';

export interface FoundItem {
  readonly source: string;
  readonly kind?: ReviewKind;
  readonly name?: string;
  readonly by?: string;
  readonly year?: string;
  readonly url?: string;
  readonly season?: string;
  readonly episode?: string;
  readonly streetAddress?: string;
  readonly locality?: string;
  readonly region?: string;
  readonly countryName?: string;
  readonly picture?: string;
}

export type ItemLookup =
  | { readonly ok: true; readonly item: FoundItem }
  | { readonly ok: false; readonly message: string };

export interface LookUpItemOptions {
  readonly lookup: HostLookup;
  readonly tmdbKey: string;
  /** An email address Crossref's polite pool can reach, when there is one. */
  readonly contact?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

const ITEM_LOOKUP_TIMEOUT_MS = 10_000;

const MAX_BYTES = 1_000_000;

/** MusicBrainz and Nominatim each take one request a second from a client. */
const ONE_A_SECOND_MS = 1_000;

const NOMINATIM = 'https://nominatim.openstreetmap.org';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

const TMDB_KEY_PLACE = 'Settings > General';

const TMDB_REFUSED = `TMDb refused the site’s API key. Check it on ${TMDB_KEY_PLACE}.`;

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
      return openLibrary({ key: 'ISBN', id: id.isbn, cover: 'isbn' }, limits);
    case 'openlibrary':
      return openLibrary({ key: 'OLID', id: id.olid, cover: 'olid' }, limits);
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
    case 'osm':
      return openStreetMap(id, limits);
    case 'page':
      return page(id.url, limits);
  }
}

function fail(message: string): ItemLookup {
  return { ok: false, message };
}

interface JsonRefusal {
  readonly ok: false;
  readonly reason: string;
  readonly status?: number | undefined;
}

type JsonRead<T = Record<string, unknown>> = { readonly ok: true; readonly value: T } | JsonRefusal;

async function readJson(
  url: string,
  limits: Limits,
  headers: Readonly<Record<string, string>> = {},
): Promise<JsonRead> {
  const read = await readJsonValue(url, limits, headers);
  if (!read.ok || isRecord(read.value)) return read as JsonRead;
  return { ok: false, reason: 'not a JSON object' };
}

async function readJsonValue(
  url: string,
  limits: Limits,
  headers: Readonly<Record<string, string>> = {},
): Promise<JsonRead<unknown>> {
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
    return { ok: true, value };
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
}

function unanswered(read: JsonRefusal, source: string, missing: string) {
  if (read.status === 404) return fail(missing);
  return fail(busy(read, source) ?? `Could not look that up on ${source}: ${read.reason}.`);
}

function busy(read: JsonRefusal, source: string): string | undefined {
  return read.status === 429 || read.status === 503
    ? `${source} is busy (it answered ${String(read.status)}). Try again in a minute.`
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'number' ? String(value) : plainText(value);
}

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

async function openLibrary(
  book: { readonly key: 'ISBN' | 'OLID'; readonly id: string; readonly cover: 'isbn' | 'olid' },
  limits: Limits,
): Promise<ItemLookup> {
  const key = `${book.key}:${book.id}`;
  const read = await readJson(
    `https://openlibrary.org/api/books?bibkeys=${key}&format=json&jscmd=data`,
    limits,
  );
  const missing =
    book.key === 'ISBN'
      ? `Open Library has no book with the ISBN ${book.id}.`
      : `Open Library has no edition ${book.id}.`;
  if (!read.ok) return unanswered(read, 'Open Library', missing);
  const found = read.value[key];
  if (!isRecord(found)) return fail(missing);
  const cover = isRecord(found['cover'])
    ? (text(found['cover']['large']) ?? text(found['cover']['medium']))
    : undefined;
  return {
    ok: true,
    item: withDefined({
      source: 'Open Library',
      kind: 'book',
      name: text(found['title']),
      by: names(found['authors']),
      year: yearOf(/\d{4}/.exec(text(found['publish_date']) ?? '')?.[0]),
      url: text(found['url'])?.replace(/^http:/, 'https:'),
      picture:
        cover ?? `https://covers.openlibrary.org/b/${book.cover}/${book.id}-L.jpg?default=false`,
    }),
  };
}

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

function oneASecond(): () => Promise<void> {
  let free = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, free);
    free = at + ONE_A_SECOND_MS;
    if (at > now) await sleep(at - now);
  };
}

const musicBrainzTurn = oneASecond();

const nominatimTurn = oneASecond();

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
  return {
    ok: true,
    item: withDefined({
      source: 'MusicBrainz',
      kind: 'album',
      name: text(album['title']),
      by: artistCredit(album),
      year: yearOf(album['first-release-date'] ?? album['date']),
      picture: `https://coverartarchive.org/${id.type}/${id.id}/front-500`,
    }),
  };
}

function artistCredit(album: Record<string, unknown>): string {
  return (Array.isArray(album['artist-credit']) ? album['artist-credit'] : [])
    .map((part) =>
      isRecord(part)
        ? `${text(part['name']) ?? ''}${typeof part['joinphrase'] === 'string' ? part['joinphrase'] : ''}`
        : '',
    )
    .join('')
    .trim();
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
    if (read.status === 401) return fail(TMDB_REFUSED);
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
 * IMDb answers a server's request for one of its pages with a challenge for a
 * browser, so without a TMDb key its page usually has nothing to give.
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
    if (read.status === 401) return fail(TMDB_REFUSED);
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

async function openStreetMap(
  id: Extract<ItemId, { source: 'osm' }>,
  limits: Limits,
): Promise<ItemLookup> {
  await nominatimTurn();
  const url = new URL(`${NOMINATIM}/lookup`);
  url.searchParams.set('osm_ids', `${id.type.charAt(0).toUpperCase()}${id.id}`);
  setNominatimDetails(url);
  const read = await readJsonValue(url.href, limits);
  const missing = `OpenStreetMap has no ${id.type} ${id.id}.`;
  if (!read.ok) return unanswered(read, 'OpenStreetMap', missing);
  const [place] = records(read.value);
  if (place === undefined) return fail(missing);
  return {
    ok: true,
    item: withDefined({ source: 'OpenStreetMap', kind: 'place', ...placeOf(place) }),
  };
}

function setNominatimDetails(url: URL): void {
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('extratags', '1');
}

function placeOf(place: Record<string, unknown>): Record<string, string | undefined> {
  const address = isRecord(place['address']) ? place['address'] : {};
  const tags = isRecord(place['extratags']) ? place['extratags'] : {};
  const first = (from: Record<string, unknown>, keys: readonly string[]): string | undefined =>
    keys.map((key) => text(from[key])).find((value) => value !== undefined);
  const street = [text(address['house_number']), text(address['road'])].filter(Boolean).join(' ');
  const website = first(tags, ['website', 'contact:website', 'url']);
  return {
    name: text(place['name']) ?? text(place['display_name'])?.split(',')[0],
    streetAddress: street === '' ? undefined : street,
    locality: first(address, ['city', 'town', 'village', 'hamlet', 'municipality', 'suburb']),
    region: first(address, ['state', 'province', 'region', 'county']),
    countryName: text(address['country']),
    url: website === undefined ? undefined : webUrl(website)?.href,
  };
}

export const SEARCH_KINDS = ['book', 'movie', 'tv', 'album', 'place'] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

export function isSearchKind(value: string): value is SearchKind {
  return (SEARCH_KINDS as readonly string[]).includes(value);
}

export interface FoundMatch {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly source: string;
  readonly picture?: string | undefined;
}

export type ItemSearch =
  | {
      readonly ok: true;
      readonly matches: readonly FoundMatch[];
      /** The attribution a source's terms ask for beside its results. */
      readonly credit?: string;
    }
  | { readonly ok: false; readonly message: string };

export interface SearchItemsOptions {
  readonly lookup: HostLookup;
  readonly tmdbKey: string;
  readonly timeoutMs?: number | undefined;
}

const SEARCH_RESULTS = 6;

/**
 * Searches answered lately, so the same search is not sent twice: Nominatim
 * asks that results are cached, and blocks a client that repeats a query.
 */
const SEARCHED_FOR_MS = 60 * 60 * 1000;
const SEARCHES_KEPT = 100;
const searched = new Map<string, { readonly at: number; readonly found: ItemSearch }>();

export async function searchItems(
  kind: SearchKind,
  query: string,
  options: SearchItemsOptions,
): Promise<ItemSearch> {
  const words = query.replace(/\s+/g, ' ').trim();
  if (words === '') return { ok: false, message: 'Type a title to search for.' };
  if ((kind === 'movie' || kind === 'tv') && options.tmdbKey === '') {
    return {
      ok: false,
      message: `Searching TMDb needs a TMDb API key. Add one on ${TMDB_KEY_PLACE}, or paste a link in the box below.`,
    };
  }
  const key = `${kind} ${words.toLowerCase()}`;
  const now = Date.now();
  const kept = searched.get(key);
  if (kept !== undefined && now - kept.at < SEARCHED_FOR_MS) return kept.found;

  const limits: Limits = {
    lookup: options.lookup,
    signal: AbortSignal.timeout(options.timeoutMs ?? ITEM_LOOKUP_TIMEOUT_MS),
  };
  const found = await searchAt(kind, words, options.tmdbKey, limits);
  if (found.ok) {
    searched.delete(key);
    searched.set(key, { at: now, found });
    for (const old of searched.keys()) {
      if (searched.size <= SEARCHES_KEPT) break;
      searched.delete(old);
    }
  }
  return found;
}

function searchAt(
  kind: SearchKind,
  words: string,
  tmdbKey: string,
  limits: Limits,
): Promise<ItemSearch> {
  switch (kind) {
    case 'book':
      return searchOpenLibrary(words, limits);
    case 'movie':
    case 'tv':
      return searchTmdb(kind, words, tmdbKey, limits);
    case 'album':
      return searchMusicBrainz(words, limits);
    case 'place':
      return searchNominatim(words, limits);
  }
}

function unsearched(read: JsonRefusal, source: string): ItemSearch {
  return {
    ok: false,
    message: busy(read, source) ?? `Could not search ${source}: ${read.reason}.`,
  };
}

function records(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : []).filter(isRecord);
}

function detailOf(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' · ');
}

async function searchOpenLibrary(words: string, limits: Limits): Promise<ItemSearch> {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('q', words);
  url.searchParams.set(
    'fields',
    'key,title,author_name,first_publish_year,cover_i,editions,editions.key,editions.isbn,editions.cover_i',
  );
  url.searchParams.set('limit', String(SEARCH_RESULTS));
  const read = await readJson(url.href, limits);
  if (!read.ok) return unsearched(read, 'Open Library');
  const matches = records(read.value['docs']).flatMap((work) => {
    const name = text(work['title']);
    const edition =
      records(isRecord(work['editions']) ? work['editions']['docs'] : undefined)[0] ?? {};
    const isbns = (Array.isArray(edition['isbn']) ? edition['isbn'] : []).flatMap(
      (isbn) => text(isbn) ?? [],
    );
    const isbn = isbns.find((value) => value.length === 13) ?? isbns[0];
    const page = text(edition['key']) ?? text(work['key']);
    const id =
      isbn !== undefined
        ? `isbn:${isbn}`
        : page === undefined
          ? undefined
          : `https://openlibrary.org${page}`;
    if (name === undefined || id === undefined) return [];
    const cover = text(edition['cover_i']) ?? text(work['cover_i']);
    const authors = Array.isArray(work['author_name']) ? work['author_name'] : [];
    return [
      {
        id,
        name,
        detail: detailOf(
          authors
            .slice(0, 2)
            .flatMap((author) => text(author) ?? [])
            .join(', '),
          text(work['first_publish_year']),
        ),
        source: 'Open Library',
        picture:
          cover === undefined ? undefined : `https://covers.openlibrary.org/b/id/${cover}-M.jpg`,
      },
    ];
  });
  return { ok: true, matches };
}

/** TMDb's search leaves out each match's director or network. */
async function searchTmdb(
  type: 'movie' | 'tv',
  words: string,
  key: string,
  limits: Limits,
): Promise<ItemSearch> {
  const request = tmdbRequest(`/search/${type}?query=${encodeURIComponent(words)}`, key);
  const read = await readJson(request.url, limits, request.headers);
  if (!read.ok) {
    return read.status === 401 ? { ok: false, message: TMDB_REFUSED } : unsearched(read, 'TMDb');
  }
  const found = records(read.value['results']).slice(0, SEARCH_RESULTS);
  const matches = await Promise.all(
    found.map(async (result) => {
      const id = text(result['id']);
      const name = text(result[type === 'movie' ? 'title' : 'name']);
      if (id === undefined || name === undefined) return [];
      const poster = text(result['poster_path']);
      return [
        {
          id: `https://www.themoviedb.org/${type}/${id}`,
          name,
          detail: detailOf(
            await tmdbMaker(type, id, key, limits),
            yearOf(result[type === 'movie' ? 'release_date' : 'first_air_date']),
          ),
          source: 'TMDb',
          picture: poster === undefined ? undefined : `https://image.tmdb.org/t/p/w92${poster}`,
        },
      ];
    }),
  );
  return { ok: true, matches: matches.flat() };
}

async function tmdbMaker(
  type: 'movie' | 'tv',
  id: string,
  key: string,
  limits: Limits,
): Promise<string | undefined> {
  const request = tmdbRequest(type === 'movie' ? `/movie/${id}/credits` : `/tv/${id}`, key);
  const read = await readJson(request.url, limits, request.headers);
  if (!read.ok) return undefined;
  if (type === 'tv') return names(read.value['networks']);
  return names(records(read.value['crew']).filter((person) => person['job'] === 'Director'));
}

async function searchMusicBrainz(words: string, limits: Limits): Promise<ItemSearch> {
  await musicBrainzTurn();
  const url = new URL('https://musicbrainz.org/ws/2/release-group');
  url.searchParams.set('query', words.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&'));
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', String(SEARCH_RESULTS));
  const read = await readJson(url.href, limits);
  if (!read.ok) return unsearched(read, 'MusicBrainz');
  const matches = records(read.value['release-groups']).flatMap((group) => {
    const id = text(group['id']);
    const name = text(group['title']);
    if (id === undefined || name === undefined) return [];
    return [
      {
        id: `https://musicbrainz.org/release-group/${id}`,
        name,
        detail: detailOf(artistCredit(group), yearOf(group['first-release-date'])),
        source: 'MusicBrainz',
        picture: `https://coverartarchive.org/release-group/${id}/front-250`,
      },
    ];
  });
  return { ok: true, matches };
}

/** Nominatim's search, which its usage policy asks to be credited. */
async function searchNominatim(words: string, limits: Limits): Promise<ItemSearch> {
  await nominatimTurn();
  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set('q', words);
  setNominatimDetails(url);
  url.searchParams.set('limit', String(SEARCH_RESULTS));
  const read = await readJsonValue(url.href, limits);
  if (!read.ok) return unsearched(read, 'OpenStreetMap');
  const matches = records(read.value).flatMap((result) => {
    const type = text(result['osm_type']);
    const id = text(result['osm_id']);
    const place = placeOf(result);
    if (
      type === undefined ||
      !['node', 'way', 'relation'].includes(type) ||
      id === undefined ||
      place['name'] === undefined
    ) {
      return [];
    }
    const where = [place['streetAddress'], place['locality'], place['region']]
      .filter(Boolean)
      .join(', ');
    return [
      {
        id: `https://www.openstreetmap.org/${type}/${id}`,
        name: place['name'],
        detail: where === '' ? (text(result['display_name']) ?? '') : where,
        source: 'OpenStreetMap',
      },
    ];
  });
  return { ok: true, matches, credit: 'Places © OpenStreetMap contributors, ODbL.' };
}
