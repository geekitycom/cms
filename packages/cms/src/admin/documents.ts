import type { Context, Hono } from 'hono';

import { CITATION_PROPERTIES, citedHost, citesAnImage, shownInFull } from '../content/citation.ts';
import type { CitedPageReader } from '../content/citation.ts';
import { commentPolicyOf } from '../comments/policy.ts';
import type { CommentPolicy } from '../comments/policy.ts';
import type { Document, DocumentType } from '../content/document.ts';
import {
  AUTHOR_UNTIL_REQUEST,
  blankForm,
  CITATION_FIELDS,
  COMMENT_SETTINGS,
  extraFromForm,
  formFor,
  formInReplyTo,
  postFieldsForm,
  splitTags,
} from '../content/document-form.ts';
import type { EditorForm, ResolvedMedia } from '../content/document-form.ts';
import { PAGE_KIND, POST_KIND } from '../content/document-kind.ts';
import type { DocumentKind } from '../content/document-kind.ts';
import { TRANSCRIPT_TYPES } from '../content/enclosure.ts';
import { ENCLOSURE_FIELDS } from '../content/enclosure-form.ts';
import { EVENT_FIELDS } from '../content/event-form.ts';
import {
  isReviewKind,
  REVIEW_KIND_FIELDS,
  REVIEW_KIND_WORDS,
  REVIEW_KINDS,
} from '../content/review.ts';
import { REVIEW_FIELDS } from '../content/review-form.ts';
import type { Refusal } from '../content/form-error.ts';
import { BLANK_LOCATION_FORM } from '../content/location-form.ts';
import { postLocations } from '../content/locations.ts';
import { PHOTO_FIELDS } from '../content/photo-form.ts';
import { syndicateToField } from '../content/post-fields.ts';
import { postLabel } from '../content/post-type.ts';
import { RSVP_LABELS, RSVP_VALUES, rsvpValue } from '../content/rsvp.ts';
import { scheduledFor } from '../content/schedule.ts';
import { isTrashedPath } from '../content/store.ts';
import type { CatalogReader, DocumentLookup, ListAllOptions } from '../content/store.ts';
import type { Respelling } from '../content/tags.ts';
import { zoneLabel } from '../content/time.ts';
import { moveDocumentFile } from '../content/trash.ts';
import { isVisibility, visibilityOf } from '../content/visibility.ts';
import type { StoredVisibility } from '../content/visibility.ts';
import { missingAltText, writeDocument } from '../content/write.ts';
import { currentUsername, documentSite } from '../web/document-site.ts';
import type { Conflict } from '../content/write.ts';
import { normalizeBody, serializeDocument } from '../content/writer.ts';
import type { GeekityEnv } from '../web/env.ts';
import { listUsers } from '../site/users.ts';
import type { User } from '../site/users.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { userForAuthor } from '../content/authors.ts';
import { isServed } from '../content/served.ts';
import { SEARCH_KINDS } from '../item-lookup/lookup.ts';
import type { CitedPicture } from '../webmention/cited-picture.ts';
import { syndicationTargetsReader } from '../webmention/syndication.ts';
import { editorActionViews } from './editor-actions.ts';
import {
  BLANK_ALTERNATE_ROW,
  enclosureChoices,
  LOCATION_FIELDS,
  libraryThumbnail,
  photoPicker,
  readLocationForm,
} from './editor-fields.ts';
import {
  discoveredKind,
  EDITOR_KINDS,
  isPostKind,
  PAGE_CHOICE,
  POST_KINDS,
  REVIEW_EDITOR_WORDS,
} from './editor-kinds.ts';
import type { PostKind } from './editor-kinds.ts';
import { editorSections, openGroups, sidebarLocation } from './editor-layout.ts';
import { flash } from './flash.ts';
import {
  ITEM_LOOKUP_BUTTON,
  ITEM_LOOKUP_PATH,
  ITEM_SEARCH_PATH,
  lookUpReviewItem,
} from './item-lookup.ts';
import { formatInTimezone } from './formatting.ts';
import { allowGeolocation } from './headers.ts';
import { PREVIEW_PATH } from './preview.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { UPLOADS_PATH } from './uploads.ts';

