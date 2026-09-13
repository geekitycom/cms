/**
 * The media screen: what is under `content/uploads/`, what links to it, and
 * the two things that can be done to it — add one, and take one away.
 *
 * The listing is a walk of the directory rather than a query, because the
 * directory is the truth (decision-1, decision-9). Nothing records that a file
 * exists; a file dropped in by hand over ssh, by a git pull, or by an Eleventy
 * build is on the screen the next time it is asked for, and a file taken away
 * the same way is off it. The only thing the index is asked is which documents
 * mention a URL, which is a question a directory cannot answer.
 */

import type { Dirent } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { Context, Hono } from 'hono';

import { UPLOAD_MEDIA_TYPES } from '../content/media.ts';
import { isTrashedPath } from '../content/store.ts';
import type { ContentStore } from '../content/store.ts';
import type { GeekityEnv } from '../env.ts';
import { removeImageVariants } from '../images/variants.ts';
import { UPLOAD_ASSET_PREFIX, UPLOAD_DIRECTORY } from '../web/assets.ts';
import { editorPath, PAGE_KIND, POST_KIND } from './documents.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { refusedUpload, storeUpload, uploadMarkdown } from './uploads.ts';

/** Where the media screen lives. */
export const MEDIA_PATH = `${ADMIN_PREFIX}/media`;

/** The navigation section the screen marks as current. */
export const MEDIA_SECTION = 'media';

/** Where the screen's upload form posts. */
export const MEDIA_UPLOAD_PATH = `${MEDIA_PATH}/upload`;

/** Where a row's Delete button posts. */
export const MEDIA_DELETE_PATH = `${MEDIA_PATH}/delete`;

/** How many files one page of the library shows. */
export const MEDIA_PER_PAGE = 24;

/** The fields the forms on the media screen submit. */
export const MEDIA_FIELDS = {
  /** The file being added, on the upload form. */
  file: 'file',
  /** The upload being deleted, as a path under `content/uploads/`. */
  path: 'path',
  /** Set once the admin has been shown what still references the file. */
  confirm: 'confirm',
} as const;

/** One file under `content/uploads/`, as the screen shows it. */
export interface MediaFile {
  /**
   * Where it is under `content/uploads/`, with `/` separators — `2026/09/a.png`.
   * This is the file's identity: it is what the delete form carries, and what
   * a variant directory would mirror.
   */
  path: string;
  /** The public URL the site serves it at. */
  url: string;
  /** The last segment of {@link MediaFile.path}. */
  name: string;
  /** Its extension, lower case, with the dot. Empty when it has none. */
  extension: string;
  /** How big it is, in bytes. */
  bytes: number;
  /** When it last changed, as an ISO 8601 instant, which is what sorts the list. */
  modified: string;
  /** Whether a browser will render it as a picture, so the row shows a thumbnail. */
  image: boolean;
  /** The Markdown for it: an embed for an image, a link for anything else. */
  markdown: string;
}

/**
 * Every file under `content/uploads/`, newest first.
 *
 * Recursive, because uploads land under `{yyyy}/{mm}/`, and a site that has
 * been copying files in by hand may have any shape at all under there. The
 * order is by modification time rather than by the dated path: the path is
 * only a hint about when a file arrived, and a file dropped in by hand may
 * have no dated path to read.
 *
 * A directory that does not exist yet is an empty library rather than an
 * error — a site that has never uploaded anything has no `uploads/`.
 */
export async function listUploads(contentDir: string): Promise<MediaFile[]> {
  const root = path.join(contentDir, UPLOAD_DIRECTORY);

  let entries: Dirent[];
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const found: MediaFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Hidden files are the operating system's business, not the site's:
    // .DS_Store is not something anybody uploaded or wants to link to.
    if (entry.name.startsWith('.')) continue;

    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(root, file).split(path.sep).join('/');

    let stats;
    try {
      stats = await stat(file);
    } catch {
      // It went away between the walk and the stat. Nothing to show.
      continue;
    }

    found.push(describeUpload(relative, stats.size, stats.mtime));
  }

  // Newest first, and by path when two files share a timestamp, so a page of
  // files copied in together has a stable order rather than the readdir one.
  found.sort((left, right) =>
    left.modified === right.modified
      ? right.path.localeCompare(left.path)
      : right.modified.localeCompare(left.modified),
  );
  return found;
}

