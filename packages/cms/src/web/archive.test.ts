import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Document } from '../content/document.ts';
import { archiveMonths, archiveOpen } from './archive.ts';

/** A post dated `date`, with just enough of a document to be listed. */
function post(date: string, title = date.slice(0, 10)): Document {
  const slug = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
  return {
    type: 'post',
    path: `posts/${slug}.md`,
    slug,
    permalink: `/posts/${slug}/`,
    title,
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

/** A page carrying whatever front matter a test is about. */
function page(extra: Record<string, unknown>): Document {
  return { ...post('2026-09-01T09:00:00Z'), type: 'page', extra };
}

/** Every month of an archive as `Month Year: title, title`. */
function printed(months: ReturnType<typeof archiveMonths>): string[] {
  return months.map(
    (month) => `${month.month}: ${month.posts.map((entry) => entry.title).join(', ')}`,
  );
}

describe('the months an archive page lists', () => {
  it('groups the posts it is given by month, newest month first', () => {
    const months = archiveMonths(
      [
        post('2026-09-10T09:00:00Z', 'Alpha'),
        post('2026-09-02T09:00:00Z', 'Beta'),
        post('2026-08-18T09:00:00Z', 'Gamma'),
        post('2025-12-31T09:00:00Z', 'Delta'),
      ],
      'UTC',
    );

    assert.deepEqual(printed(months), [
      'September 2026: Alpha, Beta',
      'August 2026: Gamma',
      'December 2025: Delta',
    ]);
  });

  it('gives each post the title and the URL a link is made of', () => {
    const [september] = archiveMonths([post('2026-09-10T09:00:00Z', 'Alpha')], 'UTC');

    assert.deepEqual(september?.posts, [
      { title: 'Alpha', url: '/posts/alpha/', date: new Date('2026-09-10T09:00:00Z') },
    ]);
  });

  it('reads the calendar of the site’s own zone, not of UTC (decision-11)', () => {
    // Half past midnight UTC on the first of September is still August the
    // thirty-first in Chicago, and the heading a reader sees says so.
    const posts = [post('2026-09-01T00:30:00Z', 'Late')];

    assert.deepEqual(printed(archiveMonths(posts, 'UTC')), ['September 2026: Late']);
    assert.deepEqual(printed(archiveMonths(posts, 'America/Chicago')), ['August 2026: Late']);
  });

  it('leaves out a post with no date at all rather than heading a month with nothing', () => {
    const undated: Document = { ...post('2026-09-10T09:00:00Z', 'Undated'), date: undefined };

    assert.deepEqual(printed(archiveMonths([undated], 'UTC')), []);
  });

  it('is empty for an archive with nothing in it', () => {
    assert.deepEqual(archiveMonths([], 'UTC'), []);
  });
});

describe('the front matter an archive page opts in with', () => {
  it('is `archive: true` and nothing else', () => {
    assert.equal(archiveOpen(page({ archive: true })), true);
    assert.equal(archiveOpen(page({ archive: 'yes' })), false);
    assert.equal(archiveOpen(page({ archive: false })), false);
    assert.equal(archiveOpen(page({})), false);
  });
});