/**
 * Everything that differs between the posts screens and the pages screens.
 *
 * Posts and pages are the same screens over the same store with two knobs
 * turned: a post carries a date and taxonomy, a page carries neither. Keeping the
 * difference in data rather than in two copies of the code is what lets
 * `/admin/pages` be one call to {@link mountDocumentScreens}.
 */
export interface DocumentScreens extends DocumentKind {
  /** The navigation section they mark as current. */
  section: string;
  /** Root of the screens, e.g. `/admin/posts`. */
  basePath: string;
  /** The heading over the listing, e.g. `Posts`. */
  plural: string;
}

export const POST_SCREENS: DocumentScreens = {
  ...POST_KIND,
  section: 'posts',
  basePath: `${ADMIN_PREFIX}/posts`,
  plural: 'Posts',
};

export const PAGE_SCREENS: DocumentScreens = {
  ...PAGE_KIND,
  section: 'pages',
  basePath: `${ADMIN_PREFIX}/pages`,
  plural: 'Pages',
};

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

/** The URL of the editor for one document. */
export function editorPath(kind: DocumentScreens, slug: string): string {
  return `${kind.basePath}/${encodeURIComponent(slug)}`;
}

/**
 * The URL of the editor for this document.
 *
 * A trashed document also names its file, because a live document may have
 * taken its slug along with its URL (TASK-195).
 */
export function documentEditorPath(
  kind: DocumentScreens,
  document: Pick<Document, 'slug' | 'path'>,
): string {
  const address = editorPath(kind, document.slug);
  if (!isTrashedPath(document.path)) return address;
  return `${address}?${new URLSearchParams({ path: document.path }).toString()}`;
}

