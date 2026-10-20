/**
 * The media screen: what is under `content/uploads/` as a grid of tiles, a
 * details screen per file with what links to it, and the things that can be
 * done to one — add one, describe one, take one away.
 */

import type { Context, Hono } from 'hono';

import { postLabel } from '../content/post-type.ts';
import { isTrashedPath } from '../content/store.ts';
import type { CatalogReader } from '../content/store.ts';
import type { Document } from '../content/document.ts';
import { UPLOAD_ASSET_PREFIX } from '../content/uploads.ts';
import type { GeekityEnv } from '../web/env.ts';
import { writeAltText } from '../content/alt-text.ts';
import { STRIP_METADATA_JOB } from '../content/metadata/strip-job.ts';
import type { AltText } from '../content/alt-text.ts';
import type { UploadKind } from '../files/upload-types.ts';
import { describeImage, removeImageVariants, thumbnailUrl } from '../images/variants.ts';
import type { ImageConfig } from '../images/variants.ts';
import { deleteUpload, listUploads, mentionsUpload, resolveUpload } from '../media/library.ts';
import type { MediaFile, RemoveDerived } from '../media/library.ts';
import { refusedUpload, storeUpload } from '../media/uploads.ts';
import { isFile } from '../util/files.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { pageCount } from '../web/pagination.ts';
import { documentEditorPath, PAGE_SCREENS, POST_SCREENS } from './documents.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { jobStatusView } from './job-status.ts';
import { STRIP_METADATA_PANEL, STRIP_METADATA_PATH } from './maintenance.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** Where the media screen lives. */
export const MEDIA_PATH = `${ADMIN_PREFIX}/media`;

/** The navigation section the screen marks as current. */
export const MEDIA_SECTION = 'media';

/** Where one file's details screen lives, with the file as `?path=`. */
export const MEDIA_FILE_PATH = `${MEDIA_PATH}/file`;

/** Where the screen's upload form posts. */
export const MEDIA_UPLOAD_PATH = `${MEDIA_PATH}/upload`;

/** Where a file's Delete button posts. */
export const MEDIA_DELETE_PATH = `${MEDIA_PATH}/delete`;

/** Where a file's alt-text form posts. */
export const MEDIA_ALT_PATH = `${MEDIA_PATH}/alt`;

/** How many files one page of the library shows. */
export const MEDIA_PER_PAGE = 24;

/** The fields the forms on the media screens submit. */
export const MEDIA_FIELDS = {
  /** The file being added, on the upload form. */
  file: 'file',
  /** The upload being deleted or described, as a path under `content/uploads/`. */
  path: 'path',
  /** Set once the admin has been shown what still references the file. */
  confirm: 'confirm',
  /** An image's alt text. */
  alt: 'alt',
  /** Present when an image is decorative, which wins over any alt text. */
  decorative: 'decorative',
  /** The library view a form was posted from, as a query string, so the answer goes back to it. */
  from: 'from',
} as const;

/** The kinds the library's tabs pick between. */
const KIND_TABS: readonly { kind: UploadKind | undefined; label: string }[] = [
  { kind: undefined, label: 'All' },
  { kind: 'image', label: 'Images' },
  { kind: 'audio', label: 'Audio' },
  { kind: 'video', label: 'Video' },
  { kind: 'document', label: 'Documents' },
];

/** The orders the library can be sorted in. Newest is the default and is never written into a URL. */
const SORTS = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  largest: 'Largest first',
  name: 'Name',
} as const;

type MediaSort = keyof typeof SORTS;

/** One view of the library: what the tabs, the filter form and the page links say. */
export interface MediaView {
  kind: UploadKind | undefined;
  /** Matched against the path and the alt text, ignoring case. Empty matches everything. */
  search: string;
  needsAlt: boolean;
  unused: boolean;
  sort: MediaSort;
  page: number;
}

/** A view from a query string. Anything it does not recognise is left at its default. */
export function parseMediaView(query: URLSearchParams): MediaView {
  const kind = query.get('kind');
  const sort = query.get('sort');
  return {
    kind: KIND_TABS.find((tab) => tab.kind !== undefined && tab.kind === kind)?.kind,
    search: (query.get('q') ?? '').trim(),
    needsAlt: query.get('alt') === 'missing',
    unused: query.get('unused') === '1',
    sort: sort !== null && Object.hasOwn(SORTS, sort) ? (sort as MediaSort) : 'newest',
    page: pageNumber(query.get('page') ?? undefined),
  };
}

/** A view as a query string, without the `?`, leaving out everything at its default. */
export function mediaViewQuery(view: MediaView): string {
  const query = new URLSearchParams();
  if (view.kind !== undefined) query.set('kind', view.kind);
  if (view.search !== '') query.set('q', view.search);
  if (view.needsAlt) query.set('alt', 'missing');
  if (view.unused) query.set('unused', '1');
  if (view.sort !== 'newest') query.set('sort', view.sort);
  if (view.page > 1) query.set('page', String(view.page));
  return query.toString();
}

