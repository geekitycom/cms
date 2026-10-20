import { stringOrEmpty, trimmedField } from '../util/forms.ts';
import { isRecord } from '../util/guards.ts';
import { SYNDICATE_TO_FRONT_MATTER_KEY, syndicateToOf } from './syndicate-to.ts';
import type { SyndicationTarget } from './syndicate-to.ts';
import {
  citationOf,
  citationText,
  CITED_ALT_FRONT_MATTER_KEY,
  PREVIEW_FRONT_MATTER_KEY,
  previewShown,
} from './citation.ts';
import type { CitationProperty } from './citation.ts';
import type { Document } from './document.ts';
import { CITATION_FIELDS } from './document-form.ts';
import type { EditorForm, ResolvedMedia } from './document-form.ts';
import { ENCLOSURE_FRONT_MATTER_KEY } from './enclosure.ts';
import { enclosureForm, enclosureFrontMatter, readEnclosureForm } from './enclosure-form.ts';
import { eventOf } from './event.ts';
import type { PostEvent } from './event.ts';
import {
  eventForm,
  eventFrontMatter,
  eventPlaceFromMicropub,
  resolveEvent,
  submittedEventForm,
} from './event-form.ts';
import { PHOTO_FRONT_MATTER_KEY, photoFrontMatter } from './photo.ts';
import { photoRowFromMicropub, photoRows, photoToMicropub, readPhotoForm } from './photo-form.ts';
import { PINNED_FRONT_MATTER_KEY, pinnedAt } from './pinned.ts';
import {
  ITEM_FRONT_MATTER_KEY,
  ITEM_KEYS,
  RATING_FRONT_MATTER_KEY,
  reviewFrontMatter,
  reviewOf,
} from './review.ts';
import {
  reviewForm,
  reviewFromMicropub,
  reviewToMicropub,
  submittedReviewForm,
} from './review-form.ts';
import { RSVP_FRONT_MATTER_KEY, rsvpOf, rsvpValue } from './rsvp.ts';
import { toUtcInstant } from './time.ts';

export type MicropubType = 'h-entry' | 'h-event' | 'h-review';

export interface MicropubSite {
  readonly baseUrl: string;
  readonly targets: readonly SyndicationTarget[];
}

export interface MicropubRequest extends MicropubSite {
  readonly type: MicropubType;
  readonly has: (name: string) => boolean;
  readonly values: (name: string) => readonly unknown[];
  readonly text: (name: string) => string;
  readonly refuse: (message: string) => void;
  readonly upload: (row: number, file: File) => void;
}

export interface MicropubMapping {
  readonly properties: Readonly<Record<string, readonly (keyof EditorForm)[]>>;
  readonly publishable: readonly string[];
  readonly toForm: (request: MicropubRequest) => Partial<EditorForm>;
  readonly toProperties: (document: Document, site: MicropubSite) => Record<string, unknown[]>;
}

export interface FieldWriting {
  /** The document being replaced, or `undefined` when one is being made. */
  readonly document: Document | undefined;
  readonly now: Date;
  readonly media: ResolvedMedia;
  readonly declared: readonly SyndicationTarget[];
  readonly timezone: string;
}

export interface PostField {
  readonly read: (document: Document, timezone: string) => Partial<EditorForm>;
  readonly submitted: (
    body: Readonly<Record<string, unknown>>,
    declared: readonly SyndicationTarget[],
  ) => Partial<EditorForm>;
  readonly write: (extra: Record<string, unknown>, form: EditorForm, context: FieldWriting) => void;
  readonly micropub?: MicropubMapping;
}

function setOrDelete(extra: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) delete extra[key];
  else extra[key] = value;
}

function answered(name: string, value: string | undefined): Record<string, unknown[]> {
  return value === undefined || value === '' ? {} : { [name]: [value] };
}

const ENCLOSURE_FIELD: PostField = {
  read: (document) => ({ enclosure: enclosureForm(document) }),
  submitted: (body) => ({ enclosure: readEnclosureForm(body) }),
  write: (extra, _form, { media }) => {
    setOrDelete(
      extra,
      ENCLOSURE_FRONT_MATTER_KEY,
      media.recording === undefined ? undefined : enclosureFrontMatter(media.recording),
    );
  },
};

