import type { Hono } from 'hono';

import { publicDocumentAt } from '../content/permalinks.ts';
import {
  WEBMENTION_FIELDS,
  WEBMENTION_MAX_BYTES,
  WEBMENTION_PATH,
} from '../webmention/endpoint.ts';
import { checkWebmentionRequest } from '../webmention/receive.ts';
import { postSyndicatedAt, syndicationCopies } from '../webmention/syndication.ts';
import { readBounded } from './bounded-body.ts';
import type { GeekityEnv } from './env.ts';
import { clientAddress } from './throttle.ts';

/**
 * Register the webmention endpoint. Mounted by the public site.
 *
 * The answer is a 202 for anything worth going and looking at and a 400 for
 * anything that is not, and the looking happens afterwards — see
 * `webmention/receive.ts` for why that split is the whole design.
 */
export function mountWebmentions(app: Hono<GeekityEnv>): void {
  app.post(WEBMENTION_PATH, async (c) => {
    const { store, config, webmentions, conversation } = c.var;

    if (!c.var.siteAtRequestStart.webmentions_receive) {
      // A 404 rather than a 403: a site that does not take webmentions has no
      // endpoint, and that is what having no endpoint looks like.
      return c.text('This site does not take webmentions.', 404);
    }

    const mediaType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/x-www-form-urlencoded') {
      return c.text('Send source and target as an application/x-www-form-urlencoded form.', 400);
    }
    const text = await readBounded(c.req.raw, WEBMENTION_MAX_BYTES);
    if (text === undefined) return c.text('The request is too large.', 413);

    const form = new URLSearchParams(text);
    const checked = checkWebmentionRequest(
      form.get(WEBMENTION_FIELDS.source) ?? '',
      form.get(WEBMENTION_FIELDS.target) ?? '',
      {
        baseUrl: config.baseUrl,
        documentAt: (pathname) => publicDocumentAt(store, pathname),
        syndicatedAt: (url) => postSyndicatedAt(url, store, syndicationCopies(config.contentDir)),
        conversation,
        site: c.var.siteAtRequestStart,
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
