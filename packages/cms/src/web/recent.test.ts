import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Document } from '../content/document.ts';
import { RECENT_POSTS, recentPosts, startOfMonth } from './recent.ts';

/** A post dated `date`, with just enough of a document to be listed. */
function post(date: string): Document {
  const slug = date.slice(0, 10);
  return {
    type: 'post',
    path: `posts/${slug}.md`,
    slug,
    permalink: `/posts/${slug}/`,
    title: slug,
    date,
    tags: [],
    categories: [],
    draft: false,
    extra: {},
    body: '',
    html: '',
    hash: 'a'.repeat(64),
  };
}

/**
 * A source over a fixed archive, newest first, answering the two queries the
 * rule asks: everything since an instant, and the newest few.
 */
function archive(dates: readonly string[], now: string) {
  const posts = [...dates].sort().reverse().map(post);
  const asked: string[] = [];

  return {
    asked,
    source: {
      now: () => new Date(now),
      listPosts: (options: { limit?: number | undefined } = {}) => {
        asked.push(`listPosts:${String(options.limit ?? 'all')}`);
        return options.limit === undefined ? posts : posts.slice(0, options.limit);
      },
      listPostsSince: (instant: string) => {
        asked.push(`since:${instant}`);
        return posts.filter((entry) => (entry.date ?? '') >= instant);
      },
    },
  };
}

/** The titles, which are the dates these posts are named after. */
function titles(documents: readonly Document[]): string[] {
  return documents.map((document) => document.title);
}

describe('the front page’s recent posts (AC #4)', () => {
  it('is the current month once the month holds five', () => {
    const { source } = archive(
      [
        '2026-09-01T09:00:00Z',
        '2026-09-02T09:00:00Z',
        '2026-09-03T09:00:00Z',
        '2026-09-04T09:00:00Z',
        '2026-09-05T09:00:00Z',
        '2026-08-31T09:00:00Z',
      ],
      '2026-09-13T12:00:00Z',
    );

    assert.deepEqual(titles(recentPosts(source)), [
      '2026-09-05',
      '2026-09-04',
      '2026-09-03',
      '2026-09-02',
      '2026-09-01',
    ]);
  });

  it('is the newest five when the month holds fewer', () => {
    const { source, asked } = archive(
      [
        '2026-09-10T09:00:00Z',
        '2026-08-01T09:00:00Z',
        '2026-07-01T09:00:00Z',
        '2026-06-01T09:00:00Z',
        '2026-05-01T09:00:00Z',
        '2026-04-01T09:00:00Z',
      ],
      '2026-09-13T12:00:00Z',
    );

    assert.deepEqual(titles(recentPosts(source)), [
      '2026-09-10',
      '2026-08-01',
      '2026-07-01',
      '2026-06-01',
      '2026-05-01',
    ]);
    assert.deepEqual(
      asked,
      ['since:2026-09-01T00:00:00.000Z', `listPosts:${String(RECENT_POSTS)}`],
      'two bounded queries, never a walk of the archive',
    );
  });

  it('is everything there is on a site with fewer than five posts', () => {
    const { source } = archive(
      ['2026-09-10T09:00:00Z', '2026-01-01T09:00:00Z'],
      '2026-09-13T12:00:00Z',
    );

    assert.deepEqual(titles(recentPosts(source)), ['2026-09-10', '2026-01-01']);
  });

  it('measures the month in UTC, which is what the dates are stored in', () => {
    assert.equal(startOfMonth(new Date('2026-09-13T12:00:00Z')), '2026-09-01T00:00:00.000Z');
    // Eight in the evening on the 31st in Chicago is already the 1st in UTC.
    assert.equal(startOfMonth(new Date('2026-09-01T01:00:00Z')), '2026-09-01T00:00:00.000Z');
    assert.equal(startOfMonth(new Date('2026-01-15T00:00:00Z')), '2026-01-01T00:00:00.000Z');
  });
});
