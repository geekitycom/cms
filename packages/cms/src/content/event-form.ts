import { trimmedField } from '../util/forms.ts';
import { isWebUrl } from './enclosure.ts';
import { EVENT_KEYS, eventOf } from './event.ts';
import type { PostEvent } from './event.ts';
import type { FieldError } from './form-error.ts';
import { toUtcInstant, wallClockIn } from './time.ts';

/**
 * The editor's event fields: when it starts and ends, as wall-clock
 * time in the site's zone the way the Date field is, and where.
 */
export interface EventForm {
  start: string;
  end: string;
  location: string;
}

export const BLANK_EVENT_FORM: EventForm = { start: '', end: '', location: '' };

export const EVENT_FIELDS = {
  start: 'event-start',
  end: 'event-end',
  location: 'event-location',
} as const;

export function submittedEventForm(body: Readonly<Record<string, unknown>>): EventForm {
  return {
    start: trimmedField(body, EVENT_FIELDS.start),
    end: trimmedField(body, EVENT_FIELDS.end),
    location: trimmedField(body, EVENT_FIELDS.location),
  };
}

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

const EVENT_PLACE_REFUSAL =
  'An event’s location is words, a web address, or an h-card or h-adr naming a place.';

const PLACE_WORDS = ['name', 'street-address', 'locality', 'region', 'country-name'] as const;

export function eventPlaceFromMicropub(
  values: readonly unknown[],
  refuse: (message: string) => void,
): string {
  if (values.length > 1) refuse('location takes one value.');
  const [value] = values;
  if (value === undefined) return '';
  if (typeof value === 'string') {
    if (!/^geo:/i.test(value.trim())) return value.trim();
    refuse(EVENT_PLACE_REFUSAL);
    return '';
  }
  const { type, properties } =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const given =
    typeof properties === 'object' && properties !== null
      ? (properties as Record<string, unknown>)
      : {};
  const first = (name: string): string => {
    const listed = given[name];
    const text: unknown = Array.isArray(listed) ? listed[0] : undefined;
    return typeof text === 'string' ? text.trim() : '';
  };
  const words = [...new Set(PLACE_WORDS.map(first).filter((part) => part !== ''))].join(', ');
  const url = first('url');
  const place = words !== '' ? words : isWebUrl(url) ? url : '';
  if (!Array.isArray(type) || !type.some((t) => t === 'h-card' || t === 'h-adr') || place === '') {
    refuse(EVENT_PLACE_REFUSAL);
    return '';
  }
  return place;
}