const PHOTO_FIELD: PostField = {
  read: (document) => ({ photos: photoRows(document) }),
  submitted: (body) => ({ photos: readPhotoForm(body) }),
  write: (extra, _form, { media }) => {
    setOrDelete(
      extra,
      PHOTO_FRONT_MATTER_KEY,
      media.photos.length === 0 ? undefined : photoFrontMatter(media.photos),
    );
  },
  micropub: {
    properties: { photo: ['photos'] },
    publishable: ['photo'],
    toForm: (request) => ({
      photos: request.values('photo').map((value, row) => {
        if (value instanceof File) {
          request.upload(row, value);
          return { url: '', alt: '' };
        }
        const photo = photoRowFromMicropub(value, request.baseUrl);
        if (photo === undefined) {
          request.refuse(
            'photo is a web address, { "value": "…", "alt": "…" } or an uploaded file.',
          );
          return { url: '', alt: '' };
        }
        return photo;
      }),
    }),
    toProperties: (document, { baseUrl }) => {
      const photos = photoRows(document).map((row) => photoToMicropub(row, baseUrl));
      return photos.length === 0 ? {} : { photo: photos };
    },
  },
};

function citationField(
  property: CitationProperty,
  field: (value: string) => Partial<EditorForm>,
): PostField {
  const key = CITATION_FIELDS[property];
  return {
    // As the file spells it, so a save writes back what it read.
    read: (document) => field(citationText(document.extra[property])),
    submitted: (body) => field(trimmedField(body, property)),
    write: (extra, form) => {
      setOrDelete(extra, property, form[key] === '' ? undefined : form[key]);
    },
    micropub: {
      properties: { [property]: [key] },
      publishable: [property],
      toForm: (request) => field(request.text(property)),
      toProperties: (document) => answered(property, citationOf(document, property)),
    },
  };
}

const RSVP_FIELD: PostField = {
  read: (document) => ({ rsvp: stringOrEmpty(document.extra[RSVP_FRONT_MATTER_KEY]) }),
  submitted: (body) => ({ rsvp: trimmedField(body, RSVP_FRONT_MATTER_KEY) }),
  write: (extra, form) => {
    setOrDelete(extra, RSVP_FRONT_MATTER_KEY, rsvpValue(form.rsvp));
  },
  micropub: {
    properties: { rsvp: ['rsvp'] },
    publishable: [],
    toForm: (request) => ({ rsvp: request.text('rsvp') }),
    toProperties: (document) => answered('rsvp', rsvpOf(document.extra)),
  },
};

const EVENT_FIELD: PostField = {
  read: (document, timezone) => ({ event: eventForm(document.extra, timezone) }),
  submitted: (body) => ({ event: submittedEventForm(body) }),
  write: (extra, form, { document, timezone }) => {
    const event = resolveEvent(form.event, timezone);
    if (!('event' in event) || !isOrWasEvent(event.event, document)) return;
    for (const [key, value] of Object.entries(eventFrontMatter(event.event))) {
      setOrDelete(extra, key, value);
    }
  },
  micropub: {
    properties: { start: ['event'], end: ['event'] },
    publishable: [],
    toForm: (request) => {
      if (request.type === 'h-event') {
        const event = {
          start: request.text('start'),
          end: request.text('end'),
          location: eventPlaceFromMicropub(request.values('location'), request.refuse),
        };
        if (event.start === '') request.refuse('An h-event needs a start.');
        return { event };
      }
      const eventOnly = (['start', 'end'] as const).filter((name) => request.has(name));
      if (eventOnly.length > 0) {
        request.refuse(`${eventOnly.join(' and ')} belong to an event; send it as an h-event.`);
      }
      return {};
    },
    toProperties: (document) =>
      Object.fromEntries(
        Object.entries(eventFrontMatter(eventOf(document.extra))).flatMap(([name, value]) =>
          Object.entries(answered(name, value)),
        ),
      ),
  },
};

function isOrWasEvent(saved: PostEvent | undefined, document: Document | undefined): boolean {
  return saved !== undefined || (document !== undefined && eventOf(document.extra) !== undefined);
}

const REVIEW_FIELD: PostField = {
  read: (document) => ({ review: reviewForm(document.extra, reviewOf(document.extra)) }),
  submitted: (body) => ({ review: submittedReviewForm(body) }),
  // A key somebody added to the item by hand is kept, as one beside it is.
  write: (extra, _form, { media: { review } }) => {
    const { item, rating } = reviewFrontMatter(review);
    const before = extra[ITEM_FRONT_MATTER_KEY];
    const modelled = new Set(['kind', 'name', ...Object.values(ITEM_KEYS)]);
    const kept =
      item !== undefined && isRecord(before)
        ? Object.fromEntries(Object.entries(before).filter(([key]) => !modelled.has(key)))
        : {};
    setOrDelete(extra, ITEM_FRONT_MATTER_KEY, item && { ...item, ...kept });
    setOrDelete(extra, RATING_FRONT_MATTER_KEY, rating);
  },
  micropub: {
    properties: { item: ['review'], rating: ['review'] },
    publishable: ['item'],
    toForm: (request) => {
      const review = reviewFromMicropub(
        request.values('item'),
        request.values('rating'),
        request.refuse,
        request.baseUrl,
      );
      if (request.type === 'h-review' && !request.has('item')) {
        request.refuse('An h-review needs the item it reviews.');
      }
      return { review };
    },
    toProperties: (document, { baseUrl }) => reviewToMicropub(reviewOf(document.extra), baseUrl),
  },
};

