import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type { Context, Hono } from 'hono';

import type { Document, DocumentContent, DocumentType } from '../content/document.ts';
import { renderMarkdown } from '../content/markdown.ts';
import { parseDocument } from '../content/parser.ts';
import { postLabel } from '../content/post-type.ts';
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
import { normalizeBody, serializeDocument } from '../content/writer.ts';
import type { GeekityEnv } from '../env.ts';
import { isPublicDocument } from '../web/documents.ts';
import { COMMENTS_FRONT_MATTER_KEY } from '../comments/policy.ts';
import { CONTACT_FRONT_MATTER_KEY } from '../contact/form.ts';
import { userForAuthor } from '../web/authors.ts';
import { findUserById, listUsers } from './accounts.ts';
import type { User } from './accounts.ts';
import { flash } from './flash.ts';
import { formatInTimezone } from './formatting.ts';
import { readSiteSettings } from './settings.ts';
import { PREVIEW_PATH } from './preview.ts';
import { ADMIN_PREFIX } from './session.ts';
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
    return renderEditor(c, { kind, render, document, form: formFor(document, siteTimezone(c)) });
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
 * Write what the editor submitted.
 *
 * The order matters: the form is read and checked before anything is touched,
 * the on-disk file is re-hashed and compared with the hash the form loaded with
 * (doc-1's conflict rule), and only then is a file written. A save that is
 * refused — a page with no title, an unreadable date, a stale hash, a URL
 * another document already holds — leaves the content directory exactly as it
 * was.
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
    draft: body['draft'] !== undefined,
    exclude: body['exclude'] !== undefined,
    contact: body['contact'] !== undefined,
    comments: commentSetting(text(body['comments'])),
    body: normalizeBody(text(body['body'])),
    hash: text(body['hash']),
  };

  const action = text(body['action']);
  // The buttons doc-5 names are shortcuts past the checkbox: Save draft and
  // Publish say what they do, and Update leaves the decision to the checkbox.
  const draft = action === 'save-draft' ? true : action === 'publish' ? false : form.draft;

  function refuse(message: string): Response {
    return renderEditor(c, {
      kind,
      render,
      document,
      form: { ...form, draft },
      error: message,
      status: 400,
    });
  }

  // A post with no title is a note; a page is always named.
  if (form.title === '' && kind.type === 'page') {
    return refuse(`A ${kind.singular} needs a title.`);
  }

  const timezone = siteTimezone(c);

  // decision-11: what the file gets is a UTC instant, and an offset-less field
  // is the site's own wall clock rather than the server's.
  const typed = kind.dated ? (form.date === '' ? store.now().toISOString() : form.date) : undefined;
  if (typed !== undefined && !/^\d{4}-\d{2}-\d{2}/.test(typed)) {
    return refuse('A date has to start with a year, a month and a day, like 2026-03-04.');
  }
  const date = typed === undefined ? undefined : toUtcInstant(typed, timezone);
  if (typed !== undefined && date === undefined) {
    return refuse('That date is not one anybody can read. Try 2026-03-04 09:00.');
  }

  const slug =
    slugify(form.slug) ||
    slugify(form.title) ||
    (document?.slug ?? '') ||
    noteSlug(form.body) ||
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

  // decision-13: a published post's permalink is its name in the fediverse as
  // well as on the web, and the two are one promise. Moving it hands every
  // follower a second object and breaks every link somebody already shared, so
  // the editor refuses. A draft has promised nothing yet and may still move;
  // a site that really means to move a published post can still do it in the
  // file, knowing what it costs.
  const promised = promisedDocument(kind, document, store.now());
  if (promised !== undefined) {
    if (finalSlug !== promised.slug) {
      return refuse(
        `The permalink of a published post is permanent, and the slug names the file it is filed under: this ${kind.singular} keeps the slug ${promised.slug}.`,
      );
    }
    // An empty field is not a request to move: it is a form that carried no
    // permalink, and the promised one is what it keeps. Only a field naming
    // some other URL is somebody asking for the one thing this refuses.
    const submitted = normalizePermalink(form.permalink);
    if (submitted !== undefined && submitted !== promised.permalink) {
      return refuse(
        `The permalink of a published post is permanent: this ${kind.singular} stays at ${promised.permalink}.`,
      );
    }
  }

  const permalink =
    promised?.permalink ??
    resolvePermalink({
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
      return renderConflict(c, { kind, render, document, form: { ...form, draft }, conflict });
    }
  }

  if (target !== document?.path && store.getByPath(target) !== undefined) {
    return refuse(`Another ${kind.singular} already lives in ${target}.`);
  }

  const content: DocumentContent = {
    title: form.title,
    ...(date === undefined ? {} : { date }),
    updated: store.now().toISOString(),
    permalink,
    tags: kind.tagged ? splitTags(form.tags) : [],
    categories: kind.categorised ? splitTags(form.categories) : [],
    draft,
    ...(form.description === '' ? {} : { description: form.description }),
    ...optional('author', chosenAuthor(c, form.author, document)),
    ...optional('activitypub', document?.activitypub),
    extra: resolveExtra(kind, document, form),
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
    if (error instanceof DuplicatePermalinkError) return refuse(error.message);
    throw error;
  }

  if (renamedFrom !== undefined) {
    await rm(path.join(contentDir, ...renamedFrom.path.split('/')), { force: true });
  }

  // Announced rather than left to the watcher: the index already holds what
  // was written, so the watcher's re-read is a no-op and nobody would ever
  // hear that this post was published. Awaited, so a subscriber that writes
  // back to the file — the federation stamping `activitypub` into a post it
  // has just announced — has finished before the editor is reloaded with a
  // hash that would otherwise be one save behind.
  await c.var.announce({
    type: document === undefined ? 'created' : 'updated',
    path: saved.path,
    previous: document,
    next: saved,
    origin: 'admin',
  });

  flash(c, 'notice', savedMessage(kind, document, saved, store.now()));
  return c.redirect(editorPath(kind, saved.slug), 303);
}

