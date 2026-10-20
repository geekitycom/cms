import { COMMENTS_FRONT_MATTER_KEY } from './comments.ts';
import { CONTACT_FRONT_MATTER_KEY } from './contact.ts';
import { LANG_FRONT_MATTER_KEY } from './language.ts';
import type { SyndicationTarget } from './syndicate-to.ts';
import type { CitationProperty } from './citation.ts';
import type { Document } from './document.ts';
import type { DocumentKind } from './document-kind.ts';
import type { Enclosure } from './enclosure.ts';
import { BLANK_ENCLOSURE_FORM } from './enclosure-form.ts';
import type { EnclosureForm } from './enclosure-form.ts';
import { BLANK_EVENT_FORM } from './event-form.ts';
import type { EventForm } from './event-form.ts';
import type { PostLocation } from './location.ts';
import { BLANK_LOCATION_FORM, locationForm } from './location-form.ts';
import type { LocationForm } from './location-form.ts';
import type { Photo } from './photo.ts';
import type { PhotoRow } from './photo-form.ts';
import type { PostField } from './post-fields.ts';
import { wallClockIn } from './time.ts';
import { VISIBILITY_FRONT_MATTER_KEY, visibilityOf } from './visibility.ts';
import type { StoredVisibility } from './visibility.ts';

/**
 * The Eleventy key that keeps a document out of every collection.
 *
 * The CMS does not model it — it is not in `KNOWN_FRONT_MATTER_KEYS` — so the
 * parser leaves it in {@link Document.extra} and the editor reads and writes it
 * there, alongside every other key somebody added by hand.
 */
export const EXCLUDE_KEY = 'eleventyExcludeFromCollections';

/**
 * What the editor's Comments field can say: leave it to the site's rules, hold
 * this document open, or close it.
 *
 * The values are the strings the form submits and the template renders as
 * options, spelled once so the two cannot drift.
 */
export const COMMENT_SETTINGS = { site: '', open: 'open', closed: 'closed' } as const;

/** What a document's front matter already says about comments. */
function commentSettingOf(document: Document): string {
  const own = document.extra[COMMENTS_FRONT_MATTER_KEY];
  if (own === true) return COMMENT_SETTINGS.open;
  if (own === false) return COMMENT_SETTINGS.closed;
  return COMMENT_SETTINGS.site;
}

/**
 * The editor field each citing property fills (TASK-169). The form submits it
 * under the property's own name, as `in-reply-to` is.
 */
export const CITATION_FIELDS = {
  'repost-of': 'repostOf',
  'like-of': 'likeOf',
  'bookmark-of': 'bookmarkOf',
} as const satisfies Record<CitationProperty, keyof EditorForm>;

