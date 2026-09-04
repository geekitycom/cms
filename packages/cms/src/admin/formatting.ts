/** The months, spelled the way the theme's `date` filter spells them. */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * An instant as a person in this site's time zone would read it: `4 September
 * 2026 at 09:00 UTC`.
 *
 * The public site prints dates in UTC, because a theme ported from an Eleventy
 * build using Luxon with `zone: 'utc'` does. The admin is the one place that
 * should not: an author scheduling a post for nine in the morning means nine
 * in *their* morning, and the site's `timezone` setting is what says which one
 * that is. The zone is printed with it so the two readings can never be
 * confused: an abbreviation where the zone has a well known one (`CDT`, `UTC`)
 * and an offset where it does not (`GMT+1`), which is what `Intl` answers and
 * is unambiguous either way.
 *
 * A zone name the runtime does not know falls back to UTC rather than
 * throwing: the settings screen refuses an unknown zone, so anything that
 * reaches here came from a hand-edited database and should not take the
 * editor down.
 */
export function formatInTimezone(instant: string, timezone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';

  const parts = partsIn(date, timezone) ?? partsIn(date, 'UTC');
  if (parts === undefined) return date.toISOString();

  const month = MONTHS[Number(parts['month']) - 1] ?? '';
  return (
    `${String(Number(parts['day']))} ${month} ${parts['year'] ?? ''} ` +
    `at ${parts['hour'] ?? ''}:${parts['minute'] ?? ''} ${parts['timeZoneName'] ?? ''}`
  );
}

/** The instant's fields in one zone, or `undefined` when the zone is not one. */
function partsIn(date: Date, timezone: string): Record<string, string> | undefined {
  let formatter: Intl.DateTimeFormat;
  try {
    // `en-US` only for the zone abbreviation: it is the locale whose short
    // names are the ones people recognise — `CDT` where `en-GB` says `GMT-5`.
    // Everything else on the line is assembled from the parts below, so the
    // locale decides nothing about the order or the spelling of the date.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    });
  } catch {
    return undefined;
  }

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}
