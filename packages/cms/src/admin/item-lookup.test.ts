import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import matter from 'gray-matter';

import { jpegWithMetadata, pngWithMetadata } from '../__testing__/metadata.ts';
import type { Cms } from '../index.ts';
import { fieldsOf } from './__testing__/editor-form.ts';
import { csrfField, resolvePublic, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { text } from './__testing__/markup.ts';

const box = sandbox();

let png: Uint8Array;
let jpeg: Uint8Array;

interface Seen {
  readonly url: URL;
  readonly headers: Headers;
  readonly at: number;
}

/** Every request a test's lookups made, in order. */
let seen: Seen[] = [];

/** What each address answers; a test adds or replaces entries. */
let answers: Map<string, () => Response>;

function json(value: unknown, status = 200): () => Response {
  return () =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
}

function image(bytes: () => Uint8Array, type = 'image/png'): () => Response {
  return () => new Response(bytes(), { headers: { 'content-type': type } });
}

function html(body: string, status = 200): () => Response {
  return () => new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

function redirect(location: string): () => Response {
  return () => new Response(null, { status: 307, headers: { location } });
}

const ISBN_URL =
  'https://openlibrary.org/api/books?bibkeys=ISBN:9781635575637&format=json&jscmd=data';
const ISBN_COVER = 'https://covers.openlibrary.org/b/isbn/9781635575637-L.jpg?default=false';
const DOI_URL = 'https://api.crossref.org/works/10.1038%2Fnature14539';
const RELEASE_GROUP = '6e335887-60ba-38f0-95af-fae7774336bf';
const MB_URL = `https://musicbrainz.org/ws/2/release-group/${RELEASE_GROUP}?inc=artist-credits&fmt=json`;
const CAA_URL = `https://coverartarchive.org/release-group/${RELEASE_GROUP}/front-500`;
const ARCHIVE_URL = 'https://archive.org/download/mbid-1/front-500.jpg';
const TMDB_MOVIE =
  'https://api.themoviedb.org/3/movie/693134?append_to_response=credits&api_key=k3y';
const TMDB_TV = 'https://api.themoviedb.org/3/tv/95396?api_key=k3y';
const TMDB_FIND =
  'https://api.themoviedb.org/3/find/tt15239678?external_source=imdb_id&api_key=k3y';
const POSTER = 'https://image.tmdb.org/t/p/w500/dune.jpg';
const IMDB_PAGE = 'https://www.imdb.com/title/tt15239678/';
const GAME_PAGE = 'https://games.example/outer-wilds';

function standardAnswers(): Map<string, () => Response> {
  return new Map([
    [
      ISBN_URL,
      json({
        'ISBN:9781635575637': {
          url: 'http://openlibrary.org/books/OL28439584M/Piranesi',
          title: 'Piranesi',
          authors: [{ name: 'Susanna Clarke', url: 'http://openlibrary.org/authors/OL1387961A' }],
          publish_date: '2020',
        },
      }),
    ],
    [ISBN_COVER, image(() => png)],
    [
      DOI_URL,
      json({
        status: 'ok',
        message: {
          title: ['Deep learning'],
          author: [
            { given: 'Yann', family: 'LeCun' },
            { given: 'Yoshua', family: 'Bengio' },
            { given: 'Geoffrey', family: 'Hinton' },
          ],
          issued: { 'date-parts': [[2015, 5, 27]] },
          URL: 'https://doi.org/10.1038/nature14539',
          type: 'journal-article',
        },
      }),
    ],
    [
      MB_URL,
      json({
        title: 'In Rainbows',
        'first-release-date': '2007-10-10',
        'artist-credit': [{ name: 'Radiohead', joinphrase: '' }],
      }),
    ],
    [CAA_URL, redirect(ARCHIVE_URL)],
    [ARCHIVE_URL, image(() => jpeg, 'image/jpeg')],
    [
      TMDB_MOVIE,
      json({
        title: 'Dune: Part Two',
        release_date: '2024-02-27',
        homepage: 'https://www.dunemovie.com',
        poster_path: '/dune.jpg',
        credits: {
          crew: [
            { name: 'Denis Villeneuve', job: 'Director' },
            { name: 'Hans Zimmer', job: 'Original Music Composer' },
          ],
        },
      }),
    ],
    [
      TMDB_TV,
      json({
        name: 'Severance',
        first_air_date: '2022-02-17',
        networks: [{ name: 'Apple TV+' }],
        poster_path: '/dune.jpg',
      }),
    ],
    [TMDB_FIND, json({ movie_results: [{ id: 693134 }], tv_results: [] })],
    [POSTER, image(() => jpeg, 'image/jpeg')],
    // What IMDb answers a server: a challenge for a browser, with no title.
    [IMDB_PAGE, html('<!DOCTYPE html><html><head><title></title></head></html>', 202)],
    [
      GAME_PAGE,
      html(
        [
          '<html><head><title>Outer Wilds | Games</title>',
          '<meta property="og:image" content="/art.png">',
          '<script type="application/ld+json">',
          JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'VideoGame',
            name: 'Outer Wilds',
            creator: { '@type': 'Organization', name: 'Mobius Digital' },
            datePublished: '2019-05-28',
          }),
          '</script></head><body></body></html>',
        ].join(''),
      ),
    ],
    ['https://games.example/art.png', image(() => png)],
  ]);
}

