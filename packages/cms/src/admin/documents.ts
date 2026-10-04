import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type { Context, Hono } from 'hono';

import {
  CITATION_PROPERTIES,
  citationText,
  CITED_ALT_FRONT_MATTER_KEY,
  citedHost,
  PREVIEW_FRONT_MATTER_KEY,
  previewShown,
} from '../content/citation.ts';
import type { CitationProperty } from '../content/citation.ts';
import type { Document, DocumentContent, DocumentType } from '../content/document.ts';
import { renderMarkdown } from '../content/markdown.ts';
import { parseDocument } from '../content/parser.ts';
import { PINNED_FRONT_MATTER_KEY, PINNED_POST_LIMIT, pinnedAt } from '../content/pinned.ts';
import { discoverPostType, postLabel, replyTarget } from '../content/post-type.ts';
import type { PostType } from '../content/post-type.ts';
import {
  isReadStatus,
  READ_OF_FRONT_MATTER_KEY,
  READ_STATUS_FRONT_MATTER_KEY,
  READ_STATUS_LABELS,
  READ_STATUSES,
  readWork,
  readWorkFrontMatter,
} from '../content/read.ts';
import type { Read } from '../content/read.ts';
import {
  ENCLOSURE_FRONT_MATTER_KEY,
  enclosureOf,
  isWebUrl,
  TRANSCRIPT_TYPES,
} from '../content/enclosure.ts';
import type { Enclosure } from '../content/enclosure.ts';
import { PHOTO_FRONT_MATTER_KEY, photoFrontMatter } from '../content/photo.ts';
import type { Photo } from '../content/photo.ts';
import type { PostLocation } from '../content/location.ts';
import { keptProperties } from '../content/kept-properties.ts';
import type { KeptProperties } from '../content/kept-properties.ts';
import { postLocations } from '../content/locations.ts';
import { contentFilePath, freeSlug, saveDocument } from '../content/save.ts';
import { scheduledFor } from '../content/schedule.ts';
import { htmlToText } from '../content/search.ts';
import { defaultPermalink, slugify } from '../content/slug.ts';
import { DuplicatePermalinkError, isTrashedPath, TRASH_DIRECTORY } from '../content/store.ts';
import type { ContentStore, ListAllOptions } from '../content/store.ts';
import {
  calendarDayIn,
  DEFAULT_TIMEZONE,
  toUtcInstant,
  wallClockIn,
  zoneLabel,
} from '../content/time.ts';
import { isVisibility, VISIBILITY_FRONT_MATTER_KEY, visibilityOf } from '../content/visibility.ts';
import type { StoredVisibility } from '../content/visibility.ts';
import { normalizeBody, serializeDocument } from '../content/writer.ts';
import type { ResolvedConfig } from '../config.ts';
import type { DocumentChange } from '../content/sync.ts';
import type { GeekityEnv } from '../env.ts';
import { readAltTexts, undescribedImages, undescribedPhotos } from '../images/alt-text.ts';
import type { UndescribedImage } from '../images/alt-text.ts';
import { isServed } from '../web/documents.ts';
import { LANG_FRONT_MATTER_KEY } from '../web/locale.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { COMMENTS_FRONT_MATTER_KEY } from '../comments/policy.ts';
import { CONTACT_FRONT_MATTER_KEY } from '../contact/form.ts';
import { authorNames, userForAuthor } from '../web/authors.ts';
import { findUserById, listUsers } from './accounts.ts';
import type { User } from './accounts.ts';
import { flash } from './flash.ts';
import { formatInTimezone } from './formatting.ts';
import { LANGUAGE_TAG_PATTERN, readSiteSettings } from './settings.ts';
import { PREVIEW_PATH } from './preview.ts';
import { ADMIN_PREFIX } from './session.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { UPLOADS_PATH } from './uploads.ts';
import {
  BLANK_ALTERNATE_ROW,
  BLANK_ENCLOSURE_FORM,
  ENCLOSURE_FIELDS,
  enclosureChoices,
  enclosureForm,
  enclosureFrontMatter,
  readEnclosureForm,
  resolveEnclosure,
} from './enclosure-field.ts';
import type { EnclosureForm } from './enclosure-field.ts';
import { openGroups } from './editor-layout.ts';
import type { EditorField, Refusal } from './editor-layout.ts';
import { allowGeolocation } from './headers.ts';
import {
  BLANK_LOCATION_FORM,
  LOCATION_FIELDS,
  locationForm,
  readLocationForm,
  resolveLocation,
} from './location-field.ts';
import type { LocationForm } from './location-field.ts';
import {
  PHOTO_FIELDS,
  photoChoices,
  photoRows,
  photoRowViews,
  readPhotoForm,
  resolvePhotos,
} from './photo-field.ts';
import type { PhotoRow } from './photo-field.ts';
import {
  BLANK_READ_OF_FORM,
  READ_FIELDS,
  readOfForm,
  resolveRead,
  submittedReadOfForm,
} from './read-field.ts';
import type { ReadOfForm } from './read-field.ts';
import {
  SYNDICATE_TO_FRONT_MATTER_KEY,
  syndicateToOf,
  syndicationTargetsReader,
} from '../webmention/syndication.ts';
import { citesAnImage, shownInFull } from '../webmention/cited-picture.ts';
import type { CitedPicture } from '../webmention/cited-picture.ts';
import type { ReplyContext } from '../webmention/reply-context.ts';
import type { SyndicationTarget } from '../webmention/syndication.ts';

/**
 * Everything that differs between the posts screens and the pages screens.
 *
 * Posts and pages are the same screens over the same store with two knobs
 * turned: a post carries a date and taxonomy, a page carries neither. Keeping the
 * difference in data rather than in two copies of the code is what lets
 * `/admin/pages` be one call to {@link mountDocumentScreens}.
 */
export interface DocumentKind {
  /** Which documents these screens show. */
  type: DocumentType;
  /** The navigation section they mark as current. */
  section: string;
  /** Root of the screens, e.g. `/admin/posts`. */
  basePath: string;
  /** How one of them is named in a sentence, e.g. `post`. */
  singular: string;
  /** The heading over the listing, e.g. `Posts`. */
  plural: string;
  /** Whether a document of this kind has a publish date. */
  dated: boolean;
  /** Whether a document of this kind carries tags. */
  tagged: boolean;
  /** Whether a document of this kind is filed under categories. */
  categorised: boolean;
  /**
   * Whether the editor offers the `eleventyExcludeFromCollections` flag. doc-2
   * mirrors it for pages that should not list; a post is in the archive by
   * definition and has no use for it.
   */
  excludable: boolean;
  /**
   * Whether the editor offers the contact form (TASK-56). Pages only: a form
   * for writing to the site belongs on a standing page rather than under one
   * post out of a thousand.
   *
   * The front matter key itself is honoured wherever it is written, so a theme
   * that includes the partial in its post layout is free to; this only decides
   * where the checkbox is offered.
   */
  contactable: boolean;
}

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

/** A submitted Comments field, or the site default for anything else. */
function commentSetting(value: string): string {
  return value === COMMENT_SETTINGS.open || value === COMMENT_SETTINGS.closed
    ? value
    : COMMENT_SETTINGS.site;
}

function formVisibility(value: string): StoredVisibility {
  if (value === '') return 'public';
  return isVisibility(value) ? value : { unrecognized: value };
}

/** What a document's front matter already says about comments. */
function commentSettingOf(document: Document): string {
  const own = document.extra[COMMENTS_FRONT_MATTER_KEY];
  if (own === true) return COMMENT_SETTINGS.open;
  if (own === false) return COMMENT_SETTINGS.closed;
  return COMMENT_SETTINGS.site;
}

/** The posts screens: dated, tagged, categorised, filed under `posts/`. */
export const POST_KIND: DocumentKind = {
  type: 'post',
  section: 'posts',
  basePath: `${ADMIN_PREFIX}/posts`,
  singular: 'post',
  plural: 'Posts',
  dated: true,
  tagged: true,
  categorised: true,
  excludable: false,
  contactable: false,
};

/** The pages screens: standing content, no date prefix and no taxonomy. */
export const PAGE_KIND: DocumentKind = {
  type: 'page',
  section: 'pages',
  basePath: `${ADMIN_PREFIX}/pages`,
  singular: 'page',
  plural: 'Pages',
  dated: false,
  tagged: false,
  categorised: false,
  excludable: true,
  contactable: true,
};