/** The editor's fields, as strings, which is what a form has. */
export interface EditorForm {
  title: string;
  slug: string;
  permalink: string;
  date: string;
  tags: string;
  categories: string;
  description: string;
  /**
   * Who the front matter says wrote this, as the select submits it (TASK-67).
   *
   * A username, because doc-2's `author` names a user after decision-14 — but
   * kept as the raw string rather than as a resolved user, because a form is
   * strings and because a file that still holds a display name from before
   * decision-14 has to be offered back as what it says until somebody saves it.
   */
  author: string;
  /** The post this one replies to, the mf2 `in-reply-to`. Posts only. */
  inReplyTo: string;
  /**
   * Whether the author is going to the event `inReplyTo` names, the mf2
   * `rsvp` (TASK-198), as the file or the form spells it. Posts only.
   */
  rsvp: string;
  /** The post this one reposts, the mf2 `repost-of` (TASK-169). Posts only. */
  repostOf: string;
  /** The post this one likes, the mf2 `like-of` (TASK-169). Posts only. */
  likeOf: string;
  /** The page this one bookmarks, the mf2 `bookmark-of` (TASK-169). Posts only. */
  bookmarkOf: string;
  /** When and where the post's event is (TASK-200). Posts only. */
  event: EventForm;
  /** The language it is written in, the `lang` key; empty for the site's. */
  lang: string;
  draft: boolean;
  /**
   * Whether the document is listed or only served at its URL (TASK-227), or a
   * value the site does not recognize, which hides it until one is chosen.
   */
  visibility: StoredVisibility;
  /** Whether `eleventyExcludeFromCollections` is set. Pages only. */
  exclude: boolean;
  /** Whether the page offers a contact form. Pages only. */
  contact: boolean;
  /** Whether the post is pinned to its author's profile (TASK-207). Posts only. */
  pinned: boolean;
  /**
   * Whether the post hides the previews of the pages it cites, `preview:
   * false` (TASK-252). Posts only.
   */
  previewHidden: boolean;
  /**
   * The alt text of an image the post cites, `cited-alt` (TASK-255). Posts
   * only; empty for none, when the post's title describes it.
   */
  citedAlt: string;
  /**
   * What the document says about comments: one of {@link COMMENT_SETTINGS}.
   *
   * Three values rather than a checkbox, because there are three answers: the
   * site's rules decide (the front matter says nothing), always open, always
   * closed. A checkbox could only ever spell two of them, and the one it would
   * lose is the default every document starts at.
   */
  comments: string;
  /** The post's recording (TASK-213). Posts only; blank on a page. */
  enclosure: EnclosureForm;
  /** The post's photos (TASK-166), without the blank row the editor adds. Posts only. */
  photos: PhotoRow[];
  /**
   * Where the post was written (TASK-223). Posts only; blank on a page. It is
   * the one field that is not written into the file: the save puts it in
   * `data/locations.json` under the post's permalink (decision-29).
   */
  location: LocationForm;
  /** The ids of the declared syndication targets it selects (TASK-155). Posts only. */
  syndicateTo: string[];
  body: string;
  /** The hash of the file the form was filled in from; empty for a new one. */
  hash: string;
}

const BLANK_POST_FIELDS = {
  rsvp: '',
  repostOf: '',
  likeOf: '',
  bookmarkOf: '',
  event: BLANK_EVENT_FORM,
  pinned: false,
  previewHidden: false,
  citedAlt: '',
  enclosure: BLANK_ENCLOSURE_FORM,
  photos: [],
  syndicateTo: [],
} satisfies Partial<EditorForm>;

type PostFieldsForm = Pick<EditorForm, keyof typeof BLANK_POST_FIELDS>;

export function postFieldsForm(
  kind: DocumentKind,
  value: (field: PostField) => Partial<EditorForm>,
): PostFieldsForm {
  return kind.fields.reduce<PostFieldsForm>(
    (form, field) => ({ ...form, ...value(field) }),
    BLANK_POST_FIELDS,
  );
}

export const AUTHOR_UNTIL_REQUEST = '';

/**
 * The editor for a document that does not exist yet.
 *
 * The date field is filled in with the clock as the site's own zone reads it,
 * not with an instant: what a form offers is what a form takes back, and per
 * decision-11 an offset-less date in this field means the site's zone.
 */
export function blankForm(kind: DocumentKind, timezone: string, now: Date): EditorForm {
  return {
    title: '',
    slug: '',
    permalink: '',
    date: kind.dated ? wallClockIn(now, timezone) : '',
    tags: '',
    categories: '',
    description: '',
    author: AUTHOR_UNTIL_REQUEST,
    inReplyTo: '',
    ...BLANK_POST_FIELDS,
    lang: '',
    draft: false,
    visibility: 'public',
    exclude: false,
    contact: false,
    comments: COMMENT_SETTINGS.site,
    location: BLANK_LOCATION_FORM,
    body: '',
    hash: '',
  };
}

/**
 * The editor for a document that does.
 *
 * The stored instant is shown as the clock in the site's zone reads it, and
 * {@link wallClockIn} keeps whatever precision the instant has, so a form
 * submitted with the field untouched writes back the very instant it was
 * filled in from.
 *
 * `location` is what `data/locations.json` holds for the post (decision-29),
 * which a document does not carry. It is required because a form loaded
 * without it would remove the stored location on save.
 */
