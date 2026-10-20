import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { pngWithMetadata } from '../__testing__/metadata.ts';
import type { Cms } from '../index.ts';
import { csrfField, resolvePublic, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();

let png: Uint8Array;

interface Seen {
  readonly url: URL;
  readonly headers: Headers;
  readonly at: number;
}

let seen: Seen[] = [];

let answers: Map<string, () => Response>;

function json(value: unknown, status = 200): () => Response {
  return () =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
}

function image(): () => Response {
  return () => new Response(png, { headers: { 'content-type': 'image/png' } });
}

const RELEASE_GROUP = '6e335887-60ba-38f0-95af-fae7774336bf';
const OL_SEARCH = 'https://openlibrary.org/search.json';
const OL_BOOK = 'https://openlibrary.org/api/books';
const TMDB_SEARCH_MOVIE = 'https://api.themoviedb.org/3/search/movie';
const TMDB_SEARCH_TV = 'https://api.themoviedb.org/3/search/tv';
const MB_SEARCH = 'https://musicbrainz.org/ws/2/release-group';
const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_LOOKUP = 'https://nominatim.openstreetmap.org/lookup';

const BLUE_BOTTLE = {
  osm_type: 'node',
  osm_id: 9512186220,
  category: 'amenity',
  type: 'cafe',
  name: 'Blue Bottle Coffee',
  display_name: 'Blue Bottle Coffee, 480, 9th Street, Oakland, California, 94607, United States',
  address: {
    amenity: 'Blue Bottle Coffee',
    house_number: '480',
    road: '9th Street',
    city: 'Oakland',
    state: 'California',
    postcode: '94607',
    country: 'United States',
  },
  extratags: { website: 'https://bluebottlecoffee.com/' },
};

function standardAnswers(): Map<string, () => Response> {
  return new Map([
    [
      OL_SEARCH,
      json({
        docs: [
          {
            key: '/works/OL20893680W',
            title: 'Piranesi',
            author_name: ['Susanna Clarke'],
            first_publish_year: 2020,
            cover_i: 10226290,
            editions: {
              docs: [
                {
                  key: '/books/OL61022665M',
                  cover_i: 15155469,
                  isbn: ['1526622416', '9781526622419'],
                },
              ],
            },
          },
          {
            key: '/works/OL12523946W',
            title: 'Piranesi',
            author_name: ['Arthur Samuel'],
            first_publish_year: 1910,
            editions: { docs: [{ key: '/books/OL18759568M' }] },
          },
        ],
      }),
    ],
    ['https://covers.openlibrary.org/b/id/15155469-M.jpg', image()],
    [
      OL_BOOK,
      json({
        'ISBN:9781526622419': {
          url: 'https://openlibrary.org/books/OL61022665M/Piranesi',
          title: 'Piranesi',
          authors: [{ name: 'Susanna Clarke' }],
          publish_date: '2020',
        },
      }),
    ],
    ['https://covers.openlibrary.org/b/isbn/9781526622419-L.jpg?default=false', image()],
    [
      TMDB_SEARCH_MOVIE,
      json({
        results: [
          {
            id: 693134,
            title: 'Dune: Part Two',
            release_date: '2024-02-27',
            poster_path: '/a.jpg',
          },
          { id: 438631, title: 'Dune', release_date: '2021-09-15', poster_path: null },
        ],
      }),
    ],
    [
      'https://api.themoviedb.org/3/movie/693134/credits',
      json({ crew: [{ name: 'Denis Villeneuve', job: 'Director' }] }),
    ],
    [
      'https://api.themoviedb.org/3/movie/438631/credits',
      json({ crew: [{ name: 'Denis Villeneuve', job: 'Director' }] }),
    ],
    ['https://image.tmdb.org/t/p/w92/a.jpg', image()],
    [
      TMDB_SEARCH_TV,
      json({ results: [{ id: 95396, name: 'Severance', first_air_date: '2022-02-17' }] }),
    ],
    ['https://api.themoviedb.org/3/tv/95396', json({ networks: [{ name: 'Apple TV+' }] })],
    [
      MB_SEARCH,
      json({
        'release-groups': [
          {
            id: RELEASE_GROUP,
            title: 'In Rainbows',
            'first-release-date': '2007-10-10',
            'artist-credit': [{ name: 'Radiohead', joinphrase: '' }],
          },
        ],
      }),
    ],
    [`https://coverartarchive.org/release-group/${RELEASE_GROUP}/front-250`, image()],
    [NOMINATIM_SEARCH, json([BLUE_BOTTLE])],
    [NOMINATIM_LOOKUP, json([BLUE_BOTTLE])],
  ]);
}

const original = globalThis.fetch;

before(async () => {
  png = await pngWithMetadata();
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    seen.push({ url, headers: request.headers, at: Date.now() });
    const answer = answers.get(url.href) ?? answers.get(`${url.origin}${url.pathname}`);
    return answer === undefined
      ? Promise.reject(new TypeError('fetch failed'))
      : Promise.resolve(answer());
  }) as typeof fetch;
});

