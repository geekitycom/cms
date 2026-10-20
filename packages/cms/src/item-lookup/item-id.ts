/**
 * What a review item's ID names (TASK-434): an ISBN, a DOI, a page on TMDb,
 * IMDb, MusicBrainz, Open Library or OpenStreetMap, or any other page. Look
 * up reads it to choose where to ask about the item.
 */

import { webUrl } from '../webmention/fetch-public.ts';

export type ItemId =
  | { readonly source: 'isbn'; readonly isbn: string }
  | { readonly source: 'doi'; readonly doi: string }
  | {
      readonly source: 'tmdb';
      readonly type: 'movie' | 'tv';
      readonly id: string;
      readonly season?: string;
      readonly episode?: string;
    }
  | { readonly source: 'imdb'; readonly id: string; readonly url: string }
  | {
      readonly source: 'musicbrainz';
      readonly type: 'release-group' | 'release';
      readonly id: string;
    }
  | { readonly source: 'openlibrary'; readonly olid: string }
  | {
      readonly source: 'osm';
      readonly type: 'node' | 'way' | 'relation';
      readonly id: string;
    }
  | { readonly source: 'page'; readonly url: string };

const ISBN = /^(?:\d[\d -]{8,15}[\dXx])$/;

const DOI = /^10\.\d{4,9}\/\S+$/;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The item an ID names, or `undefined` for one that is none of them. */
export function parseItemId(value: string): ItemId | undefined {
  const given = value.trim();
  const prefixed = /^(isbn|doi):\s*(\S.*)$/i.exec(given);
  const scheme = prefixed?.[1]?.toLowerCase();
  const rest = prefixed?.[2] ?? given;

  if (scheme === 'isbn' || (scheme === undefined && ISBN.test(given))) {
    const isbn = rest.replace(/[\s-]/g, '').toUpperCase();
    return /^(\d{9}[\dX]|\d{13})$/.test(isbn) ? { source: 'isbn', isbn } : undefined;
  }
  if (scheme === 'doi') return DOI.test(rest) ? { source: 'doi', doi: rest } : undefined;
  if (DOI.test(given)) return { source: 'doi', doi: given };

  const url = webUrl(given);
  if (url === undefined) return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const where = url.pathname;

  if (host === 'doi.org' || host === 'dx.doi.org') {
    const doi = decodeURIComponent(where.slice(1));
    if (DOI.test(doi)) return { source: 'doi', doi };
  }
  if (host === 'themoviedb.org') {
    const tv = /^\/tv\/(\d+)(?:-[^/]*)?(?:\/season\/(\d+)(?:\/episode\/(\d+))?)?/.exec(where);
    if (tv?.[1] !== undefined) {
      return {
        source: 'tmdb',
        type: 'tv',
        id: tv[1],
        ...(tv[2] === undefined ? {} : { season: tv[2] }),
        ...(tv[3] === undefined ? {} : { episode: tv[3] }),
      };
    }
    const movie = /^\/movie\/(\d+)/.exec(where);
    if (movie?.[1] !== undefined) return { source: 'tmdb', type: 'movie', id: movie[1] };
  }
  if (host === 'imdb.com' || host === 'm.imdb.com') {
    const title = /^\/title\/(tt\d+)/.exec(where);
    if (title?.[1] !== undefined) return { source: 'imdb', id: title[1], url: url.href };
  }
  if (host === 'musicbrainz.org') {
    const found = new RegExp(`^/(release-group|release)/(${UUID})`, 'i').exec(where);
    if (found?.[1] !== undefined && found[2] !== undefined) {
      return {
        source: 'musicbrainz',
        type: found[1] as 'release-group' | 'release',
        id: found[2].toLowerCase(),
      };
    }
  }
  if (host === 'openlibrary.org') {
    const edition = /^\/books\/(OL\d+M)\b/.exec(where);
    if (edition?.[1] !== undefined) return { source: 'openlibrary', olid: edition[1] };
  }
  if (host === 'openstreetmap.org') {
    const found = /^\/(node|way|relation)\/(\d+)/.exec(where);
    if (found?.[1] !== undefined && found[2] !== undefined) {
      return { source: 'osm', type: found[1] as 'node' | 'way' | 'relation', id: found[2] };
    }
  }
  return { source: 'page', url: url.href };
}