/** How many of an untitled post's first words its slug is made from. */
const NOTE_SLUG_WORDS = 5;

/** The slug a note takes from its first words, or empty when it has none. */
function noteSlug(body: string): string {
  const words = htmlToText(renderMarkdown(body)).split(' ').slice(0, NOTE_SLUG_WORDS);
  return slugify(words.join(' '));
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
 * The document whose permalink has already been promised, or `undefined` when
 * nothing has been promised yet.
 *
 * A published post, and only a published post. decision-13 makes its permalink
 * its ActivityStreams object id, so the URL is a name its followers, its
 * replies and its feed subscribers are all holding; a draft, a trashed post
 * and one whose date has not arrived have been shown to nobody, and a page
 * federates nothing at all.
 */
function promisedDocument(
  kind: DocumentKind,
  document: Document | undefined,
  now: Date,
): Document | undefined {
  if (document === undefined || kind.type !== 'post') return undefined;
  return isPublicDocument(document, now) ? document : undefined;
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
  form: Pick<EditorForm, 'exclude' | 'comments' | 'contact'>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = { ...(document?.extra ?? {}) };

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
  c: Context<GeekityEnv>,
  submitted: string,
  document: Document | undefined,
): string | undefined {
  const named = userForAuthor(listUsers(c.var.config.dataDir), submitted);
  if (named !== undefined) return named.username;
  return document?.author ?? currentUsername(c);
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
    ...optional('activitypub', document.activitypub),
    extra: resolveExtra(kind, document, form),
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
 * Move a document into `content/_trash/` or back out of it.
 *
 * The trash mirrors the content tree — `posts/2026-03-04-x.md` becomes
 * `_trash/posts/2026-03-04-x.md` — so restoring is the same move backwards and
 * needs to remember nothing. The index is corrected as soon as the file has
 * landed rather than waiting for the watcher, so the public site stops or
 * starts serving the document with this request (doc-1).
 */
async function moveDocument(
  c: Context<GeekityEnv>,
  options: MoveDocumentOptions,
): Promise<Response> {
  const { kind, document, action } = options;
  const store = c.var.store;
  const contentDir = c.var.config.contentDir;

  const trashed = isTrashedPath(document.path);
  if (action === 'trash' && trashed) return backTo(c, options, `It is already in the trash.`);
  if (action === 'restore' && !trashed) return backTo(c, options, `It is not in the trash.`);

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
    return backTo(c, options, `Could not move ${document.path}. Is the file still there?`);
  }

  const moved = parseDocument(source, { path: target, type: document.type });
  store.remove(document.path);
  store.upsert(moved);

  // Trashing takes a post off the public site and restoring puts it back, so
  // both are visibility changes a subscriber has to hear about.
  await c.var.announce({
    type: 'updated',
    path: target,
    previous: document,
    next: moved,
    origin: 'admin',
  });

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
  draft: boolean;
  /** Whether `eleventyExcludeFromCollections` is set. Pages only. */
  exclude: boolean;
  /** Whether the page offers a contact form. Pages only. */
  contact: boolean;
  /**
   * What the document says about comments: one of {@link COMMENT_SETTINGS}.
   *
   * Three values rather than a checkbox, because there are three answers: the
   * site's rules decide (the front matter says nothing), always open, always
   * closed. A checkbox could only ever spell two of them, and the one it would
   * lose is the default every document starts at.
   */
  comments: string;
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
    draft: false,
    exclude: false,
    contact: false,
    comments: COMMENT_SETTINGS.site,
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
 */
export function formFor(document: Document, timezone: string = DEFAULT_TIMEZONE): EditorForm {
  return {
    title: document.title,
    slug: document.slug,
    permalink: document.permalink,
    date: document.date === undefined ? '' : wallClockIn(document.date, timezone),
    tags: document.tags.join(', '),
    categories: document.categories.join(', '),
    description: document.description ?? '',
    author: document.author ?? '',
    draft: document.draft,
    exclude: document.extra[EXCLUDE_KEY] === true,
    contact: document.extra[CONTACT_FRONT_MATTER_KEY] === true,
    comments: commentSettingOf(document),
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
  /** A message about the save that was just refused. */
  error?: string | undefined;
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
function renderEditor(c: Context<GeekityEnv>, options: RenderEditorOptions): Response {
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
    // Who this can be attributed to, and who it is attributed to now.
    authors: authorChoices(c, form.author),
    heading:
      document === undefined
        ? `Add ${kind.singular}`
        : `Edit ${kind.singular}: ${postLabel(document)}`,
    saveUrl: document === undefined ? newEditorPath(kind) : editorPath(kind, document.slug),
    listUrl: kind.basePath,
    previewUrl: PREVIEW_PATH,
    uploadUrl: UPLOADS_PATH,
    viewUrl:
      document !== undefined && isPublicDocument(document, now) ? document.permalink : undefined,
    // Named beside the date field, because a wall clock with no zone on it is
    // exactly the ambiguity decision-11 exists to remove.
    ...(kind.dated ? { dateZone: zoneLabel(form.date === '' ? now : form.date, timezone) } : {}),
    ...(scheduledAt === undefined ? {} : { scheduledFor: formatInTimezone(scheduledAt, timezone) }),
    ...(options.error === undefined ? {} : { error: options.error }),
  });
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
  const isPublic = isPublicDocument(document, now);
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