beforeEach(() => {
  seen = [];
  answers = standardAnswers();
});

after(async () => {
  globalThis.fetch = original;
  await box.cleanup();
});

interface Match {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly source: string;
  readonly thumbnail: string | null;
}

interface Found {
  readonly ok: boolean;
  readonly message: string;
  readonly matches: readonly Match[];
  readonly credit: string;
}

async function signedInSite(): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-item-search-content-');
  const dataDir = await box.dir('geekity-item-search-data-');
  const cms = await box.site({ contentDir, dataDir, hostLookup: resolvePublic });
  return { cms, agent: await signedIn(cms) };
}

async function search(agent: Browser, kind: string, query: string): Promise<Found> {
  const response = await agent.get(
    `/admin/item-search?${new URLSearchParams({ kind, q: query }).toString()}`,
  );
  assert.equal(response.status, 200);
  return (await response.json()) as Found;
}

function asked(prefix: string): Seen[] {
  return seen.filter(({ url }) => url.href.startsWith(prefix));
}

async function setTmdbKey(agent: Browser, key: string): Promise<void> {
  const page = await (await agent.get('/admin/settings')).text();
  const response = await agent.post('/admin/settings/tmdb', {
    csrf_token: csrfField(page) ?? '',
    tmdb_key: key,
  });
  assert.equal(response.status, 303);
}