const original = globalThis.fetch;

before(async () => {
  png = await pngWithMetadata();
  jpeg = await jpegWithMetadata();
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    seen.push({ url, headers: request.headers, at: Date.now() });
    const answer = answers.get(url.href);
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

interface Site {
  readonly cms: Cms;
  readonly agent: Browser;
  readonly contentDir: string;
  readonly dataDir: string;
}

async function site(): Promise<Site> {
  const contentDir = await box.dir('geekity-item-lookup-content-');
  const dataDir = await box.dir('geekity-item-lookup-data-');
  const cms = await box.site({ contentDir, dataDir, hostLookup: resolvePublic });
  return { cms, agent: await signedIn(cms), contentDir, dataDir };
}

let token = '';

/** Press Look up the way the editor's script does, and read its answer. */
async function lookUp(
  agent: Browser,
  fields: Record<string, string>,
): Promise<{ ok: boolean; message: string; fields: Record<string, string>; thumbnail: unknown }> {
  if (token === '') {
    token = csrfField(await (await agent.get('/admin/posts/new?kind=review')).text()) ?? '';
  }
  const response = await agent.post('/admin/item-lookup', {
    csrf_token: token,
    'item-kind': 'book',
    ...fields,
  });
  assert.equal(response.status, 200);
  return (await response.json()) as never;
}

async function setTmdbKey(agent: Browser, key: string): Promise<Response> {
  const page = await (await agent.get('/admin/settings')).text();
  return agent.post('/admin/settings/tmdb', { csrf_token: csrfField(page) ?? '', tmdb_key: key });
}

async function libraryAlt(contentDir: string, url: string): Promise<unknown> {
  const media = JSON.parse(
    await readFile(path.join(contentDir, '_data', 'media.json'), 'utf8'),
  ) as Record<string, unknown>;
  return media[url.slice('/uploads/'.length)];
}

describe('Look up on the review form (TASK-434)', () => {
  let one: Site;

  before(async () => {
    one = await site();
    token = '';
    assert.equal((await setTmdbKey(one.agent, 'k3y')).status, 303);
  });

  it('fills a book from its ISBN and copies its cover into the media library', async () => {
    const answer = await lookUp(one.agent, { 'item-uid': 'isbn:978-1-63557-563-7' });

    assert.equal(answer.ok, true);
    const { 'item-photo': photo, ...rest } = answer.fields;
    assert.deepEqual(rest, {
      'item-name': 'Piranesi',
      'item-by': 'Susanna Clarke',
      'item-year': '2020',
      'item-url': 'https://openlibrary.org/books/OL28439584M/Piranesi',
      'item-photo-alt': 'Book cover for Piranesi',
    });
    assert.match(photo ?? '', /^\/uploads\/\d{4}\/\d{2}\/piranesi-book-cover\.png$/);
    await stat(path.join(one.contentDir, ...(photo ?? '').split('/').slice(1)));
    assert.deepEqual(await libraryAlt(one.contentDir, photo ?? ''), {
      alt: 'Book cover for Piranesi',
    });
    assert.ok(
      seen.some(({ url }) => url.href === ISBN_COVER),
      'the cover came by its ISBN',
    );
    assert.match(
      answer.message,
      /Filled in the title, author, year, address and book cover from Open Library\./,
    );
  });

  it('fills a paper from its DOI, through Crossref', async () => {
    const answer = await lookUp(one.agent, {
      'item-kind': 'other',
      'item-uid': 'doi:10.1038/nature14539',
    });

    assert.deepEqual(answer.fields, {
      'item-name': 'Deep learning',
      'item-by': 'Yann LeCun, Yoshua Bengio, Geoffrey Hinton',
      'item-year': '2015',
      'item-url': 'https://doi.org/10.1038/nature14539',
    });
  });

  it('fills an album from MusicBrainz, with its art from the Cover Art Archive', async () => {
    const answer = await lookUp(one.agent, {
      'item-kind': 'album',
      'item-uid': `https://musicbrainz.org/release-group/${RELEASE_GROUP}`,
    });

    assert.equal(answer.fields['item-name'], 'In Rainbows');
    assert.equal(answer.fields['item-by'], 'Radiohead');
    assert.equal(answer.fields['item-year'], '2007');
    assert.equal(answer.fields['item-photo-alt'], 'Album art for In Rainbows');
    assert.match(answer.fields['item-photo'] ?? '', /in-rainbows-album-art\.jpg$/);
  });

  it('fills a movie from TMDb with its director, year and poster', async () => {
    const answer = await lookUp(one.agent, {
      'item-kind': 'movie',
      'item-uid': 'https://www.themoviedb.org/movie/693134-dune-part-two',
    });

    assert.equal(answer.fields['item-name'], 'Dune: Part Two');
    assert.equal(answer.fields['item-by'], 'Denis Villeneuve');
    assert.equal(answer.fields['item-year'], '2024');
    assert.equal(answer.fields['item-url'], 'https://www.dunemovie.com');
    assert.equal(answer.fields['item-photo-alt'], 'Poster for Dune: Part Two');
    assert.ok(
      seen.some(({ url }) => url.href === POSTER),
      'the poster came from TMDb’s images',
    );
  });

  it('fills a TV episode from a TMDb link, with its network, season and episode', async () => {
    const answer = await lookUp(one.agent, {
      'item-kind': 'tv',
      'item-uid': 'https://www.themoviedb.org/tv/95396-severance/season/2/episode/3',
    });

    assert.equal(answer.fields['item-name'], 'Severance');
    assert.equal(answer.fields['item-by'], 'Apple TV+');
    assert.equal(answer.fields['item-year'], '2022');
    assert.equal(answer.fields['item-season'], '2');
    assert.equal(answer.fields['item-episode'], '3');
  });

  it('finds an IMDb title through TMDb when the site has a key', async () => {
    const answer = await lookUp(one.agent, { 'item-kind': 'movie', 'item-uid': IMDB_PAGE });

    assert.equal(answer.fields['item-name'], 'Dune: Part Two');
    assert.equal(answer.fields['item-by'], 'Denis Villeneuve');
    assert.ok(!seen.some(({ url }) => url.hostname === 'www.imdb.com'), 'IMDb itself is not asked');
  });

  it('reads any other page’s JSON-LD and metadata, as a cited page is read', async () => {
    const answer = await lookUp(one.agent, { 'item-kind': 'other', 'item-uid': GAME_PAGE });

    assert.equal(answer.fields['item-name'], 'Outer Wilds');
    assert.equal(answer.fields['item-by'], 'Mobius Digital');
    assert.equal(answer.fields['item-year'], '2019');
    assert.equal(answer.fields['item-url'], GAME_PAGE);
    assert.equal(answer.fields['item-photo-alt'], 'Picture for Outer Wilds');
  });

  it('leaves every box the author has filled as it is, picture included', async () => {
    const answer = await lookUp(one.agent, {
      'item-kind': 'movie',
      'item-uid': 'https://www.themoviedb.org/movie/693134',
      'item-name': 'Dune Two',
      'item-year': '2023',
      'item-photo': 'https://example.com/mine.jpg',
    });

    assert.deepEqual(answer.fields, {
      'item-by': 'Denis Villeneuve',
      'item-url': 'https://www.dunemovie.com',
    });
    assert.ok(
      !seen.some(({ url }) => url.href === POSTER),
      'no poster is fetched over the author’s',
    );
  });

  it('takes the alt text the author wrote for the copied picture', async () => {
    const answer = await lookUp(one.agent, {
      'item-uid': 'isbn:9781635575637',
      'item-photo-alt': 'A marble statue in a flooded hall',
    });

    assert.equal(answer.fields['item-photo-alt'], undefined);
    assert.deepEqual(await libraryAlt(one.contentDir, answer.fields['item-photo'] ?? ''), {
      alt: 'A marble statue in a flooded hall',
    });
  });

  it('says what went wrong when nothing is found, and fills nothing', async () => {
    answers.set(ISBN_URL.replace('9781635575637', '9780000000002'), json({}));
    for (const [uid, message] of [
      ['isbn:9780000000002', /^Open Library has no book with the ISBN 9780000000002\.$/],
      ['doi:10.9999/missing', /^Could not look that up on Crossref: fetch failed\.$/],
      ['not an id', /^Look up reads an ISBN, a DOI or a web address, not not an id\.$/],
      ['', /^Type an ISBN, a DOI or a link in the box first/],
    ] as const) {
      const answer = await lookUp(one.agent, { 'item-uid': uid });
      assert.equal(answer.ok, false, uid);
      assert.deepEqual(answer.fields, {}, uid);
      assert.match(answer.message, message, uid);
    }
  });

  it('tells MusicBrainz who is asking, and asks it no more than once a second', async () => {
    const uid = `https://musicbrainz.org/release-group/${RELEASE_GROUP}`;
    await Promise.all([
      lookUp(one.agent, {
        'item-kind': 'album',
        'item-uid': uid,
        'item-photo': 'https://example.com/a.jpg',
      }),
      lookUp(one.agent, {
        'item-kind': 'album',
        'item-uid': uid,
        'item-photo': 'https://example.com/a.jpg',
      }),
    ]);

    const asked = seen.filter(({ url }) => url.hostname === 'musicbrainz.org');
    assert.equal(asked.length, 2);
    for (const { headers } of asked) {
      assert.match(headers.get('user-agent') ?? '', /^Geekity\/[\d.]+ \(\+https:\/\/\S+\)$/);
    }
    const [first, second] = asked;
    assert.ok((second?.at ?? 0) - (first?.at ?? 0) >= 990, 'a second apart');
  });
});

describe('Look up without a TMDb key', () => {
  let one: Site;

  before(async () => {
    one = await site();
    token = '';
  });

  it('says how to add a key for a TMDb link, and asks nobody', async () => {
    const answer = await lookUp(one.agent, {
      'item-kind': 'movie',
      'item-uid': 'https://www.themoviedb.org/movie/693134',
    });

    assert.equal(answer.ok, false);
    assert.match(answer.message, /needs a TMDb API key\. Add one on Settings > General/);
    assert.deepEqual(seen, []);
  });

  it('reads an IMDb page itself, and names the key when it has nothing to give', async () => {
    const answer = await lookUp(one.agent, { 'item-kind': 'movie', 'item-uid': IMDB_PAGE });

    assert.equal(answer.ok, false);
    assert.match(answer.message, /names nothing Look up can fill in\./);
    assert.match(answer.message, /with a TMDb API key on Settings > General/);
  });
});

describe('the TMDb key on Settings > General', () => {
  it('is saved to data/tmdb.json, never printed, and removed again', async () => {
    const { agent, dataDir } = await site();
    const before = text(await (await agent.get('/admin/settings')).text());
    assert.match(before, /Movies and TV shows/);
    assert.match(before, /This site has no TMDb key\./);

    assert.equal((await setTmdbKey(agent, 'abcdef0123456789')).status, 303);
    assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'tmdb.json'), 'utf8')), {
      key: 'abcdef0123456789',
    });
    assert.equal((await stat(path.join(dataDir, 'tmdb.json'))).mode & 0o777, 0o600);
    const page = await (await agent.get('/admin/settings')).text();
    assert.doesNotMatch(page, /abcdef0123456789/);
    assert.match(text(page), /Key …6789\./);

    const remove = await agent.post('/admin/settings/tmdb', {
      csrf_token: csrfField(page) ?? '',
      action: 'remove',
    });
    assert.equal(remove.status, 303);
    assert.match(text(await (await agent.get('/admin/settings')).text()), /no TMDb key/);
  });
});

