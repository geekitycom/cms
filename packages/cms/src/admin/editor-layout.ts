/**
 * Which of the post editor's blocks and side-column groups start open
 * (TASK-245).
 *
 * Each is a native `<details>`, folded when nothing in it is filled in, so a
 * post that uses three boxes is not a page of twenty empty ones. A group that
 * holds a value or the box a save was refused for is always open: nothing
 * typed is ever out of sight, and the error summary's link always lands on a
 * box that can be seen.
 */
import { COMMENT_SETTINGS } from './documents.ts';
import type { EditorForm } from './documents.ts';

/** The id of one of the editor's boxes, which a refused save names so its summary can link to it. */
export type EditorField = `editor-${string}`;

/** Why a save was refused, and the box it was refused for, when it was one box. */
export interface Refusal {
  readonly message: string;
  readonly field?: EditorField | undefined;
}

/** What a check of the editor's own fields says is wrong, and in which box. */
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
  | 'read'
  | 'summary'
  | 'syndication'
  | 'display';

interface GroupRule {
  readonly filled: (form: EditorForm) => boolean;
  /** Prefixes of the ids of the boxes in the group. */
  readonly fields: readonly EditorField[];
}

function filledIn(...values: (string | boolean)[]): boolean {
  return values.some((value) => value !== '' && value !== false);
}

const GROUPS: Readonly<Record<EditorGroup, GroupRule>> = {
  photos: { filled: (form) => form.photos.length > 0, fields: ['editor-photo-'] },
  location: {
    filled: ({ location: at }) =>
      filledIn(at.geo, at.accuracy, at.name, at.locality, at.region, at.country, at.checkin),
    fields: ['editor-location-'],
  },
  recording: {
    filled: ({ enclosure }) =>
      filledIn(
        enclosure.url,
        enclosure.duration,
        enclosure.transcriptUrl,
        enclosure.transcriptType,
      ) || enclosure.alternates.length > 0,
    fields: ['editor-enclosure-', 'editor-alternate-'],
  },
  versions: {
    filled: (form) => form.enclosure.alternates.length > 0,
    fields: ['editor-alternate-'],
  },
  // What every save decides, so it is never folded away.
  publishing: { filled: () => true, fields: [] },
  taxonomy: { filled: () => true, fields: [] },
  address: {
    filled: (form) => filledIn(form.slug, form.permalink),
    fields: ['editor-slug', 'editor-permalink'],
  },
  responding: {
    filled: (form) => filledIn(form.inReplyTo, form.likeOf, form.repostOf, form.bookmarkOf),
    fields: ['editor-in-reply-to', 'editor-like-of', 'editor-repost-of', 'editor-bookmark-of'],
  },
  read: {
    filled: ({ readStatus, readOf: of }) =>
      filledIn(readStatus, of.name, of.author, of.uid, of.url),
    fields: ['editor-read-'],
  },
  summary: {
    filled: (form) => filledIn(form.description, form.lang),
    fields: ['editor-description', 'editor-lang'],
  },
  syndication: { filled: (form) => form.syndicateTo.length > 0, fields: ['editor-syndicate-to-'] },
  display: {
    filled: (form) => form.comments !== COMMENT_SETTINGS.site || form.exclude || form.contact,
    fields: ['editor-comments', 'editor-exclude', 'editor-contact'],
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
        (refused !== undefined && rule.fields.some((prefix) => refused.startsWith(prefix))),
    ]),
  );
}
