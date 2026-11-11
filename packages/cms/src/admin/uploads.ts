import type { Context, Hono } from 'hono';

import type { ResolvedConfig } from '../config.ts';
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

/** Where the editor, and every upload control in the admin, posts a file it wants stored. */
export const UPLOADS_PATH = `${ADMIN_PREFIX}/uploads`;

export const IMAGES_ONLY_FIELD = 'images';

/** What the editor gets back when a file has landed. */
export interface UploadResult {
  /** The public URL of the file, which the site serves straight away. */
  url: string;
  /** Markdown to paste at the cursor: an embed for an image, a link otherwise. */
  markdown: string;
}

export function uploadBodyLimit(config: ResolvedConfig): number {
  return largestUploadLimit(config) + UPLOAD_ENVELOPE_BYTES;
}

export function uploadTooLarge(c: Context<GeekityEnv>): Response {
  const message = tooLargeMessage(largestUploadLimit(c.var.config));
  return submittedFromABrowser(c.req.header('accept'))
    ? c.text(message, 413)
    : c.json({ error: message }, 413);
}

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
    const outcome = await storeUpload(body[UPLOAD_FIELD], c.var.config, {
      imagesOnly: body[IMAGES_ONLY_FIELD] === '1',
    });

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