/** The URL of the editor for one document. */
export function editorPath(kind: DocumentKind, slug: string): string {
  return `${kind.basePath}/${encodeURIComponent(slug)}`;
}

/** The URL of the editor for a document that does not exist yet. */
export function newEditorPath(kind: DocumentKind): string {
  return `${kind.basePath}/new`;
}

/**
 * The views of a listing doc-5 asks for, plus the one scheduling adds.
 *
 * `published` means published *and* out: a post whose date has not arrived is
 * under `scheduled` and nowhere else, because a listing that showed it as
 * published would disagree with the site, which is not serving it.
 */
export type DocumentFilter = 'all' | 'published' | 'scheduled' | 'draft' | 'trash';

/** The filters, in the order they are shown. */
export const DOCUMENT_FILTERS: readonly DocumentFilter[] = [
  'all',
  'published',
  'scheduled',
  'draft',
  'trash',
];

/** How many rows one page of a listing holds. */
export const DOCUMENTS_PER_PAGE = 25;

/** The filter a query string asked for, defaulting to everything live. */
export function documentFilter(value: string | undefined): DocumentFilter {
  return DOCUMENT_FILTERS.includes(value as DocumentFilter) ? (value as DocumentFilter) : 'all';
}

/** {@link ContentStore.listAll} options for one kind and one filter. */
export function listOptionsFor(kind: DocumentKind, filter: DocumentFilter): ListAllOptions {
  return {
    type: kind.type,
    trashed: filter === 'trash',
    ...(filter === 'published' ? { draft: false, scheduled: false } : {}),
    ...(filter === 'scheduled' ? { draft: false, scheduled: true } : {}),
    ...(filter === 'draft' ? { draft: true } : {}),
  };
}

/** How {@link mountDocumentScreens} renders one admin template. */
export type AdminRender = (
  c: Context<GeekityEnv>,
  template: string,
  context?: Record<string, unknown>,
) => Response;

