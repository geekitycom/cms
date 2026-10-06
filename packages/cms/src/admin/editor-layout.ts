import { COMMENT_SETTINGS } from './documents.ts';
import type { EditorForm } from './documents.ts';

export type EditorField = `editor-${string}`;

export interface Refusal {
  readonly message: string;
  readonly field?: EditorField | undefined;
}

export interface FieldError {
  readonly error: string;
  readonly field: EditorField;
}

export type EditorGroup =
  | 'photos'
  | 'location'
  | 'recording'
  | 'versions'
  | 'publishing'
  | 'taxonomy'
  | 'address'
  | 'responding'
  | 'event'
  | 'read'
  | 'summary'
  | 'syndication'
  | 'display';

interface GroupRule {
  readonly filled: (form: EditorForm) => boolean;
  readonly fieldPrefixes: readonly EditorField[];
}

function alwaysOpen(): boolean {
  return true;
}

function filledIn(...values: (string | boolean)[]): boolean {
  return values.some((value) => value !== '' && value !== false);
}

const GROUPS: Readonly<Record<EditorGroup, GroupRule>> = {
  photos: { filled: (form) => form.photos.length > 0, fieldPrefixes: ['editor-photo-'] },
  location: {
    filled: ({ location: at }) =>
      filledIn(at.geo, at.accuracy, at.name, at.locality, at.region, at.country, at.checkin),
    fieldPrefixes: ['editor-location-'],
  },
  recording: {
    filled: ({ enclosure }) =>
      filledIn(
        enclosure.url,
        enclosure.duration,
        enclosure.transcriptUrl,
        enclosure.transcriptType,
      ) || enclosure.alternates.length > 0,
    fieldPrefixes: ['editor-enclosure-', 'editor-alternate-'],
  },
  versions: {
    filled: (form) => form.enclosure.alternates.length > 0,
    fieldPrefixes: ['editor-alternate-'],
  },
  publishing: { filled: alwaysOpen, fieldPrefixes: [] },
  taxonomy: { filled: alwaysOpen, fieldPrefixes: [] },
  address: {
    filled: (form) => filledIn(form.slug, form.permalink),
    fieldPrefixes: ['editor-slug', 'editor-permalink'],
  },
  responding: {
    filled: (form) =>
      filledIn(form.inReplyTo, form.rsvp, form.likeOf, form.repostOf, form.bookmarkOf),
    fieldPrefixes: [
      'editor-in-reply-to',
      'editor-rsvp',
      'editor-like-of',
      'editor-repost-of',
      'editor-bookmark-of',
      'editor-cited-alt',
    ],
  },
  event: {
    filled: ({ event }) => filledIn(event.start, event.end, event.location),
    fieldPrefixes: ['editor-event-'],
  },
  read: {
    filled: ({ readStatus, readOf: of }) =>
      filledIn(readStatus, of.name, of.author, of.uid, of.url),
    fieldPrefixes: ['editor-read-'],
  },
  summary: {
    filled: (form) => filledIn(form.description, form.lang),
    fieldPrefixes: ['editor-description', 'editor-lang'],
  },
  syndication: {
    filled: (form) => form.syndicateTo.length > 0,
    fieldPrefixes: ['editor-syndicate-to-'],
  },
  display: {
    filled: (form) => form.comments !== COMMENT_SETTINGS.site || form.exclude || form.contact,
    fieldPrefixes: ['editor-comments', 'editor-exclude', 'editor-contact'],
  },
};

export function openGroups(
  form: EditorForm,
  refused: EditorField | undefined,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(GROUPS).map(([group, rule]) => [
      group,
      rule.filled(form) ||
        (refused !== undefined && rule.fieldPrefixes.some((prefix) => refused.startsWith(prefix))),
    ]),
  );
}