/** One upload as the screen shows it, from what a directory walk knows. */
export function describeUpload(relative: string, bytes: number, modified: Date): MediaFile {
  const name = relative.slice(relative.lastIndexOf('/') + 1);
  const extension = path.extname(name).toLowerCase();
  const image = UPLOAD_MEDIA_TYPES.get(extension)?.image ?? false;
  const url = `${UPLOAD_ASSET_PREFIX}${relative}`;

  return {
    path: relative,
    url,
    name,
    extension,
    bytes,
    modified: modified.toISOString(),
    image,
    // The same Markdown the editor's upload control pastes, from the same
    // function, so a file linked from the media screen and the same file
    // linked from the editor are written identically.
    markdown: uploadMarkdown({ url, label: name.slice(0, name.length - extension.length), image }),
  };
}

/** One document that mentions an upload, as the confirmation names it. */
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
 * Every document whose body mentions an upload's URL, trash included.
 *
 * The trash counts. A trashed post can be restored tomorrow, and restoring one
 * whose picture was deleted in the meantime is a broken post nobody was warned
 * about — so a file the trash still points at asks for confirmation exactly as
 * a published one does.
 *
 * This is the one thing on the screen that comes out of the index rather than
 * off the disk. The index is a cache of the files (decision-1), so it may be a
 * moment behind a hand edit; that is acceptable here because the answer is a
 * warning rather than a decision, and the confirmation step is what makes an
 * out-of-date answer harmless in both directions.
 */
export function referencesTo(store: ContentStore, url: string): MediaReference[] {
  // Two queries rather than one because `listAll` shows the live tree or the
  // trash and never both, which is the same reason the taxonomy screens ask
  // twice.
  return [...store.listAll({ trashed: false }), ...store.listAll({ trashed: true })]
    .filter((document) => mentionsUpload(document.body, url))
    .map((document) => ({
      path: document.path,
      title: document.title === '' ? document.path : document.title,
      editUrl: editorPath(document.type === 'page' ? PAGE_KIND : POST_KIND, document.slug),
      trashed: isTrashedPath(document.path),
    }));
}

/**
 * Whether a body points at an upload URL.
 *
 * A substring search with one guard on the end of it: `/uploads/a.png` must not
 * count as a mention of `/uploads/a.pn`, and `/uploads/logo.png` must not count
 * as a mention of `/uploads/logo`. Anything that could still be part of the
 * same filename disqualifies the match; a quote, a bracket, a space or the end
 * of the body ends it.
 *
 * Deliberately blind to whether the mention is Markdown, HTML or prose. All
 * three break when the file goes, and a warning that only understood
 * `![](…)` would be a warning that missed most of them.
 */
export function mentionsUpload(body: string, url: string): boolean {
  for (let at = body.indexOf(url); at !== -1; at = body.indexOf(url, at + 1)) {
    const next = body[at + url.length];
    if (next === undefined || !FILENAME_CHARACTER.test(next)) return true;
  }
  return false;
}

/** Characters that could still be part of the filename a match landed in. */
const FILENAME_CHARACTER = /[A-Za-z0-9._~-]/;

/** What {@link deleteUpload} needs to take a file away. */
export interface DeleteUploadOptions {
  /** The site's content directory. */
  contentDir: string;
  /** The file, as a path under `content/uploads/` with `/` separators. */
  path: string;
  /**
   * Take the file's derived files with it.
   *
   * The original under `content/uploads/` is the only source of truth
   * (decision-10); the image variants beside it are derived, and derived state
   * that outlives what it was derived from is rubbish nobody will ever clean
   * up. The hook is passed the same content-relative path, is awaited before
   * the delete reports success, and is expected to be forgiving: a file with
   * no variants at all is the normal case.
   */
  removeDerived?: RemoveDerived | undefined;
}

/** Takes an upload's derived files away with it. See {@link DeleteUploadOptions.removeDerived}. */
export type RemoveDerived = (uploadPath: string) => Promise<void>;

/**
 * Delete one upload, and whatever was derived from it.
 *
 * Returns `false` when there was no such file, which is what a second click on
 * a Delete button on a stale page is, rather than throwing: the end state the
 * admin asked for is the end state they have.
 */