/** The URL of the editor for a document that does not exist yet. */
export function newEditorPath(kind: DocumentScreens): string {
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

/** {@link CatalogReader.listAll} options for one kind and one filter. */
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
  kind: DocumentScreens;
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/**
 * Register the listing and the editor for one kind of document.
 *
 * Both `/admin/posts` and `/admin/pages` are this function with a different
 * {@link DocumentScreens}: the screens, the templates and the write path are
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
        listRow(kind, document, c.var.store.now(), pageRole(kind, document, c), (url) =>
          c.var.replyContexts.read(url, c.var.siteAtRequestStart),
        ),
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
  app.get(newEditorPath(kind), (c) => {
    const postKind = c.req.query('kind');
    if (kind.type === 'post' && !isPostKind(postKind)) return renderChooser(c, kind, render);
    return renderEditor(c, {
      kind,
      render,
      document: undefined,
      form: blankForm(kind, siteTimezone(c), c.var.store.now()),
      postKind: isPostKind(postKind) ? postKind : undefined,
    });
  });

  app.post(newEditorPath(kind), async (c) => {
    const body = await c.req.parseBody();
    return (
      switchKind(c, { kind, render, document: undefined, body }) ??
      lookUpItem(c, { kind, render, document: undefined, body }) ??
      saveFromForm(c, { kind, render, document: undefined, body })
    );
  });

  app.get(`${kind.basePath}/:slug`, (c) => {
    const document = findEdited(c.var.store, kind, c.req.param('slug'), c.req.query('path'));
    if (document === undefined) return c.notFound();
    const location = postLocations(c.var.config.dataDir).read(document.permalink);
    return renderEditor(c, {
      kind,
      render,
      document,
      form: formFor(kind, document, siteTimezone(c), location),
    });
  });

  app.post(`${kind.basePath}/:slug`, async (c) => {
    const document = findEdited(c.var.store, kind, c.req.param('slug'), c.req.query('path'));
    if (document === undefined) return c.notFound();

    const body = await c.req.parseBody();
    const action = stringOrEmpty(body['action']);

    if (action === 'trash' || action === 'restore') {
      return moveDocument(c, { kind, document, action, returnTo: stringOrEmpty(body['return']) });
    }
    return (
      switchKind(c, { kind, render, document, body }) ??
      lookUpItem(c, { kind, render, document, body }) ??
      saveFromForm(c, { kind, render, document, body })
    );
  });
}

/**
 * The editor form as the browser submitted it, read the same way for a save
 * and for an editor action.
 */
export function submittedForm(
  kind: DocumentKind,
  body: Record<string, unknown>,
  contentDir: string,
): EditorForm {
  const declared = syndicationTargetsReader(contentDir)();
  const form: EditorForm = {
    title: stringOrEmpty(body['title']).trim(),
    slug: stringOrEmpty(body['slug']).trim(),
    permalink: stringOrEmpty(body['permalink']).trim(),
    date: stringOrEmpty(body['date']).trim(),
    tags: stringOrEmpty(body['tags']).trim(),
    categories: stringOrEmpty(body['categories']).trim(),
    description: stringOrEmpty(body['description']).trim(),
    author: stringOrEmpty(body['author']).trim(),
    inReplyTo: stringOrEmpty(body['in-reply-to']).trim(),
    ...postFieldsForm(kind, (field) => field.submitted(body, declared)),
    lang: stringOrEmpty(body['lang']).trim(),
    draft: body['draft'] !== undefined,
    visibility: formVisibility(stringOrEmpty(body['visibility'])),
    exclude: body['exclude'] !== undefined,
    contact: body['contact'] !== undefined,
    comments: commentSetting(stringOrEmpty(body['comments'])),
    location: kind.located ? readLocationForm(body) : BLANK_LOCATION_FORM,
    body: normalizeBody(stringOrEmpty(body['body'])),
    hash: stringOrEmpty(body['hash']),
  };
  return kind.replies ? withLink(form, body) : form;
}

/** The field each of the Link form's choices fills. */
const LINK_FIELDS = { 'in-reply-to': 'inReplyTo', ...CITATION_FIELDS } as const;

/**
 * The Link form's one choice and one address, put in the property the choice
 * names. A post citing more than one page has a box of its own for each of
 * the others, so only the chosen property is set here.
 */
function withLink(form: EditorForm, body: Record<string, unknown>): EditorForm {
  const verb = stringOrEmpty(body['link-verb']);
  // A box of the property's own, as a Micropub-shaped post sends, wins.
  if (!Object.hasOwn(LINK_FIELDS, verb) || Object.hasOwn(body, verb)) return form;
  return {
    ...form,
    [LINK_FIELDS[verb as keyof typeof LINK_FIELDS]]: stringOrEmpty(body['link-url']).trim(),
  };
}

/**
 * Change type, pressed with or without a script: the form as submitted, on
 * the kind asked for, with nothing saved. `undefined` when the press was
 * something else.
 */
function switchKind(
  c: Context<GeekityEnv>,
  options: SaveFromFormOptions,
): Promise<Response> | undefined {
  const { kind, render, document, body } = options;
  const postKind = body['switch-kind'];
  if (kind.type !== 'post' || !isPostKind(postKind)) return undefined;
  return renderEditor(c, {
    kind,
    render,
    document,
    form: submittedForm(kind, body, c.var.config.contentDir),
    postKind,
  });
}

/**
 * Look up, pressed with no script: the review form as submitted with its
 * empty item boxes filled, and what the lookup found beside the button, with
 * nothing saved. `undefined` when the press was something else.
 */
function lookUpItem(
  c: Context<GeekityEnv>,
  options: SaveFromFormOptions,
): Promise<Response> | undefined {
  const { kind, render, document, body } = options;
  if (kind.type !== 'post' || body[ITEM_LOOKUP_BUTTON] === undefined) return undefined;
  return (async () => {
    const form = submittedForm(kind, body, c.var.config.contentDir);
    const outcome = await lookUpReviewItem(c, form.review);
    return renderEditor(c, {
      kind,
      render,
      document,
      form: { ...form, review: outcome.review },
      postKind: 'review',
      itemLookup: { message: outcome.message, failed: outcome.failed },
    });
  })();
}

/** "+ New": a card for each kind of post, and one for a page. */
function renderChooser(
  c: Context<GeekityEnv>,
  kind: DocumentScreens,
  render: AdminRender,
): Response {
  return render(c, ADMIN_TEMPLATES.documentChooser, {
    section: kind.section,
    child: 'new',
    kinds: [
      ...POST_KINDS.map((key) => ({
        ...EDITOR_KINDS[key],
        url: `${newEditorPath(kind)}?kind=${key}`,
        page: false,
      })),
      { ...PAGE_CHOICE, url: newEditorPath(PAGE_SCREENS), page: true },
    ],
  });
}

/** What a submitted editor form asks for. */
interface SaveFromFormOptions {
  kind: DocumentScreens;
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

  const form = submittedForm(kind, body, contentDir);

  const action = stringOrEmpty(body['action']);
  // The buttons doc-5 names are shortcuts past the checkbox: Save draft and
  // Publish say what they do, and Update leaves the decision to the checkbox.
  const draft = action === 'save-draft' ? true : action === 'publish' ? false : form.draft;

  function refuse(refusal: Refusal): Promise<Response> {
    return renderEditor(c, {
      kind,
      render,
      document,
      form: { ...form, draft },
      postKind: isPostKind(body['kind']) ? body['kind'] : undefined,
      refusal,
      status: 400,
    });
  }

  const written = await writeDocument(documentSite(c), { kind, document, form, draft });
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
  const { saved, undescribed, respelled } = written;

  flash(
    c,
    'notice',
    savedMessage(document, saved, store.now(), (url) =>
      c.var.replyContexts.read(url, c.var.siteAtRequestStart),
    ),
  );
  if (respelled.length > 0) flash(c, 'notice', respelledMessage(respelled));
  if (undescribed.length > 0) flash(c, 'warning', missingAltText(undescribed));
  return c.redirect(documentEditorPath(kind, saved), 303);
}

function respelledMessage(respelled: readonly Respelling[]): string {
  const pairs = respelled.map(({ given, site }) => `“${site}” for “${given}”`);
  const noun = respelled.length === 1 ? 'a tag' : `${String(respelled.length)} tags`;
  return `Used this site’s spelling of ${noun}: ${pairs.join(', ')}.`;
}

/** What the flash says after a save, which depends on what the save did. */
function savedMessage(
  previous: Document | undefined,
  saved: Document,
  now: Date,
  cited: CitedPageReader,
): string {
  const label = postLabel(saved, cited);
  if (saved.draft) return `Draft saved: ${label}`;
  // A date in the future is not a refusal to publish, it is an instruction
  // about when, and the flash has to say so or the author will think the
  // Publish button did nothing.
  if (scheduledFor(saved, now) !== undefined) return `Scheduled: ${label}`;
  if (previous === undefined || previous.draft) return `Published: ${label}`;
  return `Updated: ${label}`;
}

/** The site's time zone, which is what every offset-less date in the admin means. */
function siteTimezone(c: Context<GeekityEnv>): string {
  return c.var.siteAtRequestStart.timezone;
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
  const chosen =
    named?.username ?? (current === AUTHOR_UNTIL_REQUEST ? currentUsername(c) : current);

  const choices = users.map((user) => ({
    value: user.username,
    label: authorLabel(user),
    chosen: user.username === chosen,
  }));

  // A name the file holds that is nobody here: offered last, and marked, so it
  // is plain that the post is attributed to somebody this site cannot reach.
  if (named === undefined && current !== AUTHOR_UNTIL_REQUEST) {
    choices.push({ value: current, label: `${current} (no account here)`, chosen: true });
  }

  return choices;
}

/** How one user reads in the select: their name, and the login behind it. */
function authorLabel(user: User): string {
  const displayName = user.profile?.displayName;
  return displayName === undefined ? user.username : `${displayName} (${user.username})`;
}

/** What {@link renderConflict} shows. */
interface RenderConflictOptions {
  kind: DocumentScreens;
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
  const inReplyTo = formInReplyTo(kind, form, document);

  const submitted = serializeDocument({
    title: form.title,
    ...(form.date === '' ? {} : { date: form.date }),
    permalink: form.permalink === '' ? document.permalink : form.permalink,
    tags: kind.tagged ? splitTags(form.tags) : [],
    categories: kind.categorised ? splitTags(form.categories) : [],
    draft: form.draft,
    ...(form.description === '' ? {} : { description: form.description }),
    ...(document.author === undefined ? {} : { author: document.author }),
    ...(inReplyTo === undefined ? {} : { inReplyTo }),
    ...(document.activitypub === undefined ? {} : { activitypub: document.activitypub }),
    extra: extraFromForm(
      kind,
      document,
      form,
      c.var.store.now(),
      options.media,
      syndicationTargetsReader(c.var.config.contentDir)(),
      siteTimezone(c),
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
    editUrl: documentEditorPath(kind, document),
    saveUrl: documentEditorPath(kind, document),
    action: form.draft ? 'save-draft' : 'publish',
  });
}

/** What {@link moveDocument} is asked to do. */
interface MoveDocumentOptions {
  kind: DocumentScreens;
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
  if (moved.outcome === 'refused') return backTo(c, options, moved.reason);

  const label = postLabel(document, (url) =>
    c.var.replyContexts.read(url, c.var.siteAtRequestStart),
  );
  const message = action === 'trash' ? `Moved to the trash: ${label}` : `Restored: ${label}`;
  flash(c, 'notice', message);

  return c.redirect(
    returnPath(options.returnTo) ??
      (action === 'trash' ? kind.basePath : documentEditorPath(kind, moved.document)),
    303,
  );
}

/** Report a move that did not happen and go back where the form came from. */
function backTo(c: Context<GeekityEnv>, options: MoveDocumentOptions, message: string): Response {
  flash(c, 'error', message);
  return c.redirect(
    returnPath(options.returnTo) ?? documentEditorPath(options.kind, options.document),
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

/** One of the editor's submit buttons. */
interface EditorAction {
  value: string;
  label: string;
}

function siteDefaultLabel(type: DocumentType, policy: CommentPolicy): string {
  const these = type === 'post' ? 'posts' : 'pages';
  if (!policy.enabled) return 'comments are off on this site';
  if (!policy.openByDefault[type]) return `closed for ${these}`;
  const days = policy.closeAfterDays;
  if (days <= 0) return `open for ${these}`;
  return `open for ${these}, closing ${String(days)} day${days === 1 ? '' : 's'} after the date`;
}

/** What {@link renderEditor} puts on the screen. */
interface RenderEditorOptions {
  kind: DocumentScreens;
  render: AdminRender;
  /** The document being edited, or `undefined` when it is being written. */
  document: Document | undefined;
  form: EditorForm;
  /** The kind to lay a post's form out as; unset for the one its properties give it. */
  postKind?: PostKind | undefined;
  refusal?: Refusal | undefined;
  /** What Look up found, to say beside its button. */
  itemLookup?: { message: string; failed: boolean } | undefined;
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
  const postKind = options.postKind ?? discoveredKind(form);
  const editorKind = kind.type === 'post' ? EDITOR_KINDS[postKind] : undefined;
  const sections = editorSections(postKind, form);
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
  const permissions = c.var.config.securityHeaders['permissions-policy'];
  if (kind.located && permissions !== undefined) {
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
    commentsSiteDefault: siteDefaultLabel(kind.type, commentPolicyOf(c.var.renderer.site())),
    ...(kind.type === 'post'
      ? {
          enclosureFields: ENCLOSURE_FIELDS,
          enclosureChoices: await enclosureChoices(c.var.config.contentDir, form.enclosure.url),
          transcriptTypes: TRANSCRIPT_TYPES,
          alternateRows: [...form.enclosure.alternates, BLANK_ALTERNATE_ROW],
          postKind,
          editorKind,
          postKinds: POST_KINDS.map((key) => ({ key, ...EDITOR_KINDS[key] })),
          sections,
          sidebarLocation: sidebarLocation(postKind, form),
          link: linkView(form, sections.shown.rsvp),
          photoFields: PHOTO_FIELDS,
          photos: await photoPicker(c.var.config, form.photos),
          reviewPhotoThumbnail: libraryThumbnail(c.var.config, form.review.photo),
          locationFields: LOCATION_FIELDS,
          ...citedPreviews(c, form),
          rsvpChoices: RSVP_VALUES.map((value) => ({ value, label: RSVP_LABELS[value] })),
          ...(form.rsvp === '' || rsvpValue(form.rsvp) !== undefined
            ? {}
            : { unrecognizedRsvp: form.rsvp }),
          eventFields: EVENT_FIELDS,
          reviewFields: REVIEW_FIELDS,
          itemLookupButton: ITEM_LOOKUP_BUTTON,
          itemLookupUrl: ITEM_LOOKUP_PATH,
          itemLookup: options.itemLookup,
          itemSearchUrl: ITEM_SEARCH_PATH,
          itemSearchKinds: SEARCH_KINDS,
          reviewKinds: REVIEW_KINDS.map((value) => ({
            value,
            ...REVIEW_KIND_WORDS[value],
            ...REVIEW_EDITOR_WORDS[value],
          })),
          // Which item kinds have each field, which decides when it shows.
          reviewKindsWith: Object.fromEntries(
            ['by', 'year', 'uid', 'url', 'photo', 'date', 'season', 'episode', 'category'].map(
              (field) => [
                field,
                REVIEW_KINDS.filter((value) =>
                  (REVIEW_KIND_FIELDS[value] as readonly string[]).includes(field),
                ),
              ],
            ),
          ),
          // A new review starts on a book; a stored one with no kind is an other.
          reviewKindChosen:
            form.review.kind === ''
              ? sections.filled.review
                ? 'other'
                : 'book'
              : form.review.kind,
          ...(form.review.kind === '' || isReviewKind(form.review.kind)
            ? {}
            : { unrecognizedReviewKind: form.review.kind }),
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
    editorActions: editorActionViews(c, kind, form),
    // What an empty Language field means.
    siteLanguage: c.var.siteAtRequestStart.language,
    heading:
      document === undefined
        ? `New ${editorKind?.noun ?? kind.singular}`
        : `Edit ${editorKind?.noun ?? kind.singular}: ${postLabel(document, (url) => c.var.replyContexts.read(url, c.var.siteAtRequestStart))}`,
    chooserUrl: newEditorPath(kind),
    saveUrl: document === undefined ? newEditorPath(kind) : documentEditorPath(kind, document),
    listUrl: kind.basePath,
    previewUrl: PREVIEW_PATH,
    uploadUrl: UPLOADS_PATH,
    viewUrl: document !== undefined && isServed(document, now) ? document.permalink : undefined,
    // Named beside the date field, because a wall clock with no zone on it is
    // exactly the ambiguity decision-11 exists to remove.
    ...(kind.dated ? { dateZone: zoneLabel(form.date, timezone, now) } : {}),
    ...(scheduledAt === undefined ? {} : { scheduledFor: formatInTimezone(scheduledAt, timezone) }),
    ...(options.refusal === undefined
      ? {}
      : { error: options.refusal.message, errorField: options.refusal.field }),
    open: openGroups(form, options.refusal?.field),
  });
}

/** One of the Link form's choices. */
const LINK_VERBS = [
  { property: 'in-reply-to', label: 'Replies to', also: 'Also replies to' },
  { property: 'like-of', label: 'Likes', also: 'Also likes' },
  { property: 'repost-of', label: 'Reposts', also: 'Also reposts' },
  { property: 'bookmark-of', label: 'Bookmarks', also: 'Also bookmarks' },
] as const;

/** Post Type Discovery's order, which decides the choice a post with several opens on. */
const LINK_ORDER = ['repost-of', 'like-of', 'in-reply-to', 'bookmark-of'] as const;

/**
 * The Link form: the choices, the one it opens on with its address, and a box
 * of its own for every other page the post cites. An RSVP's event address is
 * its own form's, so it is no choice here while the RSVP form shows.
 */
function linkView(form: EditorForm, rsvpShown: boolean) {
  const value = (property: (typeof LINK_ORDER)[number]): string => form[LINK_FIELDS[property]];
  const offered = LINK_VERBS.filter((verb) => !rsvpShown || verb.property !== 'in-reply-to');
  const chosen =
    LINK_ORDER.find(
      (property) => value(property) !== '' && offered.some((verb) => verb.property === property),
    ) ?? offered[0]?.property;
  return {
    verbs: offered,
    chosen,
    url: chosen === undefined ? '' : value(chosen),
    others: offered
      .filter((verb) => verb.property !== chosen && value(verb.property) !== '')
      .map((verb) => ({ ...verb, url: value(verb.property) })),
  };
}

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
    const context = c.var.replyContexts.read(url, c.var.siteAtRequestStart);
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

function findEdited(
  store: DocumentLookup & CatalogReader,
  kind: DocumentKind,
  slug: string,
  file: string | undefined,
): Document | undefined {
  if (file === undefined) return findBySlug(store, kind, slug);
  const document = store.getByPath(file);
  return document?.type === kind.type && document.slug === slug ? document : undefined;
}

/**
 * The document of this kind with this slug, a live one before a trashed one.
 *
 * The index's slug lookup is across both kinds and is not unique, so a direct
 * hit is only taken when it is live and of the right kind; otherwise the
 * listing is searched, trash included, because the editor is where a trashed
 * document is restored from.
 */
export function findBySlug(
  store: DocumentLookup & CatalogReader,
  kind: DocumentKind,
  slug: string,
): Document | undefined {
  const direct = store.getBySlug(slug);
  if (direct?.type === kind.type && !isTrashedPath(direct.path)) return direct;

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
  kind: DocumentScreens,
  document: Document,
  c: Context<GeekityEnv>,
): string | undefined {
  if (kind.type !== 'page') return undefined;

  const settings = c.var.siteAtRequestStart;
  if (settings.homepage === '') return undefined;
  if (document.slug === settings.homepage) return PAGE_ROLE_LABELS.homepage;
  if (document.slug === settings.posts_page) return PAGE_ROLE_LABELS.postsPage;
  return undefined;
}

function listRow(
  kind: DocumentScreens,
  document: Document,
  now: Date,
  role: string | undefined,
  cited: CitedPageReader,
): DocumentRow {
  const isPublic = isServed(document, now);
  return {
    title: postLabel(document, cited),
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
    editUrl: documentEditorPath(kind, document),
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
export function listingUrl(kind: DocumentScreens, filter: DocumentFilter, page = 1): string {
  const query = new URLSearchParams();
  if (filter !== 'all') query.set('status', filter);
  if (page > 1) query.set('page', String(page));
  const search = query.toString();
  return search === '' ? kind.basePath : `${kind.basePath}?${search}`;
}