const PREVIEW_FIELD: PostField = {
  read: (document) => ({ previewHidden: !previewShown(document.extra) }),
  submitted: (body) => ({ previewHidden: body[PREVIEW_FRONT_MATTER_KEY] !== undefined }),
  write: (extra, form) => {
    setOrDelete(extra, PREVIEW_FRONT_MATTER_KEY, form.previewHidden ? false : undefined);
  },
};

const CITED_ALT_FIELD: PostField = {
  read: (document) => ({ citedAlt: stringOrEmpty(document.extra[CITED_ALT_FRONT_MATTER_KEY]) }),
  submitted: (body) => ({ citedAlt: trimmedField(body, CITED_ALT_FRONT_MATTER_KEY) }),
  write: (extra, form) => {
    setOrDelete(
      extra,
      CITED_ALT_FRONT_MATTER_KEY,
      form.citedAlt === '' ? undefined : form.citedAlt,
    );
  },
};

/** The editor checkbox that selects one syndication target. */
export function syndicateToField(target: SyndicationTarget): string {
  return `${SYNDICATE_TO_FRONT_MATTER_KEY}-${target.id}`;
}

const SYNDICATE_TO_FIELD: PostField = {
  read: (document) => ({ syndicateTo: syndicateToOf(document.extra) }),
  submitted: (body, declared) => ({
    syndicateTo: declared
      .filter((target) => body[syndicateToField(target)] !== undefined)
      .map((target) => target.id),
  }),
  // The checkboxes speak for the targets the site declares (TASK-155). An id
  // the file lists that names no declared target has no checkbox, so it is
  // kept as written rather than lost to a save.
  write: (extra, form, { declared }) => {
    const offered = new Set(declared.map((target) => target.id));
    const kept = syndicateToOf(extra).filter((id) => !offered.has(id));
    // A form loaded from the file (a Micropub update) already holds those ids.
    const listed = [...new Set([...form.syndicateTo, ...kept])];
    setOrDelete(extra, SYNDICATE_TO_FRONT_MATTER_KEY, listed.length === 0 ? undefined : listed);
  },
  micropub: {
    properties: { 'mp-syndicate-to': ['syndicateTo'] },
    publishable: [],
    toForm: (request) => ({ syndicateTo: syndicateTo(request) }),
    toProperties: (document, { targets }) => {
      const declared = new Set(targets.map(({ id }) => id));
      const selected = syndicateToOf(document.extra).filter((id) => declared.has(id));
      return selected.length === 0 ? {} : { 'mp-syndicate-to': selected };
    },
  },
};

/**
 * The targets `mp-syndicate-to` selects, each once, as the editor's checkboxes
 * would. A uid the site does not declare is refused by name: a post read back
 * ignores it, so a client would never learn the post went nowhere.
 */
function syndicateTo(request: MicropubRequest): string[] {
  const values = request.values('mp-syndicate-to');
  if (!values.every((value) => typeof value === 'string')) {
    request.refuse('mp-syndicate-to has to be text, one target uid to a value.');
    return [];
  }
  const declared = new Set(request.targets.map(({ id }) => id));
  const unknown = values.filter((uid) => !declared.has(uid));
  if (unknown.length > 0) {
    request.refuse(`mp-syndicate-to names no syndication target ${unknown.join(', ')}.`);
  }
  return [...new Set(values)];
}

const PINNED_FIELD: PostField = {
  read: (document) => ({ pinned: pinnedAt(document) !== undefined }),
  submitted: (body) => ({ pinned: body[PINNED_FRONT_MATTER_KEY] !== undefined }),
  // The moment a post was pinned is what orders the featured collection, so a
  // pin the file already carries keeps its moment through every later save,
  // and unpinning takes the key out rather than writing `false` (TASK-207).
  write: (extra, form, { document, now }) => {
    if (!form.pinned) delete extra[PINNED_FRONT_MATTER_KEY];
    else if (document === undefined || pinnedAt(document) === undefined) {
      extra[PINNED_FRONT_MATTER_KEY] = toUtcInstant(now, 'UTC');
    }
  },
};

export const POST_FIELDS: readonly PostField[] = [
  ENCLOSURE_FIELD,
  PHOTO_FIELD,
  citationField('repost-of', (repostOf) => ({ repostOf })),
  citationField('like-of', (likeOf) => ({ likeOf })),
  citationField('bookmark-of', (bookmarkOf) => ({ bookmarkOf })),
  RSVP_FIELD,
  EVENT_FIELD,
  REVIEW_FIELD,
  PREVIEW_FIELD,
  CITED_ALT_FIELD,
  SYNDICATE_TO_FIELD,
  PINNED_FIELD,
];
