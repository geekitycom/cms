import { COMMENT_SETTINGS } from '../content/document-form.ts';
import type { EditorForm } from '../content/document-form.ts';
import type { EditorField } from '../content/form-error.ts';
import { EDITOR_KINDS } from './editor-kinds.ts';
import type { EditorSection, PostKind } from './editor-kinds.ts';

export type EditorGroup =
  'location' | 'versions' | 'taxonomy' | 'address' | 'summary' | 'syndication' | 'display';

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

function locationFilled({ location: at }: EditorForm): boolean {
  return filledIn(at.geo, at.accuracy, at.name, at.locality, at.region, at.country, at.checkin);
}

const GROUPS: Readonly<Record<EditorGroup, GroupRule>> = {
  location: { filled: locationFilled, fieldPrefixes: ['editor-location-'] },
  versions: {
    filled: (form) => form.enclosure.alternates.length > 0,
    fieldPrefixes: ['editor-alternate-'],
  },
  taxonomy: { filled: alwaysOpen, fieldPrefixes: [] },
  address: {
    filled: (form) => filledIn(form.slug, form.permalink, form.aliases),
    fieldPrefixes: ['editor-slug', 'editor-permalink', 'editor-aliases'],
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
    filled: (form) =>
      form.comments !== COMMENT_SETTINGS.site || form.exclude || form.contact || form.pinned,
    fieldPrefixes: ['editor-comments', 'editor-exclude', 'editor-contact', 'editor-pinned'],
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

const SECTION_FILLED: Readonly<Record<EditorSection, (form: EditorForm) => boolean>> = {
  photos: (form) => form.photos.length > 0,
  link: (form) =>
    filledIn(form.likeOf, form.repostOf, form.bookmarkOf) ||
    (form.inReplyTo !== '' && form.rsvp === ''),
  rsvp: (form) => form.rsvp !== '',
  event: ({ event }) => filledIn(event.start, event.end, event.location),
  checkin: () => false,
  episode: ({ enclosure }) =>
    filledIn(
      enclosure.url,
      enclosure.duration,
      enclosure.transcriptUrl,
      enclosure.transcriptType,
    ) || enclosure.alternates.length > 0,
  review: ({ review: { kind: _kind, ...rest } }) =>
    Object.values(rest).some((value) => value !== ''),
};

export interface EditorSections {
  own: EditorSection[];
  also: EditorSection[];
  shown: Record<EditorSection, boolean>;
  filled: Record<EditorSection, boolean>;
}

const SECTION_ORDER: readonly EditorSection[] = [
  'checkin',
  'link',
  'rsvp',
  'event',
  'review',
  'photos',
  'episode',
];

export function editorSections(kind: PostKind, form: EditorForm): EditorSections {
  const own = [...EDITOR_KINDS[kind].sections];
  const filled = Object.fromEntries(
    SECTION_ORDER.map((section) => [section, SECTION_FILLED[section](form)]),
  ) as Record<EditorSection, boolean>;
  const also = SECTION_ORDER.filter((section) => !own.includes(section) && filled[section]);
  const shown = Object.fromEntries(
    SECTION_ORDER.map((section) => [section, own.includes(section) || also.includes(section)]),
  ) as Record<EditorSection, boolean>;
  return { own, also, shown, filled };
}

export function sidebarLocation(kind: PostKind, form: EditorForm): boolean {
  if (kind === 'checkin') return false;
  return kind !== 'event' || locationFilled(form);
}