describe('Look up with no script', () => {
  it('draws the form again with the empty boxes filled, and saves nothing', async () => {
    const { agent, contentDir } = await site();
    const blank = await (await agent.get('/admin/posts/new?kind=review')).text();
    const response = await agent.post('/admin/posts/new', {
      ...Object.fromEntries(fieldsOf(blank)),
      csrf_token: csrfField(blank) ?? '',
      kind: 'review',
      'item-kind': 'book',
      'item-uid': 'isbn:9781635575637',
      'item-by': 'S. Clarke',
      body: 'Strange and lovely.',
      'lookup-item': '1',
    });

    assert.equal(response.status, 200);
    const page = await response.text();
    const fields = Object.fromEntries(fieldsOf(page));
    assert.equal(fields['item-name'], 'Piranesi');
    assert.equal(fields['item-by'], 'S. Clarke');
    assert.equal(fields['body'], 'Strange and lovely.');
    assert.equal(fields['item-photo-alt'], 'Book cover for Piranesi');
    const status =
      /<p class="([^"]*)" id="editor-item-lookup-status" role="status">([^<]*)<\/p>/.exec(page);
    assert.match(
      status?.[2] ?? '',
      /Filled in the title, year, address and book cover from Open Library\./,
    );
    assert.doesNotMatch(status?.[1] ?? '', /text-error/);
    assert.match(page, /id="editor-item-photo-preview" src="[^"]+"/);
    await assert.rejects(stat(path.join(contentDir, 'posts')));
  });

  it('draws a failed lookup beside the button with the form as it was', async () => {
    const { agent } = await site();
    const blank = await (await agent.get('/admin/posts/new?kind=review')).text();
    const submitted = {
      ...Object.fromEntries(fieldsOf(blank)),
      csrf_token: csrfField(blank) ?? '',
      kind: 'review',
      'item-kind': 'movie',
      'item-uid': 'https://www.themoviedb.org/movie/693134',
      'item-name': 'Dune',
      body: 'Sand.',
    };
    const response = await agent.post('/admin/posts/new', { ...submitted, 'lookup-item': '1' });

    const page = await response.text();
    const status =
      /<p class="([^"]*)" id="editor-item-lookup-status" role="status">([^<]*)<\/p>/.exec(page);
    assert.match(status?.[1] ?? '', /text-error/);
    assert.match(status?.[2] ?? '', /needs a TMDb API key/);
    const fields = Object.fromEntries(fieldsOf(page));
    for (const name of ['item-uid', 'item-name', 'item-by', 'item-year', 'item-photo', 'body']) {
      assert.equal(fields[name], submitted[name as keyof typeof submitted] ?? '', name);
    }
  });

  it('saves the ID box as typed', async () => {
    const { agent, contentDir } = await site();
    const blank = await (await agent.get('/admin/posts/new?kind=review')).text();
    const response = await agent.post('/admin/posts/new', {
      ...Object.fromEntries(fieldsOf(blank)),
      csrf_token: csrfField(blank) ?? '',
      kind: 'review',
      slug: 'dune',
      'item-kind': 'movie',
      'item-uid': 'https://www.imdb.com/title/tt15239678/',
      'item-name': 'Dune: Part Two',
      body: 'Sand.',
      action: 'publish',
    });

    assert.equal(response.status, 303, await response.clone().text());
    assert.ok(
      !seen.some(({ url }) => url.hostname === 'api.themoviedb.org'),
      'a save looks nothing up',
    );
    const [file] = await import('node:fs/promises').then(({ readdir }) =>
      readdir(path.join(contentDir, 'posts')),
    );
    const { data } = matter(await readFile(path.join(contentDir, 'posts', file ?? ''), 'utf8'));
    assert.equal(
      (data['item'] as Record<string, unknown>)['uid'],
      'https://www.imdb.com/title/tt15239678/',
    );
  });
});
