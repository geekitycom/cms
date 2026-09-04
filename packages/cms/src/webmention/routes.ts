import type { Hono } from 'hono';

import { readSiteSettings } from '../admin/settings.ts';
import { clientAddress } from '../admin/throttle.ts';
import type { GeekityEnv } from '../env.ts';
import { publicDocumentAt } from '../web/documents.ts';
import { checkWebmentionRequest } from './receive.ts';

/**
 * The one public endpoint webmentions add.
 *
 * A single path under `/_geekity/`, like the comment form's, so it is out of
 * the way of every permalink a site might ever mint and the route table does
 * not grow with the site. It is what the `Link` header and the `<link>` in
 * every post's head point at, and it takes nothing but a form with a `source`
 * and a `target` in it.
 */

/** Where a webmention is sent. */
export const WEBMENTION_PATH = '/_geekity/webmention';

/** The fields a webmention carries, which the spec fixes. */
export const WEBMENTION_FIELDS = { source: 'source', target: 'target' } as const;

/**
 * The endpoint a page should advertise, or `undefined` when the site is not
 * taking webmentions.
 *
 * Read off the site data the renderer already has rather than the settings, so
 * a template asks one question and gets the same answer the endpoint gives.
 * A file that does not mention the setting is a site that takes them: that is
 * the default, and an older `site.json` should not quietly stop.
 */
export function webmentionEndpointFor(site: Record<string, unknown>): string | undefined {
  return site['webmentionsReceive'] === false ? undefined : WEBMENTION_PATH;
}

/**
 * Register the webmention endpoint. Mounted by the public site.
 *
 * The answer is a 202 for anything worth going and looking at and a 400 for
 * anything that is not, and the looking happens afterwards — see
 * `receive.ts` for why that split is the whole design.
 */
export function mountWebmentions(app: Hono<GeekityEnv>): void {
  app.post(WEBMENTION_PATH, async (c) => {
    const { store, config, webmentions } = c.var;

    if (!readSiteSettings(config.contentDir).webmentionsReceive) {
      // A 404 rather than a 403: a site that does not take webmentions has no
      // endpoint, and that is what having no endpoint looks like.
      return c.text('This site does not take webmentions.', 404);
    }

    const body = await c.req.parseBody();
    const checked = checkWebmentionRequest(
      text(body[WEBMENTION_FIELDS.source]),
      text(body[WEBMENTION_FIELDS.target]),
      {
        baseUrl: config.baseUrl,
        documentAt: (pathname) => publicDocumentAt(store, pathname),
      },
    );

    if (!checked.ok) return c.text(checked.message, 400);

    // Nothing waits for the check: the sender is answered now and the source
    // is fetched afterwards, and `receive` never rejects.
    void webmentions.receive({
      source: checked.source,
      target: checked.target,
      document: checked.document,
      address: clientAddress(c, config),
      userAgent: c.req.header('user-agent'),
      referrer: c.req.header('referer'),
    });

    return c.text('Accepted. The source will be checked shortly.', 202);
  });

  // A GET on the endpoint is somebody looking rather than sending, and saying
  // so is friendlier than a 404 on a URL that is really there.
  app.get(WEBMENTION_PATH, (c) => {
    c.header('allow', 'POST');
    return c.text('Send a webmention here with a POST carrying source and target.', 405);
  });
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
