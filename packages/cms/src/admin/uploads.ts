import type { Hono, MiddlewareHandler } from 'hono';

import type { GeekityEnv } from '../web/env.ts';
import {
  largestUploadLimit,
  refusedUpload,
  storeUpload,
  tooLargeMessage,
  UPLOAD_ENVELOPE_BYTES,
  UPLOAD_FIELD,
  uploadMarkdown,
} from '../media/uploads.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';

/** Where the editor posts a file it wants stored. */
export const UPLOADS_PATH = `${ADMIN_PREFIX}/uploads`;

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
  const limit = largestUploadLimit(c.var.config);
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
        image: outcome.media.kind === 'image',
      }),
    };
    return c.json(result, 201);
  });
}
