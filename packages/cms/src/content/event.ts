import { isWebUrl } from './enclosure.ts';
import { toUtcInstant } from './time.ts';

/**
 * An event post (TASK-200, decision-32): a post whose front matter says when
 * it starts, under the mf2 names an h-event uses. Its title is the event's
 * name and its body the description.
 *
 * ```yaml
 * title: IndieWeb Camp Chicago
 * start: '2026-10-10T14:00:00Z'
 * end: '2026-10-10T22:00:00Z'
 * location: Chicago Public Library, 400 S State St
 * ```
 *
 * `start` and `end` are UTC instants (decision-11); one written with no
 * offset is read as UTC. A `location` that is a web address is where to join
 * an online event, and any other words are the place. An event's location is
 * where the event is, public by nature, so it is the one location that lives
 * in front matter (decision-29 keeps the author's own out of it).
 */
export const EVENT_KEYS = { start: 'start', end: 'end', location: 'location' } as const;

export type EventLocation =
  | { readonly kind: 'place'; readonly name: string }
  | { readonly kind: 'virtual'; readonly url: string };

export interface PostEvent {
  readonly start: string;
  readonly end?: string;
  readonly location?: EventLocation;
}

export function eventOf(extra: Readonly<Record<string, unknown>>): PostEvent | undefined {
  const start = instantOf(extra[EVENT_KEYS.start]);
  if (start === undefined) return undefined;
  const end = instantOf(extra[EVENT_KEYS.end]);
  const location = eventLocation(extra[EVENT_KEYS.location]);
  return {
    start,
    ...(end !== undefined && Date.parse(end) >= Date.parse(start) ? { end } : {}),
    ...(location === undefined ? {} : { location }),
  };
}

export function eventLocation(value: unknown): EventLocation | undefined {
  if (typeof value !== 'string') return undefined;
  const words = value.trim();
  if (words === '') return undefined;
  return isWebUrl(words) ? { kind: 'virtual', url: words } : { kind: 'place', name: words };
}

/** A start or an end as written, read as an instant, or `undefined`. */
export function instantOf(value: unknown): string | undefined {
  if (value instanceof Date) return toUtcInstant(value, 'UTC');
  if (typeof value !== 'string') return undefined;
  const written = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(written) ? toUtcInstant(written, 'UTC') : undefined;
}
