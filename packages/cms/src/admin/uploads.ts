import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Hono, MiddlewareHandler } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import { matchesSignature, UPLOAD_MEDIA_TYPES } from '../content/media.ts';
import type { UploadMediaType } from '../content/media.ts';
import { slugify } from '../content/slug.ts';
import type { GeekityEnv } from '../env.ts';
import { UPLOAD_ASSET_PREFIX, UPLOAD_DIRECTORY } from '../web/assets.ts';
import { ADMIN_PREFIX } from './session.ts';

/** Where the editor posts a file it wants stored. */
export const UPLOADS_PATH = `${ADMIN_PREFIX}/uploads`;

/** The form field the file arrives in. */
export const UPLOAD_FIELD = 'file';

/**
 * Slack allowed on top of the size limit when a `Content-Length` is checked.
 *
 * A multipart body is the file plus a boundary, a couple of headers and a
 * trailing marker. Nobody wants a 9.99 MiB image refused because its envelope
 * pushed the request over ten, so the header check is deliberately generous
 * and {@link mountUploads} does the exact one on the file itself.
 */
export const UPLOAD_ENVELOPE_BYTES = 8192;

/** What the editor gets back when a file has landed. */
export interface UploadResult {
  /** The public URL of the file, which the site serves straight away. */
  url: string;
  /** Markdown to paste at the cursor: an embed for an image, a link otherwise. */
  markdown: string;
}

/** The part of the config the upload rules are read out of. */
export type UploadConfig = Pick<ResolvedConfig, 'contentDir' | 'uploadTypes' | 'uploadMaxBytes'>;

/** One file that has landed under `content/uploads/`. */
export interface StoredUpload {
  /** The public URL of the file, which the site serves straight away. */
  url: string;
  /** What the CMS decided the file is; `media.image` says whether it is one. */
  media: UploadMediaType;
  /** The submitted name without its extension, for a caption or an alt text. */
  label: string;
}

/** Why an upload was refused, and the status that refusal answers with. */
export interface UploadRefusal {
  /** 400 for a request carrying no file, 413 for one too big, 415 for one of the wrong sort. */
  status: 400 | 413 | 415;
  /** What to tell whoever sent it. */
  error: string;
}

/** What a caller may ask of an upload beyond the site's own rules. */
export interface StoreUploadOptions {
  /**
   * Refuse anything that is not an image, whatever else the site's allowlist
   * accepts. The avatar asks for this: a PDF is a fine upload and a hopeless
   * profile picture.
   */
  imagesOnly?: boolean | undefined;
}

/** Whether an upload came to a refusal rather than a stored file. */
export function refusedUpload(outcome: StoredUpload | UploadRefusal): outcome is UploadRefusal {
  return 'error' in outcome;
}

/**
 * Validate one submitted file and write it under
 * `content/uploads/{yyyy}/{mm}/{slug}{ext}`, or say why it cannot be.
 *
 * Three things have to agree before anything is written — the extension is on
 * the site's allowlist, the media type the browser declared is one that
 * extension is allowed to have, and the file's first bytes are that format's.
 * A name is never overwritten; a second `photo.png` becomes `photo-2.png`.
 *
 * It is a function rather than part of the endpoint because the editor's
 * uploads and the settings screen's avatar are the same rules over the same
 * directory, and two copies of them would be two chances to disagree about
 * what a site accepts.
 */
