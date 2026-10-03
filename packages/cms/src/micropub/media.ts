import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Context, Hono } from 'hono';

import { resolveUpload } from '../admin/media.ts';
import { refusedUpload, storeUpload, UPLOAD_FIELD } from '../admin/uploads.ts';
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

interface LastUpload {
  url: string;
  published: string;
}

interface LastUploadsFile {
  last: Record<string, LastUpload | string>;
}

function lastUploadsFile(dataDir: string): string {
  return path.join(dataDir, LAST_UPLOADS_FILE);
}

/**
 * The user's last upload while it is still in the library: a file deleted
 * from the media screen since is no upload to offer.
 */
function readLastUpload(
  contentDir: string,
  dataDir: string,
  userId: number,
): LastUpload | undefined {
  const text = readFileIfPresentSync(lastUploadsFile(dataDir));
  if (text === undefined) return undefined;
  const recorded = (JSON.parse(text) as LastUploadsFile).last[String(userId)];
  if (recorded === undefined) return undefined;
  const url = typeof recorded === 'string' ? recorded : recorded.url;
  const file = resolveUpload(contentDir, url.slice(UPLOAD_ASSET_PREFIX.length));
  if (file === undefined || !existsSync(file)) return undefined;
  return typeof recorded === 'string'
    ? { url, published: statSync(file).mtime.toISOString() }
    : recorded;
}

async function recordLastUpload(
  dataDir: string,
  userId: number,
  upload: LastUpload,
): Promise<void> {
  await updateFileAtomically(lastUploadsFile(dataDir), (current) => {
    const uploads: LastUploadsFile =
      current === undefined ? { last: {} } : (JSON.parse(current) as LastUploadsFile);
    return `${JSON.stringify({ last: { ...uploads.last, [String(userId)]: upload } }, null, 2)}\n`;
  });
}

function invalidRequest(c: Context, description: string): Response {
  c.header('cache-control', 'no-store');
  return c.json({ error: 'invalid_request', error_description: description }, 400);
}

/**
 * The Micropub media endpoint (TASK-165). A `file` part is stored through
 * {@link storeUpload}, the media library's own rules and directory, so a
 * client's photo is a library file like any other with its variants derived
 * (decision-10). Every refusal is Micropub's 400 `invalid_request` rather
 * than the admin's 413 or 415. A create token may upload as well as a media
 * one, since a create can already carry a photo file part (TASK-238).
 * `q=source` answers the token's user's last upload as
 * `{ items: [{ url, published }] }`, which Quill offers as the photo of the
 * next note when it is under 15 minutes old; `q=last` answers it as `{ url }`,
 * the micropub-extensions query other clients ask.
 */
export function mountMicropubMedia(app: Hono<GeekityEnv>): void {
  app.post(
    MICROPUB_MEDIA_PATH,
    logMediaRequest,
    requireSiteToken(['create', 'media']),
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

      await recordLastUpload(config.dataDir, bearer.user.id, {
        url: stored.url,
        published: c.var.store.now().toISOString(),
      });
      c.header('cache-control', 'no-store');
      c.header('location', absoluteUrl(stored.url, siteBaseUrl(c)));
      return c.body(null, 201);
    },
  );

  app.get(MICROPUB_MEDIA_PATH, logMediaRequest, requireSiteToken(), (c) => {
    const q = c.req.query('q');
    if (q !== 'last' && q !== 'source') {
      return invalidRequest(
        c,
        q === undefined || q === ''
          ? 'A q parameter is required.'
          : `This endpoint does not answer q=${q}.`,
      );
    }
    const limit = c.req.query('limit');
    if (q === 'source' && limit !== undefined && !/^\d+$/.test(limit)) {
      return invalidRequest(c, `limit is a whole number, not ${limit}.`);
    }
    const { config, bearer } = c.var;
    const upload = readLastUpload(config.contentDir, config.dataDir, bearer.user.id);
    const item =
      upload === undefined
        ? undefined
        : { url: absoluteUrl(upload.url, siteBaseUrl(c)), published: upload.published };
    c.header('cache-control', 'no-store');
    if (q === 'last') return c.json(item === undefined ? {} : { url: item.url });
    return c.json({ items: item === undefined || Number(limit) === 0 ? [] : [item] });
  });
}