/** The library showing a view. */
export function mediaLibraryUrl(view: MediaView): string {
  const query = mediaViewQuery(view);
  return query === '' ? MEDIA_PATH : `${MEDIA_PATH}?${query}`;
}

/** One file's details screen, reached from a view of the library. */
export function mediaFileUrl(path: string, view: MediaView): string {
  const query = mediaViewQuery(view);
  return `${MEDIA_FILE_PATH}?path=${encodeURIComponent(path)}${query === '' ? '' : `&${query}`}`;
}

/** One document that mentions an upload, as the screens name it. */
export interface MediaReference {
  /** Path relative to the content directory: what identifies the document. */
  path: string;
  /** Its title, or its path when it has none worth showing. */
  title: string;
  /** Where to edit it. */
  editUrl: string;
  /** Whether it is in the trash rather than the live tree. */
  trashed: boolean;
}

/**
 * Every document, live and trashed, that a reference could come from.
 *
 * The trash counts. A trashed post can be restored tomorrow, and restoring one
 * whose picture was deleted in the meantime is a broken post nobody was warned
 * about — so a file the trash still points at asks for confirmation exactly as
 * a published one does.
 *
 * This is the one thing on the screens that comes out of the index rather than
 * off the disk. The index is a cache of the files (decision-1), so it may be a
 * moment behind a hand edit; that is acceptable here because the answer is a
 * warning rather than a decision, and the confirmation step is what makes an
 * out-of-date answer harmless in both directions.
 */
function referenceSources(store: CatalogReader): Document[] {
  // Two queries rather than one because `listAll` shows the live tree or the
  // trash and never both, which is the same reason the taxonomy screens ask
  // twice.
  return [...store.listAll({ trashed: false }), ...store.listAll({ trashed: true })];
}

function referencesAmong(documents: readonly Document[], url: string): MediaReference[] {
  return documents
    .filter((document) => mentionsUpload(document.body, url))
    .map((document) => ({
      path: document.path,
      title: postLabel(document),
      editUrl: documentEditorPath(document.type === 'page' ? PAGE_SCREENS : POST_SCREENS, document),
      trashed: isTrashedPath(document.path),
    }));
}

/** Every document whose body mentions an upload's URL, trash included. */
export function referencesTo(store: CatalogReader, url: string): MediaReference[] {
  return referencesAmong(referenceSources(store), url);
}

/** A file with what the screens add to it: who uses it, and a picture small enough for a tile. */
interface LibraryFile extends MediaFile {
  references: MediaReference[];
  /** A derived copy at least a tile wide when one exists, otherwise the original. */
  thumbnailUrl: string;
  width: number | undefined;
  height: number | undefined;
}

function libraryFile(
  config: ImageConfig,
  documents: readonly Document[],
  file: MediaFile,
): LibraryFile {
  const image = file.kind === 'image' ? describeImage(config, file.path) : undefined;
  return {
    ...file,
    references: referencesAmong(documents, file.url),
    thumbnailUrl: file.kind === 'image' ? thumbnailUrl(config, file.path, file.url) : file.url,
    width: image?.width,
    height: image?.height,
  };
}

function needsAlt(file: LibraryFile): boolean {
  return file.kind === 'image' && file.alt === undefined;
}

/** Whether a file is in a view, leaving the kind tabs and the page aside. */
function matches(file: LibraryFile, view: MediaView): boolean {
  if (view.needsAlt && !needsAlt(file)) return false;
  if (view.unused && file.references.length > 0) return false;
  if (view.search === '') return true;
  const search = view.search.toLowerCase();
  const alt = file.alt?.kind === 'described' ? file.alt.text : '';
  return file.path.toLowerCase().includes(search) || alt.toLowerCase().includes(search);
}

/** `listUploads` is newest first already; the other orders are stable sorts of it. */
function sorted(files: LibraryFile[], sort: MediaSort): LibraryFile[] {
  switch (sort) {
    case 'newest':
      return files;
    case 'oldest':
      return files.toReversed();
    case 'largest':
      return files.toSorted((left, right) => right.bytes - left.bytes);
    case 'name':
      return files.toSorted((left, right) => left.name.localeCompare(right.name));
  }
}

/** What {@link mountMediaScreen} needs from the admin around it. */
export interface MountMediaScreenOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
  /** Passed to every {@link deleteUpload}. See {@link DeleteUploadOptions.removeDerived}. */
  removeDerived?: RemoveDerived | undefined;
}

