import type { UmamiRange } from './client.ts';

const DAY_MS = 86_400_000;

export function dayIn(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function addDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

function offsetAt(instant: number, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  const wall = Date.UTC(
    parts['year'] ?? 0,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    parts['hour'] ?? 0,
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

export function midnightIn(day: string, timezone: string): Date {
  const wall = Date.parse(`${day}T00:00:00Z`);
  const guess = wall - offsetAt(wall, timezone);
  return new Date(wall - offsetAt(guess, timezone));
}

export function lastDays(
  instant: Date,
  timezone: string,
  count: number,
): { readonly days: string[]; readonly range: UmamiRange } {
  const today = dayIn(instant, timezone);
  return {
    days: Array.from({ length: count }, (_, index) => addDays(today, index - count + 1)),
    range: {
      start: midnightIn(addDays(today, 1 - count), timezone),
      end: new Date(midnightIn(addDays(today, 1), timezone).getTime() - 1),
    },
  };
}
