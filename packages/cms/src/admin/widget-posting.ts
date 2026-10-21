import { Temporal } from '@js-temporal/polyfill';

import type { Document } from '../content/document.ts';
import { enclosureOf } from '../content/enclosure.ts';
import { postLocations } from '../content/locations.ts';
import type { PostLocations } from '../content/locations.ts';
import { postTypeOf } from '../content/post-type.ts';
import type { PostType } from '../content/post-type.ts';
import { dateSortKey } from '../content/store.ts';
import { calendarDayIn, toUtcInstant } from '../content/time.ts';
import type { CoreWidget } from './widgets.ts';

type Kind = PostType | 'checkin' | 'episode';

const KINDS: readonly (readonly [Kind, string])[] = [
  ['note', 'Notes'],
  ['article', 'Articles'],
  ['photo', 'Photos'],
  ['checkin', 'Check-ins'],
  ['review', 'Reviews'],
  ['reply', 'Replies'],
  ['like', 'Likes'],
  ['repost', 'Reposts'],
  ['bookmark', 'Bookmarks'],
  ['event', 'Events'],
  ['rsvp', 'RSVPs'],
  ['episode', 'Episodes'],
];

const KINDS_SHOWN = 3;

const WEEKS = 52;
const MONTHS = 12;

const monthLabel = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function kindOf(document: Document, locations: PostLocations): Kind {
  const type = postTypeOf(document);
  if (type !== 'note' && type !== 'article' && type !== 'photo') return type;
  if (enclosureOf(document.extra) !== undefined) return 'episode';
  if (locations.read(document.permalink)?.checkin === true) return 'checkin';
  return type;
}

export const POSTING_WIDGET: CoreWidget = {
  id: 'posting-activity',
  title: 'Posting activity',
  width: 'full',
  refreshSeconds: 900,
  load(vars) {
    const timezone = vars.siteAtRequestStart.timezone;
    const today = calendarDayIn(vars.config.now(), timezone);
    if (today === undefined) throw new Error('The clock does not read as a date.');

    const end = Temporal.PlainDate.from(today);
    const firstDay = end.subtract({ days: WEEKS * 7 - 1 });
    const firstMonth = end.toPlainYearMonth().subtract({ months: MONTHS - 1 });
    const earliest =
      Temporal.PlainDate.compare(firstDay, firstMonth.toPlainDate({ day: 1 })) < 0
        ? firstDay
        : firstMonth.toPlainDate({ day: 1 });
    const since = toUtcInstant(earliest.toString(), timezone);
    if (since === undefined) throw new Error('The year does not start on a date.');

    const locations = postLocations(vars.config.dataDir);
    const perDay = new Map<string, number>();
    const perMonth = new Map<string, Map<Kind, number>>();
    for (const document of vars.store.listPostsPublishedSince(since)) {
      const at = dateSortKey(document.date);
      const day = at === null ? undefined : calendarDayIn(at, timezone);
      if (day === undefined) continue;
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      const month = day.slice(0, 7);
      const kinds = perMonth.get(month) ?? new Map<Kind, number>();
      const kind = kindOf(document, locations);
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      perMonth.set(month, kinds);
    }

    const days = Array.from({ length: WEEKS * 7 }, (_, index) =>
      firstDay.add({ days: index }).toString(),
    );
    const months = Array.from({ length: MONTHS }, (_, index) => firstMonth.add({ months: index }));
    if (perDay.size === 0) return [{ paragraph: ['No posts published in the last 52 weeks.'] }];

    const countOf = (month: Temporal.PlainYearMonth, kinds: readonly Kind[]): number =>
      kinds.reduce((sum, kind) => sum + (perMonth.get(month.toString())?.get(kind) ?? 0), 0);
    const used = KINDS.map(([kind, name]) => ({
      kind,
      name,
      total: months.reduce((sum, month) => sum + countOf(month, [kind]), 0),
    })).filter(({ total }) => total > 0);
    const own =
      used.length <= KINDS_SHOWN + 1
        ? used
        : used.toSorted((a, b) => b.total - a.total).slice(0, KINDS_SHOWN);
    const other = used.filter((entry) => !own.includes(entry)).map(({ kind }) => kind);
    const series = [
      ...used
        .filter((entry) => own.includes(entry))
        .map(({ kind, name }) => ({ name, kinds: [kind] })),
      ...(other.length === 0 ? [] : [{ name: 'Other', kinds: other }]),
    ];

    return [
      {
        calendar: {
          caption: 'Posts per day',
          days: days.map((day) => ({ day, count: perDay.get(day) ?? 0 })),
        },
      },
      {
        bars: {
          caption: 'Posts per month by kind',
          groupName: 'Month',
          groups: months.map((month) =>
            monthLabel.format(new Date(Date.UTC(month.year, month.month - 1, 1))),
          ),
          series: (series.length === 0 ? [{ name: 'Posts', kinds: [] }] : series).map(
            ({ name, kinds }) => ({ name, values: months.map((month) => countOf(month, kinds)) }),
          ),
        },
      },
    ];
  },
};