describe('Find the item by its title (TASK-435)', () => {
  let agent: Browser;

  before(async () => {
    ({ agent } = await signedInSite());
    await setTmdbKey(agent, 'k3y');
  });

  it('lists books from Open Library’s search, each with its cover, author, year and an ISBN', async () => {
    const found = await search(agent, 'book', 'piranesi');

    assert.equal(found.ok, true);
    const [request] = asked(OL_SEARCH);
    assert.equal(request?.url.searchParams.get('q'), 'piranesi');
    assert.deepEqual(
      found.matches.map(({ thumbnail, ...match }) => match),
      [
        {
          id: 'isbn:9781526622419',
          name: 'Piranesi',
          detail: 'Susanna Clarke · 2020',
          source: 'Open Library',
        },
        {
          id: 'https://openlibrary.org/books/OL18759568M',
          name: 'Piranesi',
          detail: 'Arthur Samuel · 1910',
          source: 'Open Library',
        },
      ],
    );
    assert.match(found.matches[0]?.thumbnail ?? '', /^data:image\/png;base64,/);
    assert.equal(found.matches[1]?.thumbnail, null);
  });

  it('lists movies from TMDb with their director, and TV shows with their network', async () => {
    const movies = await search(agent, 'movie', 'dune');
    assert.deepEqual(
      movies.matches.map(({ id, name, detail, source }) => [id, name, detail, source]),
      [
        [
          'https://www.themoviedb.org/movie/693134',
          'Dune: Part Two',
          'Denis Villeneuve · 2024',
          'TMDb',
        ],
        ['https://www.themoviedb.org/movie/438631', 'Dune', 'Denis Villeneuve · 2021', 'TMDb'],
      ],
    );
    assert.match(movies.matches[0]?.thumbnail ?? '', /^data:image\/png;base64,/);
    assert.equal(asked(TMDB_SEARCH_MOVIE)[0]?.url.searchParams.get('query'), 'dune');

    const shows = await search(agent, 'tv', 'severance');
    assert.deepEqual(
      shows.matches.map(({ id, detail }) => [id, detail]),
      [['https://www.themoviedb.org/tv/95396', 'Apple TV+ · 2022']],
    );
  });

  it('lists albums from MusicBrainz release groups, with their art', async () => {
    const found = await search(agent, 'album', 'in rainbows');

    assert.deepEqual(
      found.matches.map(({ id, name, detail, source }) => [id, name, detail, source]),
      [
        [
          `https://musicbrainz.org/release-group/${RELEASE_GROUP}`,
          'In Rainbows',
          'Radiohead · 2007',
          'MusicBrainz',
        ],
      ],
    );
    assert.match(found.matches[0]?.thumbnail ?? '', /^data:image\/png;base64,/);
    const [request] = asked(MB_SEARCH);
    assert.match(request?.url.searchParams.get('query') ?? '', /in rainbows/);
    assert.match(request?.headers.get('user-agent') ?? '', /^Geekity\/[\d.]+ \(\+https:\/\/\S+\)$/);
  });

  it('lists places from OpenStreetMap with their address, and credits its data', async () => {
    const found = await search(agent, 'place', 'blue bottle oakland');

    assert.deepEqual(
      found.matches.map(({ id, name, detail, source, thumbnail }) => [
        id,
        name,
        detail,
        source,
        thumbnail,
      ]),
      [
        [
          'https://www.openstreetmap.org/node/9512186220',
          'Blue Bottle Coffee',
          '480 9th Street, Oakland, California',
          'OpenStreetMap',
          null,
        ],
      ],
    );
    assert.match(found.credit, /OpenStreetMap contributors/);
    const [request] = asked(NOMINATIM_SEARCH);
    assert.equal(request?.url.searchParams.get('q'), 'blue bottle oakland');
    assert.match(request?.headers.get('user-agent') ?? '', /^Geekity\/[\d.]+ \(\+https:\/\/\S+\)$/);
  });

  it('asks Nominatim at most once a second, and never twice for the same search', async () => {
    await Promise.all([
      search(agent, 'place', 'ferry building'),
      search(agent, 'place', 'lake merritt'),
    ]);
    await search(agent, 'place', 'Ferry Building');

    const requests = asked(NOMINATIM_SEARCH);
    assert.equal(requests.length, 2);
    const [first, second] = requests;
    assert.ok((second?.at ?? 0) - (first?.at ?? 0) >= 990, 'a second apart');
  });

  it('says why when nothing matches, or the search cannot be made', async () => {
    answers.set(OL_SEARCH, json({ docs: [] }));
    const none = await search(agent, 'book', 'zzzzzz');
    assert.equal(none.ok, true);
    assert.deepEqual(none.matches, []);

    answers.set(MB_SEARCH, json({}, 503));
    const busy = await search(agent, 'album', 'anything at all');
    assert.equal(busy.ok, false);
    assert.match(busy.message, /MusicBrainz is busy/);

    const other = await search(agent, 'other', 'outer wilds');
    assert.equal(other.ok, false);
    assert.match(other.message, /paste a link/i);

    const empty = await search(agent, 'book', '  ');
    assert.equal(empty.ok, false);
    assert.match(empty.message, /Type a title/);
  });
});

describe('Find a movie without a TMDb key', () => {
  it('says how to add a key, and asks nobody', async () => {
    const { agent } = await signedInSite();
    const found = await search(agent, 'movie', 'dune');

    assert.equal(found.ok, false);
    assert.match(found.message, /needs a TMDb API key\. Add one on Settings > General/);
    assert.deepEqual(seen, []);
  });
});

