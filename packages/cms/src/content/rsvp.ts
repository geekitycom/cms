/**
 * An RSVP (TASK-198): a reply to an event whose front matter says whether its
 * author is going, under the mf2 property of the same name.
 *
 * ```yaml
 * in-reply-to: https://events.example/indieweb-camp
 * rsvp: yes
 * ```
 *
 * The values are the four indieweb.org/rsvp lists. Everything that reads or
 * shows one, a post's own and one a webmention brings, goes through this
 * module.
 */
export const RSVP_FRONT_MATTER_KEY = 'rsvp';

export const RSVP_VALUES = ['yes', 'no', 'maybe', 'interested'] as const;

export type RsvpValue = (typeof RSVP_VALUES)[number];

/** What each value says on its own, as a badge or a select option. */
export const RSVP_LABELS: Readonly<Record<RsvpValue, string>> = {
  yes: 'Going',
  no: 'Not going',
  maybe: 'Maybe',
  interested: 'Interested',
};

/** What each value says ahead of the event's name. */
export const RSVP_PHRASES: Readonly<Record<RsvpValue, string>> = {
  yes: 'Going to',
  no: 'Not going to',
  maybe: 'Maybe going to',
  interested: 'Interested in',
};

/** A value as written, trimmed and in lower case, when it is one of the four. */
export function rsvpValue(value: unknown): RsvpValue | undefined {
  if (typeof value !== 'string') return undefined;
  const lowered = value.trim().toLowerCase();
  return RSVP_VALUES.find((known) => known === lowered);
}

export function rsvpOf(extra: Readonly<Record<string, unknown>>): RsvpValue | undefined {
  return rsvpValue(extra[RSVP_FRONT_MATTER_KEY]);
}

/**
 * The line an RSVP opens its content with, so a parser that reads only the
 * content, as a webmention receiver may, finds the `p-rsvp`.
 */
export function rsvpLine(value: RsvpValue | undefined): string {
  if (value === undefined) return '';
  return `<p class="rsvp-line"><data class="p-rsvp" value="${value}">${RSVP_LABELS[value]}</data></p>\n`;
}