export async function deleteUpload(options: DeleteUploadOptions): Promise<boolean> {
  const file = resolveUpload(options.contentDir, options.path);
  if (file === undefined) return false;

  try {
    await unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }

  // After the original, so a hook that throws leaves a file with stale
  // variants rather than variants with no file: the first is repairable by
  // regenerating, the second is orphaned bytes.
  await options.removeDerived?.(options.path);
  return true;
}

/**
 * A submitted path as an absolute file under `content/uploads/`, or
 * `undefined` when it is not one.
 *
 * The path arrives in a form, so it is an attacker's string as much as an
 * admin's. Containment is checked after resolution rather than by inspecting
 * the string, so `..`, an encoded one, or an absolute path cannot slip past —
 * the same rule {@link findAsset} applies to a request for a file.
 */
export function resolveUpload(contentDir: string, relative: string): string | undefined {
  if (relative === '' || relative.includes('\0')) return undefined;

  const root = path.resolve(contentDir, UPLOAD_DIRECTORY);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) return undefined;
  return file;
}

/** What {@link mountMediaScreen} needs from the admin around it. */
export interface MountMediaScreenOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
  /** Passed to every {@link deleteUpload}. See {@link DeleteUploadOptions.removeDerived}. */
  removeDerived?: RemoveDerived | undefined;
}

/**
 * Register the media screen: the library, the upload form and the delete.
 *
 * Uploading here is {@link storeUpload}, exactly as the editor's control and
 * the avatar are, so what a site accepts is one answer given in one place
 * rather than three screens that might disagree.
 */
export function mountMediaScreen(app: Hono<GeekityEnv>, options: MountMediaScreenOptions): void {
  const { render, removeDerived } = options;

  app.get(MEDIA_PATH, async (c) => render(c, ADMIN_TEMPLATES.media, await screen(c)));

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

  app.post(MEDIA_DELETE_PATH, async (c) => {
    const body = await c.req.parseBody();
    const relative = field(body[MEDIA_FIELDS.path]);
    const file = relative === '' ? undefined : resolveUpload(c.var.config.contentDir, relative);

    if (file === undefined) {
      flash(c, 'error', 'That is not a file in this site’s uploads.');
      return c.redirect(MEDIA_PATH, 303);
    }

    const url = `${UPLOAD_ASSET_PREFIX}${relative}`;
    const references = referencesTo(c.var.store, url);

    // A file something still points at is offered rather than deleted: the
    // bytes do not come back, and the documents naming them are the whole
    // reason to think twice.
    if (references.length > 0 && field(body[MEDIA_FIELDS.confirm]) === '') {
      return render(
        c,
        ADMIN_TEMPLATES.media,
        await screen(c, { confirm: { path: relative, url, references } }),
      );
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
    return c.redirect(MEDIA_PATH, 303);
  });

  /** Everything the media template renders. */
  async function screen(
    c: Context<GeekityEnv>,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const files = await listUploads(c.var.config.contentDir);
    const page = pageNumber(c.req.query('page'));
    const start = (page - 1) * MEDIA_PER_PAGE;

    return {
      section: MEDIA_SECTION,
      child: 'library',
      heading: 'Media',
      listUrl: MEDIA_PATH,
      uploadUrl: MEDIA_UPLOAD_PATH,
      deleteUrl: MEDIA_DELETE_PATH,
      fields: MEDIA_FIELDS,
      accepts: c.var.config.uploadTypes.join(','),
      maxBytes: c.var.config.uploadMaxBytes,
      total: files.length,
      page,
      pages: Math.max(1, Math.ceil(files.length / MEDIA_PER_PAGE)),
      previousUrl: page > 1 ? mediaPageUrl(page - 1) : undefined,
      nextUrl: start + MEDIA_PER_PAGE < files.length ? mediaPageUrl(page + 1) : undefined,
      // Reference counts are one index scan per file on the page rather than
      // per file in the library, which is what paging is for.
      files: files.slice(start, start + MEDIA_PER_PAGE).map((file) => ({
        ...file,
        references: referencesTo(c.var.store, file.url),
      })),
      ...extra,
    };
  }
}

/** The URL of one page of the library. Page one is the screen's own URL. */
export function mediaPageUrl(page: number): string {
  return page > 1 ? `${MEDIA_PATH}?page=${String(page)}` : MEDIA_PATH;
}

/** A `page` query as a page number. Anything that is not one is page one. */
function pageNumber(value: string | undefined): number {
  const parsed = Number(value ?? '1');
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function field(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
