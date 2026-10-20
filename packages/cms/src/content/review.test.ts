import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mf2 } from 'microformats-parser';

import type { Document } from './document.ts';
import { parseDocument } from './parser.ts';
import { discoverPostType, postLabel, postTypeOf } from './post-type.ts';
import { reviewHtml, reviewOf } from './review.ts';

function post(frontMatter: string, body = ''): Document {
  return parseDocument(`---\n${frontMatter}date: 2026-10-19T09:00:00Z\n---\n\n${body}\n`, {
    path: 'posts/2026-10-19-a-review.md',
  });
}

const MOVIE = [
  'rating: 4',
  'item:',
  '  kind: movie',
  '  name: "Dune: Part Two"',
  '  by: Denis Villeneuve',
  '  year: 2024',
  '  uid: https://www.themoviedb.org/movie/693134',
  '  url: https://www.imdb.com/title/tt15239678/',
  '  photo:',
  '    url: /uploads/2026/10/dune.jpg',
  '    alt: The poster for Dune Part Two',
  '  date: 2026-10-18',
  '',
].join('\n');

const TV = [
  'item:',
  '  kind: tv',
  '  name: Severance',
  '  by: Apple TV+',
  '  year: 2022',
  '  season: 2',
  '  episode: 3',
  '  date: 2026-10-12',
  '',
].join('\n');

const PLACE = [
  'rating: 5',
  'item:',
  '  kind: place',
  '  name: Blue Door Coffee',
  '  category: Coffee shop',
  '  street-address: 1234 Wealthy St SE',
  '  locality: Grand Rapids',
  '  region: MI',
  '  country-name: USA',
  '  url: https://bluedoor.example',
  '  date: 2026-10-14',
  '',
].join('\n');

interface Parsed {
  type?: string[];
  properties: Record<string, unknown[]>;
}

function parsedReview(html: string): Parsed {
  const parsed = mf2(`<div class="h-review">${html}</div>`, {
    baseUrl: 'https://blog.example/',
  });
  const [review] = parsed.items as Parsed[];
  assert.ok(review !== undefined);
  return review;
}

describe('the review front matter (TASK-432)', () => {
  it('reads every field of a movie, its rating and its day', () => {
    assert.deepEqual(reviewOf(post(MOVIE).extra), {
      rating: 4,
      item: {
        kind: 'movie',
        name: 'Dune: Part Two',
        by: 'Denis Villeneuve',
        year: '2024',
        uid: 'https://www.themoviedb.org/movie/693134',
        url: 'https://www.imdb.com/title/tt15239678/',
        photo: { url: '/uploads/2026/10/dune.jpg', alt: 'The poster for Dune Part Two' },
        date: '2026-10-18',
      },
    });
  });

  it('reads a TV show’s season and episode', () => {
    const review = reviewOf(post(TV).extra);
    assert.equal(review?.rating, undefined);
    assert.equal(review?.item.season, '2');
    assert.equal(review?.item.episode, '3');
  });

  it('reads a place’s address, website and what it is', () => {
    const item = reviewOf(post(PLACE).extra)?.item;
    assert.equal(item?.category, 'Coffee shop');
    assert.equal(item?.streetAddress, '1234 Wealthy St SE');
    assert.equal(item?.locality, 'Grand Rapids');
    assert.equal(item?.region, 'MI');
    assert.equal(item?.countryName, 'USA');
    assert.equal(item?.url, 'https://bluedoor.example');
    assert.equal(item?.date, '2026-10-14');
  });

  it('reads what an other is, its maker and an isbn or doi id', () => {
    const item = reviewOf(
      post(
        'item:\n  kind: other\n  name: Tot\n  category: App\n  by: The Iconfactory\n  uid: doi:10.1000/182\n',
      ).extra,
    )?.item;
    assert.deepEqual(item, {
      kind: 'other',
      name: 'Tot',
      category: 'App',
      by: 'The Iconfactory',
      uid: 'doi:10.1000/182',
    });
  });

  it('keeps only the fields the item’s kind has', () => {
    const item = reviewOf(
      post('item:\n  kind: movie\n  name: Heat\n  season: 2\n  locality: LA\n').extra,
    )?.item;
    assert.deepEqual(item, { kind: 'movie', name: 'Heat' });
  });

  it('reads an item with no kind as an other', () => {
    assert.equal(reviewOf(post('item:\n  name: Something\n').extra)?.item.kind, 'other');
  });

  it('is no review without an item name', () => {
    assert.equal(reviewOf(post('rating: 3\nitem:\n  kind: book\n').extra), undefined);
    assert.equal(reviewOf(post('rating: 3\n').extra), undefined);
  });

  it('reads a rating that is not a whole number from 1 to 5 as no rating', () => {
    for (const rating of ['0', '6', '4.5', 'great', '"4"']) {
      const review = reviewOf(post(`rating: ${rating}\nitem:\n  name: Heat\n`).extra);
      assert.equal(review?.rating, rating === '"4"' ? 4 : undefined, rating);
    }
  });
});

