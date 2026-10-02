import { existsSync } from 'node:fs';
import path from 'node:path';

import type { Context, Hono, MiddlewareHandler } from 'hono';

import { resolveUpload } from '../admin/media.ts';
import {
  largestUploadLimit,
  refusedUpload,
  storeUpload,
  tooLargeMessage,
  UPLOAD_ENVELOPE_BYTES,
  UPLOAD_FIELD,
} from '../admin/uploads.ts';
import type { GeekityEnv } from '../env.ts';
import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { logMediaRequest } from '../indieauth/activity-log.ts';
import type { BearerEnv } from '../indieauth/bearer.ts';
import { MICROPUB_MEDIA_PATH, siteBaseUrl } from '../indieauth/discovery.ts';
import { UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { requireSiteToken } from './endpoint.ts';

/** Each user's most recent upload, relative to `dataDir`. */
export const LAST_UPLOADS_FILE = 'micropub-media.json';

/** The file's shape: a user id to the site path of their last upload, `/uploads/…`. */
interface LastUploads {
  last: Record<string, string>;
}

function lastUploadsFile(dataDir: string): string {
  return path.join(dataDir, LAST_UPLOADS_FILE);
}

function readLastUploads(dataDir: string): LastUploads {
  const text = readFileIfPresentSync(lastUploadsFile(dataDir));
  return text === undefined ? { last: {} } : (JSON.parse(text) as LastUploads);
}

async function recordLastUpload(dataDir: string, userId: number, url: string): Promise<void> {
  await updateFileAtomically(lastUploadsFile(dataDir), (current) => {
    const uploads: LastUploads =
      current === undefined ? { last: {} } : (JSON.parse(current) as LastUploads);
    return `${JSON.stringify({ last: { ...uploads.last, [String(userId)]: url } }, null, 2)}\n`;
  });
}

/**
 * The user's last upload while it is still in the library: a file deleted
 * from the media screen since is no upload to offer.
 */
function lastUpload(contentDir: string, dataDir: string, userId: number): string | undefined {
  const url = readLastUploads(dataDir).last[String(userId)];
  if (url === undefined) return undefined;
  const file = resolveUpload(contentDir, url.slice(UPLOAD_ASSET_PREFIX.length));
  return file !== undefined && existsSync(file) ? url : undefined;
}

function invalidRequest(c: Context, description: string): Response {
  c.header('cache-control', 'no-store');
  return c.json({ error: 'invalid_request', error_description: description }, 400);
}

/**
 * Refuse a body whose declared length is over the upload limit before anything
 * reads it. It runs ahead of the bearer guard because the guard parses a form
 * body for an `access_token`, which reads the whole file, as the admin's
 * `refuseOversizedUpload` explains.
 */
const refuseOversizedMedia: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  const declared = Number(c.req.header('content-length') ?? '');
  const limit = largestUploadLimit(c.var.config);
  if (Number.isFinite(declared) && declared > limit + UPLOAD_ENVELOPE_BYTES) {
    return invalidRequest(c, tooLargeMessage(limit));
  }
  await next();
};

/**
 * The Micropub media endpoint (TASK-165). A `file` part is stored through
 * {@link storeUpload}, the media library's own rules and directory, so a
 * client's photo is a library file like any other with its variants derived
 * (decision-10). Every refusal is Micropub's 400 `invalid_request` rather
 * than the admin's 413 or 415. `q=last` answers the token's user's last
 * upload, which Quill and other clients offer as the photo of the next post.
 */
export function mountMicropubMedia(app: Hono<GeekityEnv>): void {
  app.post(
    MICROPUB_MEDIA_PATH,
    logMediaRequest,
    refuseOversizedMedia,
    requireSiteToken('media'),
    async (c: Context<BearerEnv>) => {
      const { config, bearer } = c.var;
      let body: Record<string, unknown>;
      try {
        body = await c.req.parseBody();
      } catch {
        return invalidRequest(c, 'An upload is a multipart/form-data body with a file part.');
      }
      const stored = await storeUpload(body[UPLOAD_FIELD], config);
      if (refusedUpload(stored)) return invalidRequest(c, stored.error);

      await recordLastUpload(config.dataDir, bearer.user.id, stored.url);
      c.header('cache-control', 'no-store');
      c.header('location', absoluteUrl(stored.url, siteBaseUrl(c)));
      return c.body(null, 201);
    },
  );

  app.get(MICROPUB_MEDIA_PATH, logMediaRequest, requireSiteToken(), (c) => {
    const q = c.req.query('q');
    if (q !== 'last') {
      return invalidRequest(
        c,
        q === undefined || q === ''
          ? 'A q parameter is required.'
          : `This endpoint does not answer q=${q}.`,
      );
    }
    const { config, bearer } = c.var;
    const url = lastUpload(config.contentDir, config.dataDir, bearer.user.id);
    c.header('cache-control', 'no-store');
    return c.json(url === undefined ? {} : { url: absoluteUrl(url, siteBaseUrl(c)) });
  });
}
