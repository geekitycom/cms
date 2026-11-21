import type { Context, Hono } from 'hono';

import type { Document } from '../content/document.ts';
import { publicDocumentAt } from '../content/permalinks.ts';
import {
  WEBMENTION_FIELDS,
  WEBMENTION_MAX_BYTES,
  WEBMENTION_PATH,
} from '../webmention/endpoint.ts';
import { checkWebmentionRequest } from '../webmention/receive.ts';
import type { ReceivedWebmention } from '../webmention/service.ts';
import { postSyndicatedAt, syndicationCopies } from '../webmention/syndication.ts';
import type { SyndicationCopies } from '../webmention/syndication.ts';
import { messageOf } from '../util/errors.ts';
import { readBounded } from './bounded-body.ts';
import type { GeekityEnv } from './env.ts';
import { addressKey, clientAddress, createRequestLimit } from './throttle.ts';
import type { RequestLimit } from './throttle.ts';

const BUSY_RETRY_AFTER_SECONDS = 300;

/** How many webmentions and pingbacks one address may send in a window, unless the config says. */
const SENDER_LIMIT = { requests: 60, windowSeconds: 600 } as const;

/**
 * Counts one request against the address it came from, and answers how many
 * seconds that address must wait, or `undefined` when it may go on.
 */
export type SenderLimit = (c: Context<GeekityEnv>) => number | undefined;

/** One {@link SenderLimit} for both endpoints, built on first use from the config. */
export function senderLimit(): SenderLimit {
  let limit: RequestLimit | undefined;
  return (c) => {
    const { config } = c.var;
    const address = clientAddress(c, config);
    if (address === undefined) return undefined;
    limit ??= createRequestLimit({
      ...(config.webmentions.rateLimit ?? SENDER_LIMIT),
      now: config.now,
    });
    return limit.take(addressKey(address));
  };
}

/** The public post that a recorded syndicated copy URL is a copy of. */
export type SyndicatedAt = (c: Context<GeekityEnv>, url: string) => Document | undefined;

/** A {@link SyndicatedAt} that reads the copies file on first use and keeps the reader. */
export function syndicatedAtLookup(): SyndicatedAt {
  let copies: SyndicationCopies | undefined;
  return (c, url) =>
    postSyndicatedAt(url, c.var.store, (copies ??= syndicationCopies(c.var.config.contentDir)));
}

/**
 * Register the webmention endpoint. Mounted by the public site.
 *
 * The answer is a 202 for anything worth going and looking at and a 400 for
 * anything that is not, and the looking happens afterwards — see
 * `webmention/receive.ts` for why that split is the whole design.
 */
export function mountWebmentions(
  app: Hono<GeekityEnv>,
  syndicatedAt: SyndicatedAt,
  limit: SenderLimit,
): void {
  app.post(WEBMENTION_PATH, async (c) => {
    const { store, config, webmentions, conversation } = c.var;

    if (!c.var.siteAtRequestStart.webmentions_receive) {
      // A 404 rather than a 403: a site that does not take webmentions has no
      // endpoint, and that is what having no endpoint looks like.
      return c.text('This site does not take webmentions.', 404);
    }

    const wait = limit(c);
    if (wait !== undefined) {
      c.header('retry-after', String(wait));
      return c.text('Too many webmentions from this address. Send it again later.', 429);
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
        syndicatedAt: (url) => syndicatedAt(c, url),
        conversation,
        site: c.var.siteAtRequestStart,
      },
    );

    if (!checked.ok) return c.text(checked.message, 400);

    let received: ReceivedWebmention;
    try {
      received = await webmentions.receive({
        source: checked.source,
        target: checked.target,
        address: clientAddress(c, config),
        userAgent: c.req.header('user-agent'),
        referrer: c.req.header('referer'),
      });
    } catch (thrown) {
      console.warn(`A webmention from ${checked.source} was not recorded: ${messageOf(thrown)}`);
      return c.text('The webmention could not be recorded. Send it again later.', 503);
    }
    if (received.busy) {
      c.header('retry-after', String(BUSY_RETRY_AFTER_SECONDS));
      return c.text('Too many webmentions are waiting to be checked. Send it again later.', 503);
    }

    return c.text('Accepted. The source will be checked shortly.', 202);
  });

  // A GET on the endpoint is somebody looking rather than sending, and saying
  // so is friendlier than a 404 on a URL that is really there.
  app.get(WEBMENTION_PATH, (c) => {
    c.header('allow', 'POST');
    return c.text('Send a webmention here with a POST carrying source and target.', 405);
  });
}