/** What {@link mountDocumentScreens} needs from the admin around it. */
export interface MountDocumentScreensOptions {
  /** Which documents the screens are for. */
  kind: DocumentKind;
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/**
 * Register the listing and the editor for one kind of document.
 *
 * Both `/admin/posts` and `/admin/pages` are this function with a different
 * {@link DocumentKind}: the screens, the templates and the write path are
 * shared, and the kind decides what a file is called, whether the form has a
 * date and a taxonomy, and which section of the navigation marks itself.
 */
export function mountDocumentScreens(
  app: Hono<GeekityEnv>,
  options: MountDocumentScreensOptions,
): void {
  const { kind, render } = options;

  app.get(kind.basePath, (c) => {
    const filter = documentFilter(c.req.query('status'));
    const pageNumber = Math.max(1, Number(c.req.query('page') ?? '1') || 1);
    const offset = (pageNumber - 1) * DOCUMENTS_PER_PAGE;

    // One row more than fits, so "is there another page" costs no second query.
    const found = c.var.store.listAll({
      ...listOptionsFor(kind, filter),
      limit: DOCUMENTS_PER_PAGE + 1,
      offset,
    });
    const rows = found.slice(0, DOCUMENTS_PER_PAGE);

    return render(c, ADMIN_TEMPLATES.documentList, {
      section: kind.section,
      child: 'all',
      kind,
      filter,
      filters: DOCUMENT_FILTERS.map((name) => ({
        name,
        label: FILTER_LABELS[name],
        url: listingUrl(kind, name, 1),
        current: name === filter,
      })),
      documents: rows.map((document) =>
        listRow(kind, document, c.var.store.now(), pageRole(kind, document, c)),
      ),
      newUrl: newEditorPath(kind),
      returnUrl: listingUrl(kind, filter, pageNumber),
      page: pageNumber,
      previousUrl: pageNumber > 1 ? listingUrl(kind, filter, pageNumber - 1) : undefined,
      nextUrl: found.length > rows.length ? listingUrl(kind, filter, pageNumber + 1) : undefined,
    });
  });

  // Registered before the slug route, so a document can never take the URL of
  // the form that makes a new one.
  app.get(newEditorPath(kind), (c) =>
    renderEditor(c, {
      kind,
      render,
      document: undefined,
      form: blankForm(kind, siteTimezone(c), c.var.store.now()),
    }),
  );

  app.post(newEditorPath(kind), async (c) =>
    saveFromForm(c, { kind, render, document: undefined, body: await c.req.parseBody() }),
  );

  app.get(`${kind.basePath}/:slug`, (c) => {
    const document = findBySlug(c.var.store, kind, c.req.param('slug'));
    if (document === undefined) return c.notFound();
    const location = postLocations(c.var.config.dataDir).read(document.permalink);
    return renderEditor(c, {
      kind,
      render,
      document,
      form: formFor(document, siteTimezone(c), location),
    });
  });

  app.post(`${kind.basePath}/:slug`, async (c) => {
    const document = findBySlug(c.var.store, kind, c.req.param('slug'));
    if (document === undefined) return c.notFound();

    const body = await c.req.parseBody();
    const action = text(body['action']);

    if (action === 'trash' || action === 'restore') {
      return moveDocument(c, { kind, document, action, returnTo: text(body['return']) });
    }
    return saveFromForm(c, { kind, render, document, body });
  });
}

/** What a submitted editor form asks for. */
interface SaveFromFormOptions {
  kind: DocumentKind;
  render: AdminRender;
  /** The document being replaced, or `undefined` when one is being made. */
  document: Document | undefined;
  body: Record<string, unknown>;
}

/**
 * Write what the editor submitted through {@link writeDocument}, and answer
 * with the editor again: the refusal on the form, the conflict side by side,
 * or the saved document under a flash.
 */
async function saveFromForm(
  c: Context<GeekityEnv>,
  options: SaveFromFormOptions,
): Promise<Response> {
  const { kind, render, document, body } = options;
  const store = c.var.store;
  const contentDir = c.var.config.contentDir;

  const form: EditorForm = {
    title: text(body['title']).trim(),
    slug: text(body['slug']).trim(),
    permalink: text(body['permalink']).trim(),
    date: text(body['date']).trim(),
    tags: text(body['tags']).trim(),
    categories: text(body['categories']).trim(),
    description: text(body['description']).trim(),
    author: text(body['author']).trim(),
    inReplyTo: text(body['in-reply-to']).trim(),
    ...citationFields((property) => (kind.type === 'post' ? text(body[property]).trim() : '')),
    readStatus: kind.type === 'post' ? text(body[READ_FIELDS.status]).trim() : '',
    readOf: kind.type === 'post' ? submittedReadOfForm(body) : BLANK_READ_OF_FORM,
    lang: text(body['lang']).trim(),
    draft: body['draft'] !== undefined,
    visibility: formVisibility(text(body['visibility'])),
    exclude: body['exclude'] !== undefined,
    contact: body['contact'] !== undefined,
    pinned: kind.type === 'post' && body['pinned'] !== undefined,
    previewHidden: kind.type === 'post' && body[PREVIEW_FRONT_MATTER_KEY] !== undefined,
    citedAlt: kind.type === 'post' ? text(body[CITED_ALT_FRONT_MATTER_KEY]).trim() : '',
    comments: commentSetting(text(body['comments'])),
    enclosure: kind.type === 'post' ? readEnclosureForm(body) : BLANK_ENCLOSURE_FORM,
    photos: kind.type === 'post' ? readPhotoForm(body) : [],
    location: kind.type === 'post' ? readLocationForm(body) : BLANK_LOCATION_FORM,
    syndicateTo:
      kind.type === 'post'
        ? syndicationTargetsReader(contentDir)()
            .filter((target) => body[syndicateToField(target)] !== undefined)
            .map((target) => target.id)
        : [],
    body: normalizeBody(text(body['body'])),
    hash: text(body['hash']),
  };

  const action = text(body['action']);
  // The buttons doc-5 names are shortcuts past the checkbox: Save draft and
  // Publish say what they do, and Update leaves the decision to the checkbox.
  const draft = action === 'save-draft' ? true : action === 'publish' ? false : form.draft;

  function refuse(refusal: Refusal): Promise<Response> {
    return renderEditor(c, {
      kind,
      render,
      document,
      form: { ...form, draft },
      refusal,
      status: 400,
    });
  }

  const written = await writeDocument(
    {
      store,
      config: c.var.config,
      announce: c.var.announce,
      writer: currentUsername(c),
      citedContext: (target) => c.var.replyContexts.describe(target),
      storedContext: (target) => c.var.replyContexts.read(target),
    },
    { kind, document, form, draft },
  );
  if (written.outcome === 'refused') return refuse(written);
  if (written.outcome === 'conflict') {
    return renderConflict(c, {
      kind,
      render,
      document: written.document,
      form: { ...form, draft },
      media: written.media,
      conflict: written.conflict,
    });
  }
  const { saved, undescribed } = written;

  flash(c, 'notice', savedMessage(kind, document, saved, store.now()));
  if (undescribed.length > 0) flash(c, 'warning', missingAltText(undescribed));
  return c.redirect(editorPath(kind, saved.slug), 303);
}

/** What a write needs from the site, as plain values rather than a request. */
export interface DocumentSite {
  readonly store: ContentStore;
  readonly config: ResolvedConfig;
  readonly announce: (change: DocumentChange) => Promise<void>;
  /** The username of whoever is writing: the author a new document starts on. */
  readonly writer: string | undefined;
  /** What a cited page says about itself, which an untitled new post is named after. */
  readonly citedContext: (target: string) => Promise<ReplyContext | undefined>;
  /** What the file holds for a cited page, without asking it. */
  readonly storedContext: (target: string) => ReplyContext | undefined;
}

/** What {@link writeDocument} is asked to write. */
export interface DocumentWrite {
  readonly kind: DocumentKind;
  /** The document being replaced, or `undefined` when one is being made. */
  readonly document: Document | undefined;
  readonly form: EditorForm;
  /** Whether it is saved as a draft, which the editor's buttons decide. */
  readonly draft: boolean;
  readonly keptProperties?: KeptProperties | undefined;
}

/** What came of a {@link writeDocument}. */
export type WriteOutcome =
  | {
      readonly outcome: 'saved';
      readonly saved: Document;
      /** Images published without alt text, which the editor warns about. */
      readonly undescribed: readonly UndescribedImage[];
    }
  | ({ readonly outcome: 'refused' } & Refusal)
  | {
      readonly outcome: 'conflict';
      /** The document as the form loaded it, which only an edit has. */
      readonly document: Document;
      /** The recording and the photos the form resolved to. */
      readonly media: ResolvedMedia;
      readonly conflict: Conflict;
    };

/** The post's recording and photos, as a form resolved them against the media library. */
interface ResolvedMedia {
  readonly recording: Enclosure | undefined;
  readonly photos: readonly Photo[];
}

/**
 * The write path behind the editor and Micropub (TASK-164): one form in, one
 * file out, announced to every subscriber.
 *
 * The order matters: the form is checked before anything is touched, the
 * on-disk file is re-hashed and compared with the hash the form loaded with
 * (doc-1's conflict rule), and only then is a file written. A write that is
 * refused leaves the content directory exactly as it was.
 */
export async function writeDocument(
  site: DocumentSite,
  write: DocumentWrite,
): Promise<WriteOutcome> {
  const { store, config, writer } = site;
  const { kind, document, form, draft } = write;
  const contentDir = config.contentDir;

  function refused(message: string, field?: EditorField): WriteOutcome {
    return { outcome: 'refused', message, field };
  }

  // A post with no title is a note; a page is always named.
  if (form.title === '' && kind.type === 'page') {
    return refused(`A ${kind.singular} needs a title.`, 'editor-title');
  }

  // A post is a reply only when the target is a URL (Post Type Discovery), so
  // anything else would be saved as a reply that is not one.
  if (kind.type === 'post' && form.inReplyTo !== '' && replyTarget(form) === undefined) {
    return refused(
      'In reply to has to be a web address, like https://example.com/a-post/.',
      'editor-in-reply-to',
    );
  }

  let read: Read | undefined;
  if (kind.type === 'post') {
    for (const property of CITATION_PROPERTIES) {
      const cited = form[CITATION_FIELDS[property]];
      if (cited !== '' && !isWebUrl(cited)) {
        return refused(
          `${CITATION_LABELS[property]} has to be a web address, like https://example.com/a-post/.`,
          `editor-${property}`,
        );
      }
    }
    const resolved = resolveRead(form.readStatus, form.readOf);
    if ('error' in resolved) return refused(resolved.error, resolved.field);
    read = resolved.read;
  }
  if (read !== undefined && form.description !== '') {
    return refused(
      'A read is described by what it says, so it keeps no Description. Empty Description to save it.',
      'editor-description',
    );
  }

  if (form.lang !== '' && !LANGUAGE_TAG_PATTERN.test(form.lang)) {
    return refused('That is not a language tag, such as en, fr or pt-BR.', 'editor-lang');
  }

  let media: ResolvedMedia = { recording: undefined, photos: [] };
  if (kind.type === 'post') {
    const resolved = resolveEnclosure(
      form.enclosure,
      document === undefined ? undefined : enclosureOf(document.extra),
      contentDir,
    );
    if ('error' in resolved) return refused(resolved.error, resolved.field);
    const photos = resolvePhotos(form.photos, contentDir);
    if ('error' in photos) return refused(photos.error, photos.field);
    media = { recording: resolved.enclosure, photos: photos.photos };
  }

  let location: PostLocation | undefined;
  if (kind.type === 'post') {
    const resolved = resolveLocation(form.location);
    if ('error' in resolved) return refused(resolved.error, resolved.field);
    location = resolved.location;
  }

  // TASK-207: a pin is new when the file does not carry one yet, and only a
  // new one can take an author past Mastodon's limit.
  if (form.pinned && (document === undefined || pinnedAt(document) === undefined)) {
    const users = listUsers(config.dataDir);
    const author = userForAuthor(
      users,
      chosenAuthor(config.dataDir, form.author, document, writer) ?? '',
    );
    const names = author === undefined ? [] : authorNames(users, author);
    if (store.listPinnedByAuthor(names).length >= PINNED_POST_LIMIT) {
      return refused(
        `You can pin up to ${String(PINNED_POST_LIMIT)} posts. Unpin one first.`,
        'editor-pinned',
      );
    }
  }

  // TASK-141: an image nobody described is a problem to fix before readers
  // meet it. A draft is not checked, since nobody meets a draft.
  // A photo counts too, unless the media library describes it (TASK-166).
  const library = readAltTexts(contentDir);
  const undescribed = draft
    ? []
    : [
        ...undescribedPhotos(media.photos, library),
        ...undescribedImages(renderMarkdown(form.body), library),
      ];
  if (undescribed.length > 0 && config.requireAltText) {
    return refused(`This site publishes no image without alt text. ${missingAltText(undescribed)}`);
  }
  if (
    !draft &&
    config.requireAltText &&
    kind.type === 'post' &&
    (await citesUndescribedImage(site, document, form))
  ) {
    return refused(
      'This site publishes no image without alt text. Describe the image this post reposts in its alt text field.',
      'editor-cited-alt',
    );
  }

  const timezone = readSiteSettings(contentDir).timezone;

  // decision-11: what the file gets is a UTC instant, and an offset-less field
  // is the site's own wall clock rather than the server's.
  const typed = kind.dated ? (form.date === '' ? store.now().toISOString() : form.date) : undefined;
  if (typed !== undefined && !/^\d{4}-\d{2}-\d{2}/.test(typed)) {
    return refused(
      'A date has to start with a year, a month and a day, like 2026-03-04.',
      'editor-date',
    );
  }
  const date = typed === undefined ? undefined : toUtcInstant(typed, timezone);
  if (typed !== undefined && date === undefined) {
    return refused('That date is not one anybody can read. Try 2026-03-04 09:00.', 'editor-date');
  }

  const slug =
    slugify(form.slug) ||
    slugify(form.title) ||
    (document?.slug ?? '') ||
    noteSlug(form.body) ||
    slugify(form.readOf.name) ||
    (await typeSlug(kind, form, media.photos, site.citedContext)) ||
    'untitled';
  const trashed = document !== undefined && isTrashedPath(document.path);
  // The calendar day the document is filed under: the site zone's day at its
  // date for a new one, and the day already in the filename for one whose date
  // has not moved, so a zone changed later never moves a URL that exists.
  const filed = filedDay({ date, document, timezone });

  // A new document gets out of the way of anything that already holds its
  // name; an existing one keeps the slug it was given.
  const finalSlug =
    document === undefined
      ? await freeSlug({ contentDir, store, type: kind.type, slug, date: filed })
      : slug;

  // A URL somebody has been shown only moves when the author asks it to, by
  // editing the slug or the permalink: correcting a date refiles the file and
  // leaves the URL where it was. An empty permalink field is a form that
  // carried none, not a request to move.
  const promised = promisedDocument(document, store.now());
  const submitted = normalizePermalink(form.permalink);
  const asked =
    promised !== undefined &&
    (finalSlug !== promised.slug || (submitted !== undefined && submitted !== promised.permalink));

  const permalink =
    promised !== undefined && !asked
      ? promised.permalink
      : resolvePermalink({
          kind,
          form,
          slug: finalSlug,
          date: filed,
          document,
          timezone,
        });
  const target = documentPath({ kind, slug: finalSlug, date: filed, trashed });

  if (document !== undefined) {
    const conflict = await conflictWith(contentDir, document, form.hash);
    if (conflict !== undefined) {
      return { outcome: 'conflict', document, media, conflict };
    }
  }

  if (target !== document?.path && store.getByPath(target) !== undefined) {
    return refused(`Another ${kind.singular} already lives in ${target}.`, 'editor-slug');
  }

  const content: DocumentContent = {
    title: form.title,
    ...(date === undefined ? {} : { date }),
    updated: store.now().toISOString(),
    permalink,
    ...optional('redirectFrom', formerPermalinks(document, promised, permalink)),
    tags: kind.tagged ? splitTags(form.tags) : [],
    categories: kind.categorised ? splitTags(form.categories) : [],
    draft,
    ...(form.description === '' ? {} : { description: form.description }),
    ...optional('author', chosenAuthor(config.dataDir, form.author, document, writer)),
    ...optional('inReplyTo', replyTo(kind, form, document)),
    ...optional('activitypub', keptIdentity(document, promised, permalink, config.baseUrl)),
    extra: resolveExtra(
      kind,
      document,
      form,
      store.now(),
      media,
      syndicationTargetsReader(contentDir)(),
    ),
    body: form.body,
  };

  // The row for the old path goes first: a rename briefly leaves two rows
  // claiming one permalink, and the index refuses that.
  const renamedFrom = document !== undefined && document.path !== target ? document : undefined;
  if (renamedFrom !== undefined) store.remove(renamedFrom.path);

  let saved: Document;
  try {
    saved = await saveDocument({ contentDir, store, path: target, content, timezone });
  } catch (error) {
    // Nothing was written, so the row that was taken out of the way goes back.
    if (renamedFrom !== undefined) store.upsert(renamedFrom);
    if (error instanceof DuplicatePermalinkError) return refused(error.message);
    throw error;
  }

  if (renamedFrom !== undefined) {
    await rm(path.join(contentDir, ...renamedFrom.path.split('/')), { force: true });
  }

  if (kind.type === 'post') {
    const locations = postLocations(config.dataDir);
    const kept = keptProperties(config.dataDir);
    if (document !== undefined && document.permalink !== saved.permalink) {
      await locations.move(document.permalink, saved.permalink);
      await kept.move(document.permalink, saved.permalink);
    }
    await locations.set(saved.permalink, location);
    if (write.keptProperties !== undefined) {
      await kept.set(saved.permalink, write.keptProperties);
    }
  }

  // Announced rather than left to the watcher: the index already holds what
  // was written, so the watcher's re-read is a no-op and nobody would ever
  // hear that this post was published. Awaited, so a subscriber that writes
  // back to the file — the federation stamping `activitypub` into a post it
  // has just announced — has finished before the editor is reloaded with a
  // hash that would otherwise be one save behind.
  await site.announce({
    type: document === undefined ? 'created' : 'updated',
    path: saved.path,
    previous: document,
    next: saved,
    origin: 'admin',
  });

  return { outcome: 'saved', saved, undescribed };
}

/** What a save says about the images it found with no alt text, naming each. */
/**
 * Whether the post shows an image it cites in full with no alt text, its
 * `cited-alt` and title both empty (TASK-255). A new post asks the
 * cited page within the save's deadline, as naming it would; an edit reads
 * only what the file holds, since an edit never fetches during the save.
 */
async function citesUndescribedImage(
  site: DocumentSite,
  document: Document | undefined,
  form: EditorForm,
): Promise<boolean> {
  if (form.previewHidden || form.citedAlt !== '' || form.title !== '') return false;
  for (const property of CITATION_PROPERTIES) {
    const url = form[CITATION_FIELDS[property]];
    if (url === '' || !shownInFull(property, { kind: 'photo' })) continue;
    const context = document === undefined ? await site.citedContext(url) : site.storedContext(url);
    if (context !== undefined && citesAnImage(context)) return true;
  }
  return false;
}

function missingAltText(images: readonly UndescribedImage[]): string {
  const names = images.map((image) => image.name).join(', ');
  const count = images.length === 1 ? '1 image has' : `${String(images.length)} images have`;
  return (
    `${count} no alt text: ${names}. Describe each one inside its ![…](…), ` +
    'or mark an upload decorative in the media library.'
  );
}

/** How many of an untitled post's first words its slug is made from. */
const NOTE_SLUG_WORDS = 5;

/** The slug a note takes from its first words, or empty when it has none. */
function noteSlug(body: string): string {
  const words = htmlToText(renderMarkdown(body)).split(' ').slice(0, NOTE_SLUG_WORDS);
  return slugify(words.join(' '));
}

const TARGET_SLUG_WORDS = 4;

const CITED_SLUGS: Partial<
  Record<
    PostType,
    { readonly prefix: string; readonly field: 'repostOf' | 'likeOf' | 'inReplyTo' | 'bookmarkOf' }
  >
> = {
  repost: { prefix: 'reposted', field: 'repostOf' },
  like: { prefix: 'liked', field: 'likeOf' },
  reply: { prefix: 'reply-to', field: 'inReplyTo' },
  bookmark: { prefix: 'bookmarked', field: 'bookmarkOf' },
};

async function typeSlug(
  kind: DocumentKind,
  form: EditorForm,
  photos: readonly Photo[],
  citedContext: DocumentSite['citedContext'],
): Promise<string> {
  if (kind.type !== 'post') return '';
  const type = discoverPostType({
    'repost-of': form.repostOf,
    'like-of': form.likeOf,
    'in-reply-to': form.inReplyTo,
    'bookmark-of': form.bookmarkOf,
    photo: photos.map((photo) => photo.url),
  });
  if (type === 'photo') return 'photo';
  const cited = CITED_SLUGS[type];
  if (cited === undefined) return '';
  const target = form[cited.field];
  const title = slugWords((await citedContext(target))?.name ?? '', NOTE_SLUG_WORDS);
  return `${cited.prefix}-${title || targetWords(target)}`;
}

function targetWords(address: string): string {
  const url = new URL(address);
  const segments = url.pathname.split('/').map(decodedSegment).filter(holdsALetter);
  return slugWords([url.hostname.replace(/^www\./, ''), ...segments].join(' '), TARGET_SLUG_WORDS);
}

function slugWords(text: string, cap: number): string {
  return slugify(text).split('-').slice(0, cap).join('-');
}

function holdsALetter(segment: string): boolean {
  return /\p{L}/u.test(segment);
}

function decodedSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** What the flash says after a save, which depends on what the save did. */
function savedMessage(
  kind: DocumentKind,
  previous: Document | undefined,
  saved: Document,
  now: Date,
): string {
  if (saved.draft) return `Draft saved: ${postLabel(saved)}`;
  // A date in the future is not a refusal to publish, it is an instruction
  // about when, and the flash has to say so or the author will think the
  // Publish button did nothing.
  if (scheduledFor(saved, now) !== undefined) return `Scheduled: ${postLabel(saved)}`;
  if (previous === undefined || previous.draft) return `Published: ${postLabel(saved)}`;
  return `Updated: ${postLabel(saved)}`;
}

/** Where a document's file goes, trash included. */
function documentPath(input: {
  kind: DocumentKind;
  slug: string;
  date: string | undefined;
  trashed: boolean;
}): string {
  const relative = contentFilePath({ type: input.kind.type, slug: input.slug, date: input.date });
  return input.trashed ? `${TRASH_DIRECTORY}/${relative}` : relative;
}

/**
 * The document whose URL has already been promised, or `undefined` when
 * nothing has been promised yet.
 *
 * A published post or page is at a URL readers, search engines and other
 * sites may hold, and a post that was ever announced is at one its followers
 * hold even while it is a draft. A draft nobody was told about, a trashed
 * document and one whose date has not arrived have been shown to nobody, and
 * may move without leaving anything behind.
 */
function promisedDocument(document: Document | undefined, now: Date): Document | undefined {
  if (document === undefined) return undefined;
  const announced = document.activitypub?.published !== undefined;
  return isServed(document, now) || announced ? document : undefined;
}

/**
 * The URLs a document is saved as having lived at (TASK-127).
 *
 * Every entry names the document itself rather than the next hop, so a chain
 * of renames collapses by construction: the URL it is leaving joins the ones
 * it already left, and all of them redirect straight to where it is now. The
 * URL it is arriving at leaves the list, because a document moved back to an
 * old URL lives there again.
 */
function formerPermalinks(
  document: Document | undefined,
  promised: Document | undefined,
  permalink: string,
): string[] | undefined {
  const left =
    promised !== undefined && promised.permalink !== permalink ? [promised.permalink] : [];
  const former = [...new Set([...(document?.redirectFrom ?? []), ...left])].filter(
    (url) => url !== permalink,
  );
  return former.length === 0 ? undefined : former;
}

/**
 * The `activitypub` block to write, which pins the object id when a promised
 * post moves (decision-20).
 *
 * decision-13 makes a post's object id its permalink, and a fediverse server
 * cannot rename an object it holds. So the URL the post is leaving is written
 * as its stored id, and the stored-id path does the rest: a peer at the old
 * URL still gets the `Article`, a browser there is sent on, and every `Update`
 * names the id the followers already have. An id the file already stores
 * stays, since it is already what they hold.
 */
function keptIdentity(
  document: Document | undefined,
  promised: Document | undefined,
  permalink: string,
  baseUrl: string,
): Document['activitypub'] {
  const block = document?.activitypub;
  if (promised === undefined || promised.type !== 'post' || promised.permalink === permalink) {
    return block;
  }
  if (block?.id !== undefined) return block;
  return { ...block, id: absoluteUrl(promised.permalink, baseUrl) };
}

/**
 * The permalink to write.
 *
 * A permalink is explicit in the file and the stored value is what counts
 * (doc-2), so one that was customised is never quietly rewritten. One that is
 * still the URL its old slug and date implied follows them to the new ones,
 * which is what makes renaming a slug in the editor do what it looks like it
 * does.
 */
function resolvePermalink(input: {
  kind: DocumentKind;
  form: EditorForm;
  slug: string;
  /** The calendar day the document is filed under, per {@link filedDay}. */
  date: string | undefined;
  document: Document | undefined;
  /** The site's zone, for reading the day an existing document was filed under. */
  timezone: string;
}): string {
  const fallback = defaultPermalink({
    type: input.kind.type,
    slug: input.slug,
    date: input.date,
  });

  const submitted = normalizePermalink(input.form.permalink);
  if (submitted === undefined) return fallback;

  const document = input.document;
  if (
    document !== undefined &&
    submitted === previousDefaultPermalink(input.kind, document, input.timezone)
  ) {
    return fallback;
  }
  return submitted;
}

/**
 * The permalink a document would have had if it had never been customised:
 * its own slug over the day it is filed under, which is the day in its
 * filename rather than one re-derived from a setting that may have moved.
 */
function previousDefaultPermalink(
  kind: DocumentKind,
  document: Document,
  timezone: string,
): string | undefined {
  try {
    return defaultPermalink({
      type: kind.type,
      slug: document.slug,
      date: filedDay({ date: document.date, document, timezone }),
    });
  } catch {
    return undefined;
  }
}

/**
 * The calendar day a document is filed under, which is what its filename and
 * its `/{yyyy}/{mm}/` permalink are cut from.
 *
 * For a new document it is the day the site's own zone was on at its date, so
 * a post published at half past midnight on 1 October in Berlin is filed under
 * October rather than the September UTC was still on.
 *
 * For a document whose date has not moved it is the day already in its
 * filename. That is the whole of decision-11's promise that changing the
 * timezone setting cannot move an existing URL: the instant is the same, the
 * zone is a lens, and the day this post was filed under was decided once, when
 * it was written, and is on disk where no setting can reach it.
 */
function filedDay(input: {
  date: string | undefined;
  document: Document | undefined;
  timezone: string;
}): string | undefined {
  const { document } = input;
  const date = input.date === undefined ? undefined : toUtcInstant(input.date, input.timezone);
  if (date === undefined) return undefined;

  const was =
    document?.date === undefined ? undefined : toUtcInstant(document.date, input.timezone);
  if (was === date) {
    const existing = /(?:^|\/)(\d{4}-\d{2}-\d{2})-/.exec(document?.path ?? '')?.[1];
    if (existing !== undefined) return existing;
  }

  return calendarDayIn(date, input.timezone) ?? date;
}

/** The site's time zone, which is what every offset-less date in the admin means. */
function siteTimezone(c: Context<GeekityEnv>): string {
  return readSiteSettings(c.var.config.contentDir).timezone;
}

/** A submitted permalink as a URL path, or `undefined` when the field is empty. */
function normalizePermalink(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const last = withLeading.split('/').at(-1) ?? '';
  // `/feed.xml` is a file and keeps its name; everything else is a directory
  // and gets the trailing slash that is canonical here.
  if (last === '' || last.includes('.')) return withLeading;
  return `${withLeading}/`;
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
function resolveExtra(
  kind: DocumentKind,
  document: Document | undefined,
  form: Pick<
    EditorForm,
    | 'exclude'
    | 'comments'
    | 'contact'
    | 'lang'
    | 'pinned'
    | 'previewHidden'
    | 'citedAlt'
    | 'syndicateTo'
    | 'visibility'
    | 'readStatus'
    | 'readOf'
    | (typeof CITATION_FIELDS)[CitationProperty]
  >,
  now: Date,
  media: ResolvedMedia,
  declared: readonly SyndicationTarget[],
): Record<string, unknown> {
  const extra: Record<string, unknown> = { ...(document?.extra ?? {}) };

  if (kind.type === 'post') {
    if (media.recording === undefined) delete extra[ENCLOSURE_FRONT_MATTER_KEY];
    else extra[ENCLOSURE_FRONT_MATTER_KEY] = enclosureFrontMatter(media.recording);
    if (media.photos.length === 0) delete extra[PHOTO_FRONT_MATTER_KEY];
    else extra[PHOTO_FRONT_MATTER_KEY] = photoFrontMatter(media.photos);
    for (const property of CITATION_PROPERTIES) {
      const cited = form[CITATION_FIELDS[property]];
      if (cited === '') delete extra[property];
      else extra[property] = cited;
    }
    // Written or removed, never `true`: a preview shows unless the post says
    // otherwise, so a Micropub post shows it until the author removes it.
    if (form.previewHidden) extra[PREVIEW_FRONT_MATTER_KEY] = false;
    else delete extra[PREVIEW_FRONT_MATTER_KEY];
    if (form.citedAlt === '') delete extra[CITED_ALT_FRONT_MATTER_KEY];
    else extra[CITED_ALT_FRONT_MATTER_KEY] = form.citedAlt;
    const resolved = resolveRead(form.readStatus, form.readOf);
    if ('read' in resolved) {
      const { read } = resolved;
      if (read === undefined) {
        delete extra[READ_OF_FRONT_MATTER_KEY];
        delete extra[READ_STATUS_FRONT_MATTER_KEY];
      } else {
        extra[READ_OF_FRONT_MATTER_KEY] = readWorkFrontMatter(read.of);
        extra[READ_STATUS_FRONT_MATTER_KEY] = read.status;
      }
    }
  }

  // The checkboxes speak for the targets the site declares (TASK-155). An id
  // the file lists that names no declared target has no checkbox, so it is
  // kept as written rather than lost to a save.
  if (kind.type === 'post') {
    const offered = new Set(declared.map((target) => target.id));
    const kept = syndicateToOf(extra).filter((id) => !offered.has(id));
    // A form loaded from the file (a Micropub update) already holds those ids.
    const listed = [...new Set([...form.syndicateTo, ...kept])];
    if (listed.length === 0) delete extra[SYNDICATE_TO_FRONT_MATTER_KEY];
    else extra[SYNDICATE_TO_FRONT_MATTER_KEY] = listed;
  }

  // The moment a post was pinned is what orders the featured collection, so a
  // pin the file already carries keeps its moment through every later save,
  // and unpinning takes the key out rather than writing `false` (TASK-207).
  if (kind.type === 'post') {
    const pinned = document === undefined ? undefined : pinnedAt(document);
    if (!form.pinned) delete extra[PINNED_FRONT_MATTER_KEY];
    else if (pinned === undefined) extra[PINNED_FRONT_MATTER_KEY] = toUtcInstant(now, 'UTC');
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

/** The editor checkbox that selects one syndication target. */
function syndicateToField(target: SyndicationTarget): string {
  return `${SYNDICATE_TO_FRONT_MATTER_KEY}-${target.id}`;
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

/** The signed-in user's login, which is what doc-2's `author` holds. */
function currentUsername(c: Context<GeekityEnv>): string | undefined {
  const userId = c.var.session?.userId;
  if (userId == null) return undefined;
  return findUserById(c.var.config.dataDir, userId)?.username;
}

/**
 * What a save writes into the front matter's `author`.
 *
 * The submitted value is resolved through the same rule the public site reads
 * it by ({@link userForAuthor}), and what is written is that user's login: so
 * a file carrying a display name from before decision-14 is rewritten as a
 * username the first time somebody saves it, which is exactly the "until it is
 * next saved" doc-2 promises.
 *
 * A value naming nobody this site has changes nothing. There is no form this
 * CMS renders that could submit one — the select only ever offers the users
 * and, for a file that names a stranger, that file's own value — so the case
 * is either a hand-made request or a user deleted between the load and the
 * save, and neither is a reason to reattribute somebody's post.
 */
function chosenAuthor(
  dataDir: string,
  submitted: string,
  document: Document | undefined,
  writer: string | undefined,
): string | undefined {
  const named = userForAuthor(listUsers(dataDir), submitted);
  if (named !== undefined) return named.username;
  return document?.author ?? writer;
}

/** One entry of the editor's Author select. */
export interface AuthorChoice {
  /** What the option submits: a username, or the file's own stranger. */
  value: string;
  /** What it says: the display name and the login, or just the login. */
  label: string;
  /** Whether this is the one the document names. */
  chosen: boolean;
}

/**
 * The Author select: every user, whoever the document names, and — for a file
 * naming somebody with no account here — that name too.
 *
 * The stranger's option is what keeps the editor honest. Without it, opening a
 * post written by a colleague whose account has gone and pressing Update would
 * quietly move the post to whoever happened to be first in the list; with it,
 * the form submits back what the file says and changing the attribution stays
 * a thing somebody chose to do.
 *
 * A new document starts on the signed-in user, which is what doc-5 says the
 * editor does and what {@link blankForm} deliberately leaves to a request.
 */
export function authorChoices(c: Context<GeekityEnv>, current: string): AuthorChoice[] {
  const users = listUsers(c.var.config.dataDir);
  const named = userForAuthor(users, current);
  const chosen = named?.username ?? (current === '' ? currentUsername(c) : current);

  const choices = users.map((user) => ({
    value: user.username,
    label: authorLabel(user),
    chosen: user.username === chosen,
  }));

  // A name the file holds that is nobody here: offered last, and marked, so it
  // is plain that the post is attributed to somebody this site cannot reach.
  if (named === undefined && current !== '') {
    choices.push({ value: current, label: `${current} (no account here)`, chosen: true });
  }

  return choices;
}

/** How one user reads in the select: their name, and the login behind it. */
function authorLabel(user: User): string {
  const displayName = user.profile?.displayName;
  return displayName === undefined ? user.username : `${displayName} (${user.username})`;
}

/** The file as it is now, when it is not the file the form was filled in from. */
interface Conflict {
  /** The text of the file on disk. */
  current: string;
  /** Its hash, which is what a resubmission has to carry to go through. */
  hash: string;
}

/**
 * Whether the file has moved on since the form loaded, per doc-1: files win,
 * and an edit made behind the editor's back is never silently overwritten.
 *
 * The file is read and re-parsed rather than trusted to the index, so the
 * check is right even when the watcher is off or has not caught up.
 */
async function conflictWith(
  contentDir: string,
  document: Document,
  submittedHash: string,
): Promise<Conflict | undefined> {
  const file = path.join(contentDir, ...document.path.split('/'));

  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    // The file is gone. There is nothing to lose by writing it again.
    return undefined;
  }

  let hash: string;
  try {
    hash = parseDocument(source, { path: document.path, type: document.type }).hash;
  } catch {
    // A file that will not parse cannot be compared, and overwriting it would
    // throw away whatever is wrong with it before anyone has seen it.
    hash = '';
  }

  if (hash === submittedHash) return undefined;
  return { current: source, hash };
}

/** What {@link renderConflict} shows. */
interface RenderConflictOptions {
  kind: DocumentKind;
  render: AdminRender;
  document: Document;
  form: EditorForm;
  /** The recording and the photos the submitted form resolved to. */
  media: ResolvedMedia;
  conflict: Conflict;
}

/**
 * The refused save, side by side with the file it would have overwritten.
 *
 * Nothing has been written at this point. The form is offered back with the
 * fresh hash, so the way out is to read both versions and decide, rather than
 * to lose the edit.
 */
function renderConflict(c: Context<GeekityEnv>, options: RenderConflictOptions): Response {
  const { kind, document, form, conflict } = options;

  const submitted = serializeDocument({
    title: form.title,
    ...(form.date === '' ? {} : { date: form.date }),
    permalink: form.permalink === '' ? document.permalink : form.permalink,
    tags: kind.tagged ? splitTags(form.tags) : [],
    categories: kind.categorised ? splitTags(form.categories) : [],
    draft: form.draft,
    ...(form.description === '' ? {} : { description: form.description }),
    ...optional('author', document.author),
    ...optional('inReplyTo', replyTo(kind, form, document)),
    ...optional('activitypub', document.activitypub),
    extra: resolveExtra(
      kind,
      document,
      form,
      c.var.store.now(),
      options.media,
      syndicationTargetsReader(c.var.config.contentDir)(),
    ),
    body: form.body,
  });

  c.status(409);
  return options.render(c, ADMIN_TEMPLATES.documentConflict, {
    section: kind.section,
    // Editing something that exists, so the listing is where the menu stands.
    child: 'all',
    kind,
    form,
    // The hash the file has now, so resubmitting this form is a deliberate
    // overwrite of a version its author has been shown.
    freshHash: conflict.hash,
    submitted,
    current: conflict.current,
    editUrl: editorPath(kind, document.slug),
    saveUrl: editorPath(kind, document.slug),
    action: form.draft ? 'save-draft' : 'publish',
  });
}

/** What {@link moveDocument} is asked to do. */
interface MoveDocumentOptions {
  kind: DocumentKind;
  document: Document;
  action: 'trash' | 'restore';
  /** Where to go afterwards, when the form said. */
  returnTo: string;
}

/**
 * Move a document into the trash or back out of it from the editor, and go
 * back where the form came from.
 */
async function moveDocument(
  c: Context<GeekityEnv>,
  options: MoveDocumentOptions,
): Promise<Response> {
  const { kind, document, action } = options;

  const trashed = isTrashedPath(document.path);
  if (action === 'trash' && trashed) return backTo(c, options, `It is already in the trash.`);
  if (action === 'restore' && !trashed) return backTo(c, options, `It is not in the trash.`);

  const moved = await moveDocumentFile(
    { store: c.var.store, contentDir: c.var.config.contentDir, announce: c.var.announce },
    document,
    action,
  );
  if (moved === undefined) {
    return backTo(c, options, `Could not move ${document.path}. Is the file still there?`);
  }

  const message =
    action === 'trash'
      ? `Moved to the trash: ${postLabel(document)}`
      : `Restored: ${postLabel(document)}`;
  flash(c, 'notice', message);

  return c.redirect(
    returnPath(options.returnTo) ??
      (action === 'trash' ? kind.basePath : editorPath(kind, document.slug)),
    303,
  );
}

/** What moving a document's file needs from the site. */
export interface MoveSite {
  readonly store: ContentStore;
  readonly contentDir: string;
  readonly announce: (change: DocumentChange) => Promise<void>;
}

/**
 * Move a document into `content/_trash/` or back out of it, the move behind
 * the editor's trash and restore and Micropub's delete and undelete
 * (TASK-167). The document is the moved one, or `undefined` when its file
 * could not be moved.
 *
 * The trash mirrors the content tree — `posts/2026-03-04-x.md` becomes
 * `_trash/posts/2026-03-04-x.md` — so restoring is the same move backwards and
 * needs to remember nothing. The index is corrected as soon as the file has
 * landed rather than waiting for the watcher, so the public site stops or
 * starts serving the document with this request (doc-1).
 */
export async function moveDocumentFile(
  site: MoveSite,
  document: Document,
  action: 'trash' | 'restore',
): Promise<Document | undefined> {
  const { store, contentDir } = site;
  const target =
    action === 'trash'
      ? `${TRASH_DIRECTORY}/${document.path}`
      : document.path
          .split('/')
          .filter((segment) => segment !== TRASH_DIRECTORY)
          .join('/');

  const from = path.join(contentDir, ...document.path.split('/'));
  const to = path.join(contentDir, ...target.split('/'));

  let source: string;
  try {
    source = await readFile(from, 'utf8');
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  } catch {
    return undefined;
  }

  const moved = parseDocument(source, { path: target, type: document.type });
  store.remove(document.path);
  store.upsert(moved);

  // Trashing takes a post off the public site and restoring puts it back, so
  // both are visibility changes a subscriber has to hear about.
  await site.announce({
    type: 'updated',
    path: target,
    previous: document,
    next: moved,
    origin: 'admin',
  });
  return moved;
}

/** Report a move that did not happen and go back where the form came from. */
function backTo(c: Context<GeekityEnv>, options: MoveDocumentOptions, message: string): Response {
  flash(c, 'error', message);
  return c.redirect(
    returnPath(options.returnTo) ?? editorPath(options.kind, options.document.slug),
    303,
  );
}

/**
 * A submitted return path, when it is one this admin could have rendered.
 *
 * Only paths under `/admin/` are honoured, and only ones that cannot be read
 * as another host, so the value cannot be used to bounce somebody off the site.
 */
export function returnPath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith(`${ADMIN_PREFIX}/`) && trimmed !== ADMIN_PREFIX) return undefined;
  if (trimmed.startsWith('//') || trimmed.includes('\\')) return undefined;
  return trimmed;
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The `in-reply-to` a save writes: the field for a post, where an empty one
 * clears it, and whatever the file had for a page, whose editor has no field.
 */
function replyTo(
  kind: DocumentKind,
  form: EditorForm,
  document: Document | undefined,
): string | undefined {
  if (kind.type !== 'post') return document?.inReplyTo;
  return form.inReplyTo === '' ? undefined : form.inReplyTo;
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

/** What the editor calls each citing field, which a refusal names. */
const CITATION_LABELS: Readonly<Record<CitationProperty, string>> = {
  'repost-of': 'Repost of',
  'like-of': 'Like of',
  'bookmark-of': 'Bookmark of',
};

/** The three citing fields, each filled from its property. */
function citationFields(
  value: (property: CitationProperty) => string,
): Pick<EditorForm, (typeof CITATION_FIELDS)[CitationProperty]> {
  return {
    repostOf: value('repost-of'),
    likeOf: value('like-of'),
    bookmarkOf: value('bookmark-of'),
  };
}

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
  /** The post this one reposts, the mf2 `repost-of` (TASK-169). Posts only. */
  repostOf: string;
  /** The post this one likes, the mf2 `like-of` (TASK-169). Posts only. */
  likeOf: string;
  /** The page this one bookmarks, the mf2 `bookmark-of` (TASK-169). Posts only. */
  bookmarkOf: string;
  /**
   * How far the post's author got with what they read, the mf2 `read-status`
   * (TASK-229), as the file or the form spells it. Posts only.
   */
  readStatus: string;
  /** What was read, the mf2 `read-of` (TASK-229). Posts only. */
  readOf: ReadOfForm;
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

/**
 * The editor for a document that does not exist yet.
 *
 * The date field is filled in with the clock as the site's own zone reads it,
 * not with an instant: what a form offers is what a form takes back, and per
 * decision-11 an offset-less date in this field means the site's zone.
 */
export function blankForm(
  kind: DocumentKind,
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): EditorForm {
  return {
    title: '',
    slug: '',
    permalink: '',
    date: kind.dated ? wallClockIn(now, timezone) : '',
    tags: '',
    categories: '',
    description: '',
    // Empty rather than the signed-in user: `blankForm` is a pure function
    // over a kind and a clock, and who is signed in is a fact about a request.
    // {@link authorChoices} is where the default is applied.
    author: '',
    inReplyTo: '',
    ...citationFields(() => ''),
    readStatus: '',
    readOf: BLANK_READ_OF_FORM,
    lang: '',
    draft: false,
    visibility: 'public',
    exclude: false,
    contact: false,
    pinned: false,
    previewHidden: false,
    citedAlt: '',
    comments: COMMENT_SETTINGS.site,
    enclosure: BLANK_ENCLOSURE_FORM,
    photos: [],
    location: BLANK_LOCATION_FORM,
    syndicateTo: [],
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
    // As the file spells it, so a save writes back what it read.
    ...citationFields((property) =>
      document.type === 'post' ? citationText(document.extra[property]) : '',
    ),
    readStatus:
      document.type === 'post' && typeof document.extra[READ_STATUS_FRONT_MATTER_KEY] === 'string'
        ? document.extra[READ_STATUS_FRONT_MATTER_KEY]
        : '',
    readOf: readOfForm(
      document.type === 'post' ? readWork(document.extra[READ_OF_FRONT_MATTER_KEY]) : undefined,
    ),
    lang:
      typeof document.extra[LANG_FRONT_MATTER_KEY] === 'string'
        ? document.extra[LANG_FRONT_MATTER_KEY]
        : '',
    draft: document.draft,
    visibility: visibilityOf(document),
    exclude: document.extra[EXCLUDE_KEY] === true,
    contact: document.extra[CONTACT_FRONT_MATTER_KEY] === true,
    pinned: pinnedAt(document) !== undefined,
    previewHidden: document.type === 'post' && !previewShown(document.extra),
    citedAlt:
      document.type === 'post' && typeof document.extra[CITED_ALT_FRONT_MATTER_KEY] === 'string'
        ? document.extra[CITED_ALT_FRONT_MATTER_KEY]
        : '',
    comments: commentSettingOf(document),
    enclosure: document.type === 'post' ? enclosureForm(document) : BLANK_ENCLOSURE_FORM,
    photos: document.type === 'post' ? photoRows(document) : [],
    location: document.type === 'post' ? locationForm(location) : BLANK_LOCATION_FORM,
    syndicateTo: document.type === 'post' ? syndicateToOf(document.extra) : [],
    body: document.body,
    hash: document.hash,
  };
}

/** One of the editor's submit buttons. */
interface EditorAction {
  value: string;
  label: string;
}

/** What {@link renderEditor} puts on the screen. */
interface RenderEditorOptions {
  kind: DocumentKind;
  render: AdminRender;
  /** The document being edited, or `undefined` when it is being written. */
  document: Document | undefined;
  form: EditorForm;
  refusal?: Refusal | undefined;
  /** The status to answer with. Defaults to 200. */
  status?: 200 | 400 | undefined;
}

/**
 * The editor screen.
 *
 * The buttons follow doc-5 and the document's state: something unwritten or
 * still a draft offers Save draft and Publish, something published offers
 * Update, and anything that exists can be thrown away or, if it already has
 * been, restored.
 */
async function renderEditor(
  c: Context<GeekityEnv>,
  options: RenderEditorOptions,
): Promise<Response> {
  const { kind, document, form } = options;
  const trashed = document !== undefined && isTrashedPath(document.path);
  const now = c.var.store.now();
  const timezone = siteTimezone(c);
  // Printed in the site's own time zone rather than in UTC: an author who
  // scheduled a post for nine in the morning meant their own morning.
  const scheduledAt =
    document === undefined || trashed || document.draft ? undefined : scheduledFor(document, now);

  const actions: EditorAction[] = [];
  if (document === undefined || document.draft) {
    actions.push({ value: 'save-draft', label: 'Save draft' });
    actions.push({ value: 'publish', label: 'Publish' });
  } else {
    actions.push({ value: 'update', label: 'Update' });
  }
  if (trashed) actions.push({ value: 'restore', label: 'Restore' });
  else if (document !== undefined) actions.push({ value: 'trash', label: 'Move to trash' });

  if (options.status !== undefined) c.status(options.status);
  // The baseline leaves a header the handler set alone, so only this response
  // is allowed the browser's position.
  const permissions = c.var.config.securityHeaders['permissions-policy'];
  if (kind.type === 'post' && permissions !== undefined) {
    c.header('Permissions-Policy', allowGeolocation(permissions));
  }

  return options.render(c, ADMIN_TEMPLATES.documentEditor, {
    section: kind.section,
    // The blank form is Add new; editing one that exists is still All posts,
    // the way WordPress leaves the listing marked while you are in the editor.
    child: document === undefined ? 'new' : 'all',
    kind,
    form,
    actions,
    trashed,
    commentSettings: COMMENT_SETTINGS,
    ...(kind.type === 'post'
      ? {
          enclosureFields: ENCLOSURE_FIELDS,
          enclosureChoices: await enclosureChoices(c.var.config.contentDir, form.enclosure.url),
          transcriptTypes: TRANSCRIPT_TYPES,
          alternateRows: [...form.enclosure.alternates, BLANK_ALTERNATE_ROW],
          photoFields: PHOTO_FIELDS,
          photoRows: photoRowViews(form.photos, readAltTexts(c.var.config.contentDir)),
          photoChoices: await photoChoices(c.var.config.contentDir),
          locationFields: LOCATION_FIELDS,
          ...citedPreviews(c, form),
          readFields: READ_FIELDS,
          readStatuses: READ_STATUSES.map((value) => ({ value, label: READ_STATUS_LABELS[value] })),
          ...(form.readStatus === '' || isReadStatus(form.readStatus)
            ? {}
            : { unrecognizedReadStatus: form.readStatus }),
          // TASK-155: one checkbox per target the site declares.
          syndicationTargets: syndicationTargetsReader(c.var.config.contentDir)().map((target) => ({
            ...target,
            field: syndicateToField(target),
            checked: form.syndicateTo.includes(target.id),
          })),
        }
      : {}),
    // Who this can be attributed to, and who it is attributed to now.
    authors: authorChoices(c, form.author),
    // What an empty Language field means.
    siteLanguage: readSiteSettings(c.var.config.contentDir).language,
    heading:
      document === undefined
        ? `Add ${kind.singular}`
        : `Edit ${kind.singular}: ${postLabel(document)}`,
    saveUrl: document === undefined ? newEditorPath(kind) : editorPath(kind, document.slug),
    listUrl: kind.basePath,
    previewUrl: PREVIEW_PATH,
    uploadUrl: UPLOADS_PATH,
    viewUrl: document !== undefined && isServed(document, now) ? document.permalink : undefined,
    // Named beside the date field, because a wall clock with no zone on it is
    // exactly the ambiguity decision-11 exists to remove.
    ...(kind.dated ? { dateZone: zoneLabel(form.date === '' ? now : form.date, timezone) } : {}),
    ...(scheduledAt === undefined ? {} : { scheduledFor: formatInTimezone(scheduledAt, timezone) }),
    ...(options.refusal === undefined
      ? {}
      : { error: options.refusal.message, errorField: options.refusal.field }),
    open: openGroups(form, options.refusal?.field),
  });
}

/**
 * The card the editor shows under each cited URL whose stored context has a
 * picture (TASK-252), by the citing property, with the title its remove
 * control is named after. A URL the file holds nothing for has no card yet.
 * The card of an image shown in full takes its alt text (TASK-255).
 */
function citedPreviews(
  c: Context<GeekityEnv>,
  form: EditorForm,
): {
  citedPreviews: Record<string, { name: string; picture: CitedPicture; described: boolean }>;
  describesCitedImage: boolean;
} {
  const cited: [string, string][] = [
    ['in-reply-to', form.inReplyTo],
    ...CITATION_PROPERTIES.map((property): [string, string] => [
      property,
      form[CITATION_FIELDS[property]],
    ]),
  ];
  const cards: Record<string, { name: string; picture: CitedPicture; described: boolean }> = {};
  for (const [property, url] of cited) {
    if (url === '') continue;
    const context = c.var.replyContexts.read(url);
    if (context?.picture === undefined) continue;
    const image = citesAnImage(context);
    cards[property] = {
      name:
        context.name ??
        context.author?.name ??
        `${image ? 'An image from' : 'A page on'} ${citedHost(url)}`,
      picture: context.picture,
      described: image && shownInFull(property, context.picture),
    };
  }
  return {
    citedPreviews: cards,
    describesCitedImage: Object.values(cards).some((card) => card.described),
  };
}

/**
 * The document of this kind with this slug.
 *
 * The index's slug lookup is across both kinds and is not unique, so a direct
 * hit is only taken when it is of the right kind; otherwise the listing is
 * searched, trash included, because the editor is where a trashed document is
 * restored from.
 */
export function findBySlug(
  store: ContentStore,
  kind: DocumentKind,
  slug: string,
): Document | undefined {
  const direct = store.getBySlug(slug);
  if (direct?.type === kind.type) return direct;

  for (const trashed of [false, true]) {
    const found = store
      .listAll({ type: kind.type, trashed })
      .find((document) => document.slug === slug);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** What the listing template shows for one document. */
export interface DocumentRow {
  /** What the row's link says: the title, or a note's first words. */
  title: string;
  slug: string;
  author: string | undefined;
  tags: string;
  categories: string;
  date: string | undefined;
  /** The most recent change to the document, for a kind with no publish date. */
  updated: string | undefined;
  draft: boolean;
  trashed: boolean;
  /** Whether its date has not arrived, so the public site is holding it back. */
  scheduled: boolean;
  /** Whether its `visibility` is one the site does not recognize, so it is not served. */
  hidden: boolean;
  /** Where the editor for it lives. */
  editUrl: string;
  /** Its public URL, or `undefined` when the public site would not serve it. */
  viewUrl: string | undefined;
  /**
   * What this page is to the site besides a page — Front Page, Posts Page —
   * or `undefined` for every other row.
   */
  role: string | undefined;
}

/**
 * WordPress's own two labels for the pages the Reading setting names, beside
 * the title on the pages screen, so it is plain from the list which page is
 * the front page and which carries the posts.
 */
export const PAGE_ROLE_LABELS = { homepage: 'Front Page', postsPage: 'Posts Page' } as const;

/** What one row's page is to the site, if anything. */
function pageRole(
  kind: DocumentKind,
  document: Document,
  c: Context<GeekityEnv>,
): string | undefined {
  if (kind.type !== 'page') return undefined;

  const settings = readSiteSettings(c.var.config.contentDir);
  if (settings.homepage === '') return undefined;
  if (document.slug === settings.homepage) return PAGE_ROLE_LABELS.homepage;
  if (document.slug === settings.postsPage) return PAGE_ROLE_LABELS.postsPage;
  return undefined;
}

function listRow(
  kind: DocumentKind,
  document: Document,
  now: Date,
  role: string | undefined,
): DocumentRow {
  const isPublic = isServed(document, now);
  return {
    title: postLabel(document),
    slug: document.slug,
    author: document.author,
    tags: document.tags.join(', '),
    categories: document.categories.join(', '),
    date: document.date,
    // Both come out of the index, so the listing costs no reads of its own.
    // A page that has never been saved through the admin has no `updated`, and
    // its date, when it has one, is the closest thing to one.
    updated: document.updated ?? document.date,
    draft: document.draft,
    trashed: isTrashedPath(document.path),
    scheduled: scheduledFor(document, now) !== undefined,
    hidden: typeof visibilityOf(document) !== 'string',
    editUrl: editorPath(kind, document.slug),
    viewUrl: isPublic ? document.permalink : undefined,
    role,
  };
}

const FILTER_LABELS: Record<DocumentFilter, string> = {
  all: 'All',
  published: 'Published',
  scheduled: 'Scheduled',
  draft: 'Drafts',
  trash: 'Trash',
};

/** The URL of one view of a listing. Page one is the listing's own URL. */
export function listingUrl(kind: DocumentKind, filter: DocumentFilter, page = 1): string {
  const query = new URLSearchParams();
  if (filter !== 'all') query.set('status', filter);
  if (page > 1) query.set('page', String(page));
  const search = query.toString();
  return search === '' ? kind.basePath : `${kind.basePath}?${search}`;
}
