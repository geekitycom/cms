import { calendarDayIn, DEFAULT_TIMEZONE } from '../content/time.ts';
import type { Document } from '../content/document.ts';
import { postLabel } from '../content/post-type.ts';
import { formatDate } from './templates.ts';

/**
 * The archive page: every post the site has published, grouped by the month it
 * was published in, as the source design's essays page lists them
 * (decision-16).

 * A page opts in with `archive: true` in its front matter — one key, ignored
 * by Eleventy, the same shape as the `contact: true` beside it — and the
 * layout prints `partials/archive.njk` under the page's words.
 *
 * The grouping is here rather than in the template because a month is a
 * calendar question: a date in a file is a UTC instant and the site's timezone
 * is the lens it is read through (decision-11), so what month a post belongs
 * to is the same decision as what day the entry under it says, and Nunjucks is
 * the wrong place to make it twice.
 */

/** The front matter key a page opts in with. */
export const ARCHIVE_FRONT_MATTER_KEY = 'archive';

/** Whether this document lists the archive under its words. */
export function archiveOpen(document: Document): boolean {
  return document.extra[ARCHIVE_FRONT_MATTER_KEY] === true;
}

/** One post of an archive page, which is a link and the date beside it. */
export interface ArchiveEntry {
  /** What the link says: the post's title, or a note's first words. */
  title: string;
  /** Its URL path. */
  url: string;
  /** When it was published, for a theme that dates the line. */
  date: Date;
}

/** One month of an archive page: the heading, and what was published under it. */
export interface ArchiveMonth {
  /** The month as a reader sees it, "September 2026". */
  month: string;
  /** The posts published in it, newest first. */
  posts: ArchiveEntry[];
}

/**
 * Published posts as the months an archive page heads, newest month first.
 *
 * The posts arrive in the order every listing is in — newest first — and are
 * kept in it, so the months come out newest first without a second sort and
 * each month reads down from its last post to its first.
 *
 * A post with no date is left out rather than collected under a heading of its
 * own: an archive is a calendar, and a post that is on no day of it is not a
 * month a reader could be shown.
 */
export function archiveMonths(
  posts: readonly Document[],
  timezone: string = DEFAULT_TIMEZONE,
): ArchiveMonth[] {
  const months: ArchiveMonth[] = [];
  let current: string | undefined;

  for (const document of posts) {
    if (document.date === undefined) continue;
    const date = new Date(document.date);
    if (Number.isNaN(date.getTime())) continue;

    // The calendar day in the site's zone, of which the first seven characters
    // are the month it is in: one lens for the grouping and for the heading,
    // so a post can never be filed under one month and dated in another.
    const day = calendarDayIn(date, timezone);
    if (day === undefined) continue;

    const key = day.slice(0, 7);
    if (key !== current) {
      current = key;
      months.push({ month: formatDate(date, 'month', timezone), posts: [] });
    }

    months.at(-1)?.posts.push({ title: postLabel(document), url: document.permalink, date });
  }

  return months;
}
