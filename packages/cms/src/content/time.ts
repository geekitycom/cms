import { Temporal } from '@js-temporal/polyfill';

/**
 * The zone a site reads and writes wall-clock time in until it says otherwise.
 *
 * Also the fallback wherever a zone turns out not to be one: the settings
 * screen refuses a name the runtime does not know, so anything else that
 * reaches here came from a hand-edited database and should not take a page
 * down.
 */
export const DEFAULT_TIMEZONE = 'UTC';

/**
 * A date with no offset, as the editor's field spells one: `2026-09-04`,
 * `2026-09-04 09:00`, `2026-09-04T09:00:00`, `2026-09-04T09:00:00.785`.
 *
 * Anything else — a `Z`, a `+02:00` — fixes an instant by itself and is read
 * as one, which is the difference this pattern exists to draw.
 */
const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(:\d{2})?(\.\d+)?)?$/;

/**
 * A date as the UTC instant the CMS writes into a file: ISO 8601 ending in
 * `Z`, with the sub-second digits only when the instant has any.
 *
 * A value that already carries an offset — `2026-06-02T07:30:00-05:00`, or a
 * `Z` — names an instant on its own and keeps it, so the zone is not consulted
 * and converting is loss-free. A value that carries none is a wall clock, and
 * `timezone` is what says which one: per decision-11 that is the site's zone,
 * not the server's, so the same file means the same moment wherever it is
 * saved.
 *
 * Returns `undefined` for anything unreadable, so a caller decides whether an
 * unreadable date is a refusal or a field left as it was.
 */
export function toUtcInstant(value: string | Date, timezone: string): string | undefined {
  if (value instanceof Date) return canonical(value);

  if (WALL_CLOCK.test(value)) {
    const zoned = zonedFrom(value, timezone) ?? zonedFrom(value, DEFAULT_TIMEZONE);
    return zoned === undefined ? undefined : canonical(new Date(zoned.epochMilliseconds));
  }

  const parsed = new Date(value);
  return canonical(parsed);
}

/**
 * An instant as the clock reads in a zone: `2026-09-04 09:00:00`.
 *
 * This is the editor's date field, and it is deliberately not a rendering for
 * a reader: it is a value {@link toUtcInstant} reads back in the same zone to
 * exactly the instant it came from, so a form submitted with the field
 * untouched writes the date it was filled in from. The sub-second digits are
 * there only when the instant has any, which keeps the usual case short and
 * still round-trips a date some other tool wrote to the millisecond.
 *
 * An unreadable date is the empty string, which is what the field shows for a
 * document with no date at all.
 */
export function wallClockIn(instant: string | Date, timezone: string): string {
  const utc = toUtcInstant(instant, DEFAULT_TIMEZONE);
  if (utc === undefined) return '';

  const zoned = zonedInstant(utc, timezone);
  if (zoned === undefined) return '';

  const plain = zoned.toPlainDateTime().toString({ smallestUnit: 'second' }).replace('T', ' ');
  const fraction = /\.\d+/.exec(utc);
  return fraction === null ? plain : `${plain}${fraction[0]}`;
}

/**
 * The calendar day a zone was on at an instant, `YYYY-MM-DD`.
 *
 * What a new post's filename and its `/{yyyy}/{mm}/` permalink are cut from,
 * so a post published at half past midnight on 1 October in Berlin is filed
 * under October rather than under the September UTC was still on.
 */
export function calendarDayIn(instant: string | Date, timezone: string): string | undefined {
  const utc = toUtcInstant(instant, DEFAULT_TIMEZONE);
  if (utc === undefined) return undefined;

  return zonedInstant(utc, timezone)?.toPlainDate().toString();
}

/**
 * How the editor names the zone its date field is in: `America/Chicago (CDT)`,
 * or just `UTC` where the abbreviation would only repeat the name.
 *
 * The abbreviation is the one in force at that instant, so a date in January
 * and a date in July say `CST` and `CDT` rather than both claiming whichever
 * one is current.
 */
export function zoneLabel(instant: string | Date, timezone: string): string {
  const utc = toUtcInstant(instant, DEFAULT_TIMEZONE);
  const at = utc === undefined ? new Date() : new Date(utc);

  let abbreviation: string | undefined;
  try {
    // `en-US` only for the abbreviation: it is the locale whose short names
    // are the ones people recognise — `CDT` where `en-GB` says `GMT-5`.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(at);
    abbreviation = parts.find((part) => part.type === 'timeZoneName')?.value;
  } catch {
    return timezone;
  }

  if (abbreviation === undefined || abbreviation === timezone) return timezone;
  return `${timezone} (${abbreviation})`;
}

/** An instant in a zone, falling back to UTC for a zone that is not one. */
function zonedInstant(utc: string, timezone: string): Temporal.ZonedDateTime | undefined {
  const instant = Temporal.Instant.from(utc);
  try {
    return instant.toZonedDateTimeISO(timezone);
  } catch {
    return instant.toZonedDateTimeISO(DEFAULT_TIMEZONE);
  }
}

/** The instant `2026-09-04T14:00:00Z`, never `2026-09-04T14:00:00.000Z`. */
function canonical(date: Date): string | undefined {
  if (Number.isNaN(date.getTime())) return undefined;
  const iso = date.toISOString();
  return iso.endsWith('.000Z') ? `${iso.slice(0, 19)}Z` : iso;
}

/**
 * A wall clock placed in a zone.
 *
 * Temporal's default disambiguation is what a person means by a wall clock
 * that a daylight-saving change made ambiguous or impossible: the earlier of
 * the two readings when a clock went back, and the same distance past the gap
 * when it went forward.
 */
function zonedFrom(wallClock: string, timezone: string): Temporal.ZonedDateTime | undefined {
  try {
    return Temporal.PlainDateTime.from(wallClock.replace(' ', 'T')).toZonedDateTime(timezone);
  } catch {
    return undefined;
  }
}