export function formFor(
  kind: DocumentKind,
  document: Document,
  timezone: string,
  location: PostLocation | undefined,
): EditorForm {
  return {
    title: document.title,
    slug: document.slug,
    permalink: document.permalink,
    date: document.date === undefined ? '' : wallClockIn(document.date, timezone),
    tags: document.tags.join(', '),
    categories: document.categories.join(', '),
    description: document.description ?? '',
    author: document.author ?? '',
    inReplyTo: document.inReplyTo ?? '',
    ...postFieldsForm(kind, (field) => field.read(document, timezone)),
    lang:
      typeof document.extra[LANG_FRONT_MATTER_KEY] === 'string'
        ? document.extra[LANG_FRONT_MATTER_KEY]
        : '',
    draft: document.draft,
    visibility: visibilityOf(document),
    exclude: document.extra[EXCLUDE_KEY] === true,
    contact: document.extra[CONTACT_FRONT_MATTER_KEY] === true,
    comments: commentSettingOf(document),
    location: kind.located ? locationForm(location) : BLANK_LOCATION_FORM,
    body: document.body,
    hash: document.hash,
  };
}

/**
 * A comma-separated taxonomy field as a list, without the blanks and the
 * repeats. Tags and categories are both entered this way.
 */
export function splitTags(value: string): string[] {
  const tags: string[] = [];
  for (const tag of value.split(',')) {
    const trimmed = tag.trim();
    if (trimmed !== '' && !tags.includes(trimmed)) tags.push(trimmed);
  }
  return tags;
}

/** The post's recording and photos, as a form resolved them against the media library. */
export interface ResolvedMedia {
  readonly recording: Enclosure | undefined;
  readonly photos: readonly Photo[];
}

/**
 * The front matter to write that the CMS does not model.
 *
 * What the file already carried comes back out untouched, so a key somebody
 * added by hand survives every admin save (doc-2). The one such key the editor
 * has a field for is `eleventyExcludeFromCollections`: ticking the box writes
 * it, and clearing the box takes the key back out rather than leaving a
 * `false` behind — unless the file spelled the key out itself, in which case
 * the `false` is written, because a key somebody wrote by hand is not the
 * editor's to delete.
 */
export function extraFromForm(
  kind: DocumentKind,
  document: Document | undefined,
  form: EditorForm,
  now: Date,
  media: ResolvedMedia,
  declared: readonly SyndicationTarget[],
  timezone: string,
): Record<string, unknown> {
  const extra: Record<string, unknown> = { ...(document?.extra ?? {}) };

  for (const field of kind.fields) {
    field.write(extra, form, { document, now, media, declared, timezone });
  }

  if (form.visibility === 'public') delete extra[VISIBILITY_FRONT_MATTER_KEY];
  else if (typeof form.visibility === 'string')
    extra[VISIBILITY_FRONT_MATTER_KEY] = form.visibility;
  else extra[VISIBILITY_FRONT_MATTER_KEY] = form.visibility.unrecognized;

  // Empty is the site's language, which is the key's absence (TASK-154).
  if (form.lang === '') delete extra[LANG_FRONT_MATTER_KEY];
  else extra[LANG_FRONT_MATTER_KEY] = form.lang;

  // The post's own answer about comments, or none at all: "site default" is
  // the absence of the key rather than a value, because that is what every
  // reader of it — the CMS, an Eleventy build, a person looking at the file —
  // already understands, and writing `comments: null` would say nothing new.
  if (form.comments === COMMENT_SETTINGS.open) extra[COMMENTS_FRONT_MATTER_KEY] = true;
  else if (form.comments === COMMENT_SETTINGS.closed) extra[COMMENTS_FRONT_MATTER_KEY] = false;
  else delete extra[COMMENTS_FRONT_MATTER_KEY];

  if (kind.excludable) {
    if (form.exclude) extra[EXCLUDE_KEY] = true;
    else if (EXCLUDE_KEY in extra) extra[EXCLUDE_KEY] = false;
  }

  if (kind.contactable) {
    // Written or removed, never `false`: it is the CMS's own key, and absent
    // and false mean the same thing to everything that reads it (TASK-56).
    if (form.contact) extra[CONTACT_FRONT_MATTER_KEY] = true;
    else delete extra[CONTACT_FRONT_MATTER_KEY];
  }

  return extra;
}

export function formInReplyTo(
  kind: DocumentKind,
  form: EditorForm,
  document: Document | undefined,
): string | undefined {
  if (!kind.replies) return document?.inReplyTo;
  return form.inReplyTo === '' ? undefined : form.inReplyTo;
}
