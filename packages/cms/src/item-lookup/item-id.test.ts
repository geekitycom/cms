import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseItemId } from './item-id.ts';

describe('what an item ID names (TASK-434)', () => {
  it('reads ISBNs and DOIs with or without their prefix', () => {
    assert.deepEqual(parseItemId('isbn:978-1-63557-563-7'), {
      source: 'isbn',
      isbn: '9781635575637',
    });
    assert.deepEqual(parseItemId('0 306 40615 x'), { source: 'isbn', isbn: '030640615X' });
    assert.deepEqual(parseItemId('DOI:10.1038/nature14539'), {
      source: 'doi',
      doi: '10.1038/nature14539',
    });
    assert.deepEqual(parseItemId('10.1038/nature14539'), {
      source: 'doi',
      doi: '10.1038/nature14539',
    });
    assert.deepEqual(parseItemId('https://doi.org/10.1038/nature14539'), {
      source: 'doi',
      doi: '10.1038/nature14539',
    });
    assert.equal(parseItemId('isbn:12345'), undefined);
    assert.equal(parseItemId('a book'), undefined);
  });

  it('knows TMDb, IMDb and MusicBrainz links, and takes any other page', () => {
    assert.deepEqual(parseItemId('https://www.themoviedb.org/movie/693134-dune-part-two'), {
      source: 'tmdb',
      type: 'movie',
      id: '693134',
    });
    assert.deepEqual(parseItemId('https://www.themoviedb.org/tv/95396/season/2'), {
      source: 'tmdb',
      type: 'tv',
      id: '95396',
      season: '2',
    });
    assert.deepEqual(parseItemId('https://m.imdb.com/title/tt15239678/?ref_=x'), {
      source: 'imdb',
      id: 'tt15239678',
      url: 'https://m.imdb.com/title/tt15239678/?ref_=x',
    });
    assert.deepEqual(
      parseItemId('https://musicbrainz.org/release/1A33443C-3FFF-450F-8298-EFBC65659D32'),
      { source: 'musicbrainz', type: 'release', id: '1a33443c-3fff-450f-8298-efbc65659d32' },
    );
    assert.deepEqual(
      parseItemId('https://musicbrainz.org/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711'),
      {
        source: 'page',
        url: 'https://musicbrainz.org/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711',
      },
    );
    assert.deepEqual(parseItemId('https://www.openstreetmap.org/way/123456#map=19/37.8/-122.2'), {
      source: 'osm',
      type: 'way',
      id: '123456',
    });
    assert.deepEqual(parseItemId('https://openlibrary.org/books/OL18759568M/Piranesi'), {
      source: 'openlibrary',
      olid: 'OL18759568M',
    });
    assert.equal(parseItemId('ftp://example.com/x'), undefined);
  });
});