/**
 * Register the media screens: the library, one file's details, the upload,
 * the alt text and the delete.
 *
 * Uploading here is {@link storeUpload}, exactly as the editor's control and
 * the avatar are, so what a site accepts is one answer given in one place
 * rather than three screens that might disagree.
 */
export function mountMediaScreen(app: Hono<GeekityEnv>, options: MountMediaScreenOptions): void {
  const { render, removeDerived } = options;

  app.get(MEDIA_PATH, async (c) =>
    render(c, ADMIN_TEMPLATES.media, await library(c, viewOf(c.req.url))),
  );

  app.get(MEDIA_FILE_PATH, async (c) => {
    const view = viewOf(c.req.url);
    const details = await fileScreen(c, c.req.query('path') ?? '', view);
    if (details === undefined) {
      flash(c, 'error', 'That is not a file in this site’s uploads.');
      return c.redirect(mediaLibraryUrl(view), 303);
    }
    return render(c, ADMIN_TEMPLATES.mediaFile, details);
  });

  app.post(MEDIA_UPLOAD_PATH, async (c) => {
    const body = await c.req.parseBody();
    const outcome = await storeUpload(body[MEDIA_FIELDS.file], c.var.config);

    if (refusedUpload(outcome)) {
      flash(c, 'error', `${outcome.error} Nothing was added.`);
      return c.redirect(MEDIA_PATH, 303);
    }

    flash(c, 'notice', `Uploaded ${outcome.url}.`);
    return c.redirect(MEDIA_PATH, 303);
  });

  app.post(MEDIA_ALT_PATH, async (c) => {
    const body = await c.req.parseBody();
    const view = postedView(body);
    const relative = stringOrEmpty(body[MEDIA_FIELDS.path]).trim();
    const file = relative === '' ? undefined : resolveUpload(c.var.config.contentDir, relative);

    if (file === undefined || !(await isFile(file))) {
      flash(c, 'error', 'That is not a file in this site’s uploads.');
      return c.redirect(mediaLibraryUrl(view), 303);
    }

    const text = stringOrEmpty(body[MEDIA_FIELDS.alt]).trim().replace(/\s+/g, ' ');
    const alt: AltText | undefined =
      body[MEDIA_FIELDS.decorative] !== undefined
        ? { kind: 'decorative' }
        : text === ''
          ? undefined
          : { kind: 'described', text };
    await writeAltText(c.var.config.contentDir, relative, alt);

    flash(c, 'notice', altSavedMessage(relative, alt));
    return c.redirect(mediaFileUrl(relative, view), 303);
  });

  app.post(MEDIA_DELETE_PATH, async (c) => {
    const body = await c.req.parseBody();
    const view = postedView(body);
    const relative = stringOrEmpty(body[MEDIA_FIELDS.path]).trim();
    const file = relative === '' ? undefined : resolveUpload(c.var.config.contentDir, relative);

    if (file === undefined) {
      flash(c, 'error', 'That is not a file in this site’s uploads.');
      return c.redirect(mediaLibraryUrl(view), 303);
    }

    const url = `${UPLOAD_ASSET_PREFIX}${relative}`;
    const references = referencesTo(c.var.store, url);

    // A file something still points at is offered rather than deleted: the
    // bytes do not come back, and the documents naming them are the whole
    // reason to think twice.
    if (references.length > 0 && stringOrEmpty(body[MEDIA_FIELDS.confirm]).trim() === '') {
      const details = await fileScreen(c, relative, view);
      if (details === undefined) {
        flash(c, 'error', 'That is not a file in this site’s uploads.');
        return c.redirect(mediaLibraryUrl(view), 303);
      }
      return render(c, ADMIN_TEMPLATES.mediaFile, { ...details, confirm: { url, references } });
    }

    const deleted = await deleteUpload({
      contentDir: c.var.config.contentDir,
      path: relative,
      // The site's own image variants unless the caller named something else,
      // so nothing has to be wired at the mount site for the ordinary case
      // and a test can still watch the hook being called.
      removeDerived:
        removeDerived ?? ((uploadPath) => removeImageVariants(c.var.config, uploadPath)),
    });

    flash(
      c,
      deleted ? 'notice' : 'error',
      deleted ? `Deleted ${url}.` : `There is no longer a file at ${url}.`,
    );
    return c.redirect(mediaLibraryUrl(view), 303);
  });

  async function libraryFiles(c: Context<GeekityEnv>): Promise<LibraryFile[]> {
    const documents = referenceSources(c.var.store);
    return (await listUploads(c.var.config.contentDir)).map((file) =>
      libraryFile(c.var.config, documents, file),
    );
  }

  /** Everything the library template renders. */
  async function library(
    c: Context<GeekityEnv>,
    view: MediaView,
  ): Promise<Record<string, unknown>> {
    const all = await libraryFiles(c);
    const matching = all.filter((file) => matches(file, view));
    const files = sorted(
      matching.filter((file) => view.kind === undefined || file.kind === view.kind),
      view.sort,
    );
    const pages = pageCount(files.length, MEDIA_PER_PAGE);
    const start = (view.page - 1) * MEDIA_PER_PAGE;
    const latestSweep = jobStatusView(await c.var.jobs.latest(STRIP_METADATA_JOB.name));

    return {
      section: MEDIA_SECTION,
      child: 'library',
      heading: 'Media',
      listUrl: MEDIA_PATH,
      uploadUrl: MEDIA_UPLOAD_PATH,
      fields: MEDIA_FIELDS,
      accepts: c.var.config.uploadTypes.join(','),
      maxBytes: c.var.config.uploadMaxBytes,
      mediaMaxBytes: c.var.config.uploadMediaMaxBytes,
      // Until a sweep has finished, the older uploads may still carry where
      // they were taken; after one has, everything since was cleaned on arrival.
      sweepNotice:
        latestSweep?.state === 'finished'
          ? undefined
          : { sweep: latestSweep, url: STRIP_METADATA_PATH, panelUrl: STRIP_METADATA_PANEL },
      view,
      sorts: SORTS,
      kindTabs: KIND_TABS.map((tab) => ({
        label: tab.label,
        url: mediaLibraryUrl({ ...view, kind: tab.kind, page: 1 }),
        current: tab.kind === view.kind,
        count: matching.filter((file) => tab.kind === undefined || file.kind === tab.kind).length,
      })),
      filtered: view.search !== '' || view.needsAlt || view.unused,
      clearUrl: mediaLibraryUrl({ ...parseMediaView(new URLSearchParams()), kind: view.kind }),
      total: all.length,
      shown: files.length,
      page: view.page,
      pages,
      previousUrl: view.page > 1 ? mediaLibraryUrl({ ...view, page: view.page - 1 }) : undefined,
      nextUrl:
        start + MEDIA_PER_PAGE < files.length
          ? mediaLibraryUrl({ ...view, page: view.page + 1 })
          : undefined,
      files: files.slice(start, start + MEDIA_PER_PAGE).map((file) => ({
        ...file,
        needsAlt: needsAlt(file),
        detailsUrl: mediaFileUrl(file.path, view),
      })),
    };
  }

  /**
   * Everything the details template renders, or `undefined` when the path is
   * not a file in the library.
   *
   * Previous and next step through the view the file was opened from. The
   * file itself always counts as part of that view, so describing the last
   * image a "needs alt text" view showed does not strand it.
   */
  async function fileScreen(
    c: Context<GeekityEnv>,
    relative: string,
    view: MediaView,
  ): Promise<Record<string, unknown> | undefined> {
    const all = await libraryFiles(c);
    const file = all.find((candidate) => candidate.path === relative);
    if (file === undefined) return undefined;

    const around = sorted(
      all.filter(
        (candidate) =>
          candidate === file ||
          (matches(candidate, view) && (view.kind === undefined || candidate.kind === view.kind)),
      ),
      view.sort,
    );
    const at = around.indexOf(file);
    const previous = around[at - 1];
    const next = around[at + 1];
    const viewAroundFile = { ...view, page: Math.floor(Math.max(at, 0) / MEDIA_PER_PAGE) + 1 };

    return {
      section: MEDIA_SECTION,
      child: 'library',
      heading: file.name,
      file: { ...file, needsAlt: needsAlt(file) },
      fields: MEDIA_FIELDS,
      from: mediaViewQuery(view),
      altUrl: MEDIA_ALT_PATH,
      deleteUrl: MEDIA_DELETE_PATH,
      libraryUrl: mediaLibraryUrl(viewAroundFile),
      selfUrl: mediaFileUrl(file.path, view),
      previousUrl: previous === undefined ? undefined : mediaFileUrl(previous.path, view),
      nextUrl: next === undefined ? undefined : mediaFileUrl(next.path, view),
      position: at + 1,
      count: around.length,
    };
  }
}

function viewOf(url: string): MediaView {
  return parseMediaView(new URL(url).searchParams);
}

function postedView(body: Record<string, unknown>): MediaView {
  return parseMediaView(new URLSearchParams(stringOrEmpty(body[MEDIA_FIELDS.from])));
}

/** What the flash says once an image's alt text has been saved. */
function altSavedMessage(relative: string, alt: AltText | undefined): string {
  if (alt === undefined) return `${relative} has no alt text now.`;
  if (alt.kind === 'decorative') return `${relative} is marked decorative.`;
  return `Saved the alt text for ${relative}.`;
}

/** A `page` query as a page number. Anything that is not one is page one. */
function pageNumber(value: string | undefined): number {
  const parsed = Number(value ?? '1');
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}
