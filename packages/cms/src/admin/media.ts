/**
 * The media screen: what is under `content/uploads/` as a grid of tiles, a
 * details screen per file with what links to it, and the things that can be
 * done to one — add one, describe one, take one away.
 */

import type { Context, Hono } from 'hono';

import { postLabel } from '../content/post-type.ts';
import { isTrashedPath } from '../content/store.ts';
import type { Document } from '../content/document.ts';
import { UPLOAD_ASSET_PREFIX } from '../content/uploads.ts';
import type { GeekityEnv } from '../web/env.ts';
import { writeAltText } from '../content/alt-text.ts';
import { STRIP_METADATA_JOB } from '../content/metadata/strip-job.ts';
import type { AltText } from '../content/alt-text.ts';
import type { UploadKind } from '../files/upload-types.ts';
import { describeImage, removeImageVariants, thumbnailUrl } from '../images/variants.ts';
import type { ImageConfig } from '../images/variants.ts';
import {
  deleteUpload,
  listUploads,
  resolveUpload,
  usageText,
  usesUpload,
} from '../media/library.ts';
import type { MediaFile, RemoveDerived } from '../media/library.ts';
import { refusedUpload, storeUpload } from '../media/uploads.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { SITE } from '../site/settings.ts';
import { listUsers } from '../site/users.ts';
import { isFile } from '../util/files.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { pageCount } from '../web/pagination.ts';
import { documentEditorPath, PAGE_SCREENS, POST_SCREENS } from './documents.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { jobStatusView } from './job-status.ts';
import { STRIP_METADATA_PANEL, STRIP_METADATA_PATH } from './maintenance.ts';
import { ADMIN_PREFIX, editUserPath } from '../site/admin-paths.ts';
import { SETTINGS_PATH } from './settings.ts';
import { GENERAL_SETTINGS } from './settings-general.ts';
import type { SettingsPage } from './settings-page.ts';
import { ALL_SETTINGS_PAGES } from './settings-pages.ts';
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

/** One thing that uses an upload — a document, a setting, a profile — as the screens name it. */
export interface MediaReference {
  /** A document's title, or what the site uses the file as: "The site icon". */
  title: string;
  /** Where to change it: the document's editor, the settings page, the user's screen. */
  editUrl: string;
  /** Where it is: a document's path relative to the content directory, or the screen that sets it. */
  where: string;
  /** Whether it is a document in the trash rather than the live tree. */
  trashed: boolean;
}

/** One place an upload could be used from, with every string it holds as one text. */
interface ReferenceSource {
  reference: MediaReference;
  text: string;
}

/**
 * Everything that could use an upload: every document, live and trashed, and
 * the site itself — its settings and its users' profiles.
 *
 * A document counts by its body and by every front-matter value, so a photo
 * post's `photo` list, a review's `item.photo` and anything a theme reads out
 * of front matter all count, whatever shape they nest in.
 *
 * The trash counts. A trashed post can be restored tomorrow, and restoring one
 * whose picture was deleted in the meantime is a broken post nobody was warned
 * about — so a file the trash still points at asks for confirmation exactly as
 * a published one does.
 *
 * The documents come out of the index rather than off the disk. The index is
 * a cache of the files (decision-1), so it may be a moment behind a hand edit;
 * that is acceptable here because the answer is a warning rather than a
 * decision, and the confirmation step is what makes an out-of-date answer
 * harmless in both directions.
 *
 * Gathered once per request, with each source's text flattened once, so the
 * library asks every file the same list rather than walking it per file.
 */
async function referenceSources(c: Context<GeekityEnv>): Promise<ReferenceSource[]> {
  // Two queries rather than one because `listAll` shows the live tree or the
  // trash and never both, which is the same reason the taxonomy screens ask
  // twice.
  const documents = [
    ...c.var.store.listAll({ trashed: false }),
    ...c.var.store.listAll({ trashed: true }),
  ];
  return [
    ...documents.map(documentSource),
    ...(await settingSources(c.var.settings)),
    ...userSources(c.var.config.dataDir),
  ];
}

function documentSource(document: Document): ReferenceSource {
  // The rendered HTML is the body again, and the hash and path name no upload.
  const { html: _html, hash: _hash, path: where, ...written } = document;
  return {
    reference: {
      title: postLabel(document),
      editUrl: documentEditorPath(document.type === 'page' ? PAGE_SCREENS : POST_SCREENS, document),
      where,
      trashed: isTrashedPath(document.path),
    },
    text: usageText(written),
  };
}

/** What the site's own settings are called where they hold an upload. */
const SITE_SETTING_TITLES: Readonly<Record<string, string>> = {
  icon: 'The site icon',
  avatar: 'The site’s old avatar, which the site icon falls back to',
};

/** Every setting in effect, secrets aside, each linked to the page that sets it. */
async function settingSources(settings: SettingsRegistry): Promise<ReferenceSource[]> {
  const sources: ReferenceSource[] = [];
  for (const ref of settings.list()) {
    if (ref.declaration.secret === true) continue;
    const text = usageText(await settings.get(ref));
    if (!text.includes(UPLOAD_ASSET_PREFIX)) continue;
    const page = ref.namespace === SITE.declaration.namespace ? settingsPageOf(ref.key) : undefined;
    sources.push({
      reference: {
        title: SITE_SETTING_TITLES[ref.key] ?? `The ${ref.namespace} setting ${ref.key}`,
        editUrl: page?.path ?? SETTINGS_PATH,
        where: page === undefined ? 'Settings' : (page.heading ?? `Settings › ${page.label}`),
        trashed: false,
      },
      text,
    });
  }
  return sources;
}

/**
 * The settings page a site setting is on. The old avatar is on none, and is
 * filed under General because that is where the icon it stands in for is set.
 */
function settingsPageOf(key: string): SettingsPage | undefined {
  if (key === 'avatar') return GENERAL_SETTINGS;
  return ALL_SETTINGS_PAGES.find((page) => (page.fields as readonly string[]).includes(key));
}

/** Each user's avatar, and the rest of their profile, linked to their screen. */
function userSources(dataDir: string): ReferenceSource[] {
  return listUsers(dataDir).flatMap((user) => {
    const { avatar, ...rest } = user.profile ?? {};
    const name = user.profile?.displayName ?? user.username;
    const reference = { editUrl: editUserPath(user.id), where: 'Users', trashed: false };
    return [
      { reference: { ...reference, title: `${name}’s avatar` }, text: avatar ?? '' },
      { reference: { ...reference, title: `${name}’s profile` }, text: usageText(rest) },
    ];
  });
}

function referencesAmong(sources: readonly ReferenceSource[], relative: string): MediaReference[] {
  return sources
    .filter((source) => usesUpload(source.text, relative))
    .map((source) => source.reference);
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
  sources: readonly ReferenceSource[],
  file: MediaFile,
): LibraryFile {
  const image = file.kind === 'image' ? describeImage(config, file.path) : undefined;
  return {
    ...file,
    references: referencesAmong(sources, file.path),
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
    const references = referencesAmong(await referenceSources(c), relative);

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
    const sources = await referenceSources(c);
    return (await listUploads(c.var.config.contentDir)).map((file) =>
      libraryFile(c.var.config, sources, file),
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
