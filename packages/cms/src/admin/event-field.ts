import { EVENT_KEYS, eventOf } from '../content/event.ts';
import type { PostEvent } from '../content/event.ts';
import { toUtcInstant, wallClockIn } from '../content/time.ts';
import type { FieldError } from './editor-layout.ts';

/**
 * The editor's event fields (TASK-200): when it starts and ends, as wall-clock
 * time in the site's zone the way the Date field is (decision-11), and where.
 */
export interface EventForm {
  start: string;
  end: string;
  location: string;
}

export const EVENT_FIELDS = {
  start: 'event-start',
  end: 'event-end',
  location: 'event-location',
} as const;

export const BLANK_EVENT_FORM: EventForm = { start: '', end: '', location: '' };

export function eventForm(extra: Readonly<Record<string, unknown>>, timezone: string): EventForm {
  const event = eventOf(extra);
  if (event === undefined) return BLANK_EVENT_FORM;
  const location = extra[EVENT_KEYS.location];
  return {
    start: wallClockIn(event.start, timezone),
    end: event.end === undefined ? '' : wallClockIn(event.end, timezone),
    location: typeof location === 'string' ? location : '',
  };
}

export function submittedEventForm(body: Record<string, unknown>): EventForm {
  const field = (name: string): string => (typeof body[name] === 'string' ? body[name] : '').trim();
  return {
    start: field(EVENT_FIELDS.start),
    end: field(EVENT_FIELDS.end),
    location: field(EVENT_FIELDS.location),
  };
}

/** The event a form describes, as front matter keeps it, or why it cannot be one. */
export function resolveEvent(
  form: EventForm,
  timezone: string,
): { event: PostEvent | undefined } | FieldError {
  if (form.start === '') {
    if (form.end === '' && form.location === '') return { event: undefined };
    return {
      error: 'An event needs a start. Fill in Starts, or empty Ends and Where.',
      field: 'editor-event-start',
    };
  }
  const start = instantIn(form.start, timezone);
  if (start === undefined) {
    return {
      error: 'Starts has to be a date and a time, like 2026-10-10 09:00.',
      field: 'editor-event-start',
    };
  }
  const end = form.end === '' ? undefined : instantIn(form.end, timezone);
  if (form.end !== '' && end === undefined) {
    return {
      error: 'Ends has to be a date and a time, like 2026-10-10 17:00.',
      field: 'editor-event-end',
    };
  }
  if (end !== undefined && Date.parse(end) < Date.parse(start)) {
    return { error: 'An event cannot end before it starts.', field: 'editor-event-end' };
  }
  return { event: eventOf({ start, end, location: form.location }) };
}

/** The keys an event writes into front matter, every one of them, so a cleared field is removed. */
export function eventFrontMatter(event: PostEvent | undefined): Record<string, string | undefined> {
  return {
    [EVENT_KEYS.start]: event?.start,
    [EVENT_KEYS.end]: event?.end,
    [EVENT_KEYS.location]:
      event?.location === undefined
        ? undefined
        : event.location.kind === 'place'
          ? event.location.name
          : event.location.url,
  };
}

function instantIn(value: string, timezone: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  return toUtcInstant(value, timezone);
}
