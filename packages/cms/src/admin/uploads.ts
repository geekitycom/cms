import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Hono, MiddlewareHandler } from 'hono';

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
    return tooLarge(c, limit);
  }

  await next();
};

/**
 * Register the editor's upload endpoint.
 *
 * A file goes to `content/uploads/{yyyy}/{mm}/{slug}{ext}`, which is where the
 * documented Eleventy config copies it through to `/uploads/` from, so the
 * Markdown this hands back resolves whether the site is being served by the
 * CMS or built as static files. Uploads are not documents: the index never
 * sees them, and `content/uploads` is one of the directories the sync skips.
 *
 * Three things have to agree before anything is written — the extension is on
 * the site's allowlist, the media type the browser declared is one that
 * extension is allowed to have, and the file's first bytes are that format's.
 * A name is never overwritten; a second `photo.png` becomes `photo-2.png`.
 */
export function mountUploads(app: Hono<GeekityEnv>): void {
  app.post(UPLOADS_PATH, async (c) => {
    const body = await c.req.parseBody();
    const file = body[UPLOAD_FIELD];

    if (!(file instanceof File)) {
      return c.json({ error: 'That upload carried no file.' }, 400);
    }

    const config = c.var.config;
    const original = baseName(file.name);
    const extension = path.extname(original).toLowerCase();

    if (!config.uploadTypes.includes(extension)) {
      const allowed = config.uploadTypes.join(', ');
      return c.json(
        {
          error:
            extension === ''
              ? `That file has no extension, so there is no telling what it is. This site accepts ${allowed}.`
              : `Uploads of ${extension} are not allowed here. This site accepts ${allowed}.`,
        },
        415,
      );
    }

    // Guaranteed by resolveConfig, which refuses an allowlist naming anything
    // the table has no entry for.
    const media = UPLOAD_MEDIA_TYPES.get(extension) as UploadMediaType;

    const declared = declaredType(file.type);
    if (declared !== '' && !media.declared.includes(declared)) {
      return c.json(
        {
          error: `That file says it is ${declared}, which is not what a ${extension} is.`,
        },
        415,
      );
    }

    if (file.size > config.uploadMaxBytes) {
      return tooLarge(c, config.uploadMaxBytes);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesSignature(media, bytes)) {
      return c.json({ error: `That file does not look like a ${extension} inside.` }, 415);
    }

    const now = new Date();
    const month = `${String(now.getUTCFullYear()).padStart(4, '0')}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const directory = path.join(config.contentDir, UPLOAD_DIRECTORY, ...month.split('/'));
    await mkdir(directory, { recursive: true });

    const stem = slugify(original.slice(0, original.length - extension.length)) || 'upload';
    const name = await writeWithoutOverwriting(directory, stem, extension, bytes);

    const url = `${UPLOAD_ASSET_PREFIX}${month}/${name}`;
    const label = original.slice(0, original.length - extension.length).trim() || name;

    const result: UploadResult = {
      url,
      markdown: media.image
        ? `![${escapeLabel(label)}](${url})`
        : `[${escapeLabel(label)}](${url})`,
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

/** The 413 an oversized upload gets, and the limit it went over. */
function tooLarge(c: { json: JsonResponder }, limit: number): Response {
  return c.json(
    { error: `That file is too big. This site accepts uploads up to ${String(limit)} bytes.` },
    413,
  );
}

/** Just enough of Hono's context to answer with JSON. */
type JsonResponder = (body: { error: string }, status: 413) => Response;

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
