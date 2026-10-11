/**
 * The media screen: what is under `content/uploads/`, what links to it, and
 * the two things that can be done to it — add one, and take one away.
 *
 * The files themselves are `media/library.ts`. The only thing the index is
 * asked is which documents mention a URL, which is a question a directory
 * cannot answer.
 */

import type { Context, Hono } from 'hono';

import { postLabel } from '../content/post-type.ts';
import { isTrashedPath } from '../content/store.ts';
import type { ContentStore } from '../content/store.ts';
import type { GeekityEnv } from '../env.ts';
import { writeAltText } from '../images/alt-text.ts';
import type { AltText } from '../images/alt-text.ts';
import { removeImageVariants } from '../images/variants.ts';
import { deleteUpload, listUploads, mentionsUpload, resolveUpload } from '../media/library.ts';
import type { RemoveDerived } from '../media/library.ts';
import { refusedUpload, storeUpload } from '../media/uploads.ts';
import { isFile } from '../util/files.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import { pageCount } from '../web/pagination.ts';
import { documentEditorPath, PAGE_SCREENS, POST_SCREENS } from './documents.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** Where the media screen lives. */
export const MEDIA_PATH = `${ADMIN_PREFIX}/media`;

/** The navigation section the screen marks as current. */
export const MEDIA_SECTION = 'media';

/** Where the screen's upload form posts. */
export const MEDIA_UPLOAD_PATH = `${MEDIA_PATH}/upload`;

/** Where a row's Delete button posts. */
export const MEDIA_DELETE_PATH = `${MEDIA_PATH}/delete`;

/** Where a row's alt-text form posts. */
export const MEDIA_ALT_PATH = `${MEDIA_PATH}/alt`;

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
  /** An image's alt text. */
  alt: 'alt',
  /** Present when an image is decorative, which wins over any alt text. */
  decorative: 'decorative',
  /** The library page an alt-text form was on, so saving it goes back there. */
  page: 'page',
} as const;

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
      title: postLabel(document),
      editUrl: documentEditorPath(document.type === 'page' ? PAGE_SCREENS : POST_SCREENS, document),
      trashed: isTrashedPath(document.path),
    }));
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

  app.post(MEDIA_ALT_PATH, async (c) => {
    const body = await c.req.parseBody();
    const relative = stringOrEmpty(body[MEDIA_FIELDS.path]).trim();
    const file = relative === '' ? undefined : resolveUpload(c.var.config.contentDir, relative);

    if (file === undefined || !(await isFile(file))) {
      flash(c, 'error', 'That is not a file in this site’s uploads.');
      return c.redirect(MEDIA_PATH, 303);
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
    return c.redirect(mediaPageUrl(pageNumber(stringOrEmpty(body[MEDIA_FIELDS.page]).trim())), 303);
  });

  app.post(MEDIA_DELETE_PATH, async (c) => {
    const body = await c.req.parseBody();
    const relative = stringOrEmpty(body[MEDIA_FIELDS.path]).trim();
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
    if (references.length > 0 && stringOrEmpty(body[MEDIA_FIELDS.confirm]).trim() === '') {
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
      altUrl: MEDIA_ALT_PATH,
      fields: MEDIA_FIELDS,
      accepts: c.var.config.uploadTypes.join(','),
      maxBytes: c.var.config.uploadMaxBytes,
      mediaMaxBytes: c.var.config.uploadMediaMaxBytes,
      total: files.length,
      page,
      pages: pageCount(files.length, MEDIA_PER_PAGE),
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

/** What the flash says once an image's alt text has been saved. */
function altSavedMessage(relative: string, alt: AltText | undefined): string {
  if (alt === undefined) return `${relative} has no alt text now.`;
  if (alt.kind === 'decorative') return `${relative} is marked decorative.`;
  return `Saved the alt text for ${relative}.`;
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