describe('Picking a match', () => {
  let agent: Browser;
  let token: string;

  before(async () => {
    ({ agent } = await signedInSite());
    token = csrfField(await (await agent.get('/admin/posts/new?kind=review')).text()) ?? '';
  });

  async function pick(
    fields: Record<string, string>,
  ): Promise<{ ok: boolean; message: string; fields: Record<string, string> }> {
    const response = await agent.post('/admin/item-lookup', { csrf_token: token, ...fields });
    assert.equal(response.status, 200);
    return (await response.json()) as never;
  }

  it('fills the ID, the details and the picture as Look up does', async () => {
    const answer = await pick({ 'item-kind': 'book', 'item-pick': 'isbn:9781526622419' });

    assert.equal(answer.ok, true);
    const { 'item-photo': photo, ...rest } = answer.fields;
    assert.deepEqual(rest, {
      'item-uid': 'isbn:9781526622419',
      'item-name': 'Piranesi',
      'item-by': 'Susanna Clarke',
      'item-year': '2020',
      'item-url': 'https://openlibrary.org/books/OL61022665M/Piranesi',
      'item-photo-alt': 'Book cover for Piranesi',
    });
    assert.match(photo ?? '', /piranesi-book-cover\.png$/);
    assert.match(answer.message, /Filled in the ISBN, title, author, year, address and book cover/);
  });

  it('looks up a book with no ISBN by its Open Library edition', async () => {
    answers.set(
      'https://openlibrary.org/api/books?bibkeys=OLID:OL18759568M&format=json&jscmd=data',
      json({
        'OLID:OL18759568M': {
          url: 'https://openlibrary.org/books/OL18759568M/Piranesi',
          title: 'Piranesi',
          authors: [{ name: 'Arthur Samuel' }],
          publish_date: '1910',
        },
      }),
    );
    answers.set('https://covers.openlibrary.org/b/olid/OL18759568M-L.jpg?default=false', image());
    const answer = await pick({
      'item-kind': 'book',
      'item-pick': 'https://openlibrary.org/books/OL18759568M',
    });

    assert.equal(answer.fields['item-name'], 'Piranesi');
    assert.equal(answer.fields['item-by'], 'Arthur Samuel');
    assert.equal(answer.fields['item-year'], '1910');
    assert.equal(answer.fields['item-uid'], 'https://openlibrary.org/books/OL18759568M');
    assert.match(answer.fields['item-photo'] ?? '', /piranesi-book-cover/);
  });

  it('keeps an ID the author typed', async () => {
    const answer = await pick({
      'item-kind': 'book',
      'item-uid': 'isbn:1526622416',
      'item-photo': 'https://example.com/mine.jpg',
      'item-pick': 'isbn:9781526622419',
    });

    assert.equal(answer.fields['item-uid'], undefined);
    assert.equal(answer.fields['item-name'], 'Piranesi');
  });

  it('fills a place’s name, address and website from OpenStreetMap, leaving typed boxes alone', async () => {
    const answer = await pick({
      'item-kind': 'place',
      'item-region': 'CA',
      'item-pick': 'https://www.openstreetmap.org/node/9512186220',
    });

    assert.equal(answer.ok, true);
    assert.deepEqual(answer.fields, {
      'item-uid': 'https://www.openstreetmap.org/node/9512186220',
      'item-name': 'Blue Bottle Coffee',
      'item-url': 'https://bluebottlecoffee.com/',
      'item-street-address': '480 9th Street',
      'item-locality': 'Oakland',
      'item-country-name': 'United States',
    });
    const [request] = asked(NOMINATIM_LOOKUP);
    assert.equal(request?.url.searchParams.get('osm_ids'), 'N9512186220');
    assert.match(answer.message, /from OpenStreetMap\.$/);
  });
});

describe('the find box on the review form', () => {
  it('is drawn hidden for a script to show, for every kind but Other', async () => {
    const { agent } = await signedInSite();
    const page = await (await agent.get('/admin/posts/new?kind=review')).text();

    const wrapper = /<div class="([^"]*)">\s*<div id="editor-item-find"[^>]*\shidden[\s>]/.exec(
      page,
    );
    assert.ok(wrapper, 'the box starts hidden');
    for (const kind of ['book', 'movie', 'tv', 'album', 'place']) {
      assert.match(wrapper[1] ?? '', new RegExp(`\\[value=${kind}\\]:checked`), kind);
    }
    assert.doesNotMatch(wrapper[1] ?? '', /data-as-other/);
    assert.match(page, /Not here\? Paste a link in the box below and press Look up\./);
    const find = page.slice(
      page.indexOf('id="editor-item-find"'),
      page.indexOf('id="editor-item-lookup"'),
    );
    assert.doesNotMatch(find, /<input[^>]*\sname=/, 'the search posts nothing with the form');
  });
});