describe('post type discovery of a review (TASK-432)', () => {
  it('reports a review for a post with a reviewed item', () => {
    assert.equal(postTypeOf(post(MOVIE, 'Loud and long.')), 'review');
    assert.equal(
      postTypeOf(post('title: A long title\nitem:\n  name: Heat\n', 'Words.')),
      'review',
    );
  });

  it('reports a place review with the author’s photos as a review, not a photo', () => {
    assert.equal(
      postTypeOf(post(`${PLACE}photo:\n  - url: /uploads/2026/10/cup.jpg\n`, 'Good.')),
      'review',
    );
  });

  it('leaves a reply that names an item a reply', () => {
    assert.equal(
      discoverPostType({ 'in-reply-to': 'https://example.com/a/', item: 'Heat' }),
      'reply',
    );
  });

  it('labels an untitled review with no words by its item', () => {
    assert.equal(postLabel(post(MOVIE)), 'Review of Dune: Part Two');
  });
});

describe('reviewHtml (TASK-432)', () => {
  it('marks a movie up as a p-item h-cite with a p-rating and a p-best', () => {
    const review = reviewOf(post(MOVIE).extra);
    const html = reviewHtml(review);
    const parsed = parsedReview(html);
    assert.deepEqual(parsed.properties['rating'], ['4']);
    assert.deepEqual(parsed.properties['best'], ['5']);
    const [item] = parsed.properties['item'] as Parsed[];
    assert.deepEqual(item?.type, ['h-cite']);
    assert.deepEqual(item?.properties['name'], ['Dune: Part Two']);
    assert.deepEqual(item?.properties['author'], ['Denis Villeneuve']);
    assert.deepEqual(item?.properties['uid'], ['https://www.themoviedb.org/movie/693134']);
    assert.deepEqual(item?.properties['url'], ['https://www.imdb.com/title/tt15239678/']);
    assert.deepEqual(item?.properties['photo'], [
      {
        value: 'https://blog.example/uploads/2026/10/dune.jpg',
        alt: 'The poster for Dune Part Two',
      },
    ]);
  });

  it('says what was reviewed and the rating in words, with stars hidden from a screen reader', () => {
    const html = reviewHtml(reviewOf(post(MOVIE).extra));
    const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    assert.match(text, /Review of Dune: Part Two \(movie, 2024\), directed by Denis Villeneuve/);
    assert.match(text, /Watched on 18 October 2026/);
    assert.match(text, /Rated 4 out of 5/);
    assert.match(html, /<span class="review-stars" aria-hidden="true">★★★★☆<\/span>/);
  });

  it('marks a place up as a p-item h-card with its address', () => {
    const [item] = parsedReview(reviewHtml(reviewOf(post(PLACE).extra))).properties[
      'item'
    ] as Parsed[];
    assert.deepEqual(item?.type, ['h-card']);
    assert.deepEqual(item?.properties['name'], ['Blue Door Coffee']);
    assert.deepEqual(item?.properties['category'], ['Coffee shop']);
    assert.deepEqual(item?.properties['street-address'], ['1234 Wealthy St SE']);
    assert.deepEqual(item?.properties['locality'], ['Grand Rapids']);
    assert.deepEqual(item?.properties['region'], ['MI']);
    assert.deepEqual(item?.properties['country-name'], ['USA']);
    assert.deepEqual(item?.properties['url'], ['https://bluedoor.example']);
  });

  it('prints no stars and no rating for a review without one', () => {
    const html = reviewHtml(reviewOf(post(TV).extra));
    assert.doesNotMatch(html, /review-stars|p-rating|p-best/);
    assert.match(html.replace(/<[^>]+>/g, ''), /Season 2, episode 3/);
    assert.ok(parsedReview(html).properties['item'] !== undefined);
  });

  it('writes the picture absolute when given a base URL', () => {
    const html = reviewHtml(reviewOf(post(MOVIE).extra), { baseUrl: 'https://blog.example' });
    assert.match(
      html,
      /<img class="u-photo" src="https:\/\/blog\.example\/uploads\/2026\/10\/dune\.jpg"/,
    );
  });

  it('prints an isbn as words', () => {
    const html = reviewHtml(
      reviewOf(post('item:\n  kind: book\n  name: Piranesi\n  uid: isbn:9781635575637\n').extra),
    );
    assert.match(html, /<data class="u-uid" value="isbn:9781635575637">ISBN 9781635575637<\/data>/);
  });

  it('is empty for a post that reviews nothing', () => {
    assert.equal(reviewHtml(undefined), '');
  });
});