export async function storeUpload(
  file: unknown,
  config: UploadConfig,
  options: StoreUploadOptions = {},
): Promise<StoredUpload | UploadRefusal> {
  if (!(file instanceof File)) {
    return { status: 400, error: 'That upload carried no file.' };
  }

  const original = baseName(file.name);
  const extension = path.extname(original).toLowerCase();

  if (!config.uploadTypes.includes(extension)) {
    const allowed = config.uploadTypes.join(', ');
    return {
      status: 415,
      error:
        extension === ''
          ? `That file has no extension, so there is no telling what it is. This site accepts ${allowed}.`
          : `Uploads of ${extension} are not allowed here. This site accepts ${allowed}.`,
    };
  }

  // Guaranteed by resolveConfig, which refuses an allowlist naming anything
  // the table has no entry for.
  const media = UPLOAD_MEDIA_TYPES.get(extension) as UploadMediaType;

  if (options.imagesOnly === true && !media.image) {
    return { status: 415, error: `A ${extension} is not an image, and this has to be one.` };
  }

  const declared = declaredType(file.type);
  if (declared !== '' && !media.declared.includes(declared)) {
    return {
      status: 415,
      error: `That file says it is ${declared}, which is not what a ${extension} is.`,
    };
  }

  if (file.size > config.uploadMaxBytes) {
    return { status: 413, error: tooLargeMessage(config.uploadMaxBytes) };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesSignature(media, bytes)) {
    return { status: 415, error: `That file does not look like a ${extension} inside.` };
  }

  const now = new Date();
  const month = `${String(now.getUTCFullYear()).padStart(4, '0')}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const directory = path.join(config.contentDir, UPLOAD_DIRECTORY, ...month.split('/'));
  await mkdir(directory, { recursive: true });

  const stem = slugify(original.slice(0, original.length - extension.length)) || 'upload';
  const name = await writeWithoutOverwriting(directory, stem, extension, bytes);

  return {
    url: `${UPLOAD_ASSET_PREFIX}${month}/${name}`,
    media,
    label: original.slice(0, original.length - extension.length).trim() || name,
  };
}

/**
 * Refuse an oversized upload by its headers, before anything reads it.
 *
 * This is registered in front of the admin guard on purpose. The guard finds
 * the CSRF token by parsing the form, and parsing a multipart form pulls the
 * whole file into the process — so by the time the request has been
 * authenticated, a gigabyte has already been read. Checking the declared
 * length first is the only place a body can be turned away before that
 * happens. It gives nothing away: that `/admin/uploads` exists is in the
 * package's own source.
 */
export const refuseOversizedUpload: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  if (c.req.method !== 'POST') return next();

  const declared = Number(c.req.header('content-length') ?? '');
  const limit = c.var.config.uploadMaxBytes;
  if (Number.isFinite(declared) && declared > limit + UPLOAD_ENVELOPE_BYTES) {
    // JSON for the editor's control, which reads it, and plain text for the
    // media screen's form, which is a navigation: a browser that has just
    // submitted a form and been shown a JSON object has been told nothing.
    // There is no session yet — the guard has not run — so a flash and a
    // redirect are not available here.
    return submittedFromABrowser(c.req.header('accept'))
      ? c.text(tooLargeMessage(limit), 413)
      : c.json({ error: tooLargeMessage(limit) }, 413);
  }

  await next();
};

/** Whether a request wants a page back rather than the editor's JSON. */
function submittedFromABrowser(accept: string | undefined): boolean {
  return (accept ?? '').includes('text/html');
}

/**
 * Register the editor's upload endpoint.
 *
 * A file goes to `content/uploads/{yyyy}/{mm}/{slug}{ext}`, which is where the
 * documented Eleventy config copies it through to `/uploads/` from, so the
 * Markdown this hands back resolves whether the site is being served by the
 * CMS or built as static files. Uploads are not documents: the index never
 * sees them, and `content/uploads` is one of the directories the sync skips.
 *
 * What may be uploaded, and what happens to it, is {@link storeUpload}; this
 * is that answer as the JSON the editor's upload control reads.
 */
export function mountUploads(app: Hono<GeekityEnv>): void {
  app.post(UPLOADS_PATH, async (c) => {
    const body = await c.req.parseBody();
    const outcome = await storeUpload(body[UPLOAD_FIELD], c.var.config);

    if (refusedUpload(outcome)) {
      return c.json({ error: outcome.error }, outcome.status);
    }

    const result: UploadResult = {
      url: outcome.url,
      markdown: uploadMarkdown({
        url: outcome.url,
        label: outcome.label,
        image: outcome.media.image,
      }),
    };
    return c.json(result, 201);
  });
}

/**
 * Write the bytes under the first name in the directory that is free.
 *
 * The exclusive flag is what makes "free" true rather than merely true a
 * moment ago: two uploads of `photo.png` racing each other both ask for the
 * same name, one of them gets `EEXIST`, and it moves on to `photo-2.png`
 * instead of overwriting what the other just wrote.
 */
async function writeWithoutOverwriting(
  directory: string,
  stem: string,
  extension: string,
  bytes: Uint8Array,
): Promise<string> {
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? `${stem}${extension}` : `${stem}-${String(suffix)}${extension}`;
    try {
      await writeFile(path.join(directory, name), bytes, { flag: 'wx' });
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** What {@link uploadMarkdown} writes a link for. */
export interface UploadMarkdownOptions {
  /** The public URL of the file. */
  url: string;
  /** What the link says: the submitted name without its extension. */
  label: string;
  /** Whether the Markdown is an embed rather than a link. */
  image: boolean;
}

/**
 * The Markdown for one upload: an embed for an image, a link for anything else.
 *
 * It is a function of its own because the editor's upload control is no longer
 * the only thing that offers it — the media screen hands out the same line for
 * a file uploaded months ago — and a picture that embedded from one screen and
 * linked from the other would be a difference nobody could explain.
 */
export function uploadMarkdown(options: UploadMarkdownOptions): string {
  const label = escapeLabel(options.label);
  return options.image ? `![${label}](${options.url})` : `[${label}](${options.url})`;
}

/** What an upload over the site's limit is told, and the limit it went over. */
export function tooLargeMessage(limit: number): string {
  return `That file is too big. This site accepts uploads up to ${String(limit)} bytes.`;
}

/**
 * The last segment of a submitted filename.
 *
 * A browser sends a bare name, but a request is not a browser: anything with a
 * path in it is reduced to its final component, so a name cannot be used to
 * choose a directory. Both separators are cut, because a Windows client sends
 * backslashes.
 */
function baseName(value: string): string {
  const segments = value.split(/[\\/]/);
  return segments[segments.length - 1] ?? '';
}

/** A `Content-Type` header without its parameters, lower case. */
function declaredType(value: string): string {
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

/** A filename as Markdown link text: the three characters that would break out. */
function escapeLabel(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1');
}
