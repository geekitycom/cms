import { respondWithObject } from '@fedify/fedify';
import { federation as federationMiddleware } from '@fedify/hono';
import type { Context, Hono, MiddlewareHandler } from 'hono';

import type { Document } from '../content/document.ts';
import type { GeekityEnv } from '../env.ts';
import { publicDocumentAt } from '../web/documents.ts';
import { absoluteUrl, prefersActivityStreams } from '../web/negotiate.ts';
import { requestPath } from '../web/routes.ts';
import { isFederatedDocument, postArticle } from './article.ts';
import type { FederationContextData, SiteFederation } from './federation.ts';

/**
 * Put Fedify in front of the rest of the app.
 *
 * The middleware only answers the paths Fedify registered — the actor, its
 * collections, WebFinger and NodeInfo; everything else falls through to
 * `next()` and reaches the admin and the public site as before. That is why it
 * is mounted first: the public site claims every unmatched path in its
 * not-found handler, so anything registered after it never sees a request.
 *
 * A post's object is not one of Fedify's paths at all. decision-13 makes a
 * post's ActivityStreams id its permalink, so {@link activityStreamsDocument}
 * is what serves the `Article`: one URL, answering a browser with the page and
 * a peer with the object. The same handler answers at the `activitypub.id` a
 * migrated post's file names, and sends a browser from there to the permalink.
 *
 * The dispatchers are handed the stores off the Hono context rather than
 * closing over them, so one federation object could serve more than one CMS
 * and so a dispatcher is never reading a store the request did not come with.
 */
export function mountFederation(app: Hono<GeekityEnv>, federation: SiteFederation): void {
  // `@fedify/hono` types its context as the two properties it actually reads,
  // which is looser than Hono's own; the cast is what puts `c.var` back.
  app.use(
    '*',
    federationMiddleware(federation, (context) => {
      const c = context as unknown as Context<GeekityEnv>;
      return contextData(c);
    }),
  );

  // Named, and typed as a middleware, so the Hono context arrives with its
  // path parameters resolved rather than as `any`.
  const activityStreams: MiddlewareHandler<GeekityEnv> = async (c, next) => {
    const response = await activityStreamsDocument(c, federation);
    if (response !== undefined) return response;
    await next();
  };

  app.use('*', activityStreams);
}

/**
 * The post this request is about, when it is about one: the `Article` for a
 * peer, a redirect to the permalink for a browser at a stored id, and
 * `undefined` for everything else.
 *
 * Two URLs can name a post. Its permalink always does — that is the whole of
 * decision-13, and a peer that dereferences a link somebody shared lands on
 * the object rather than on a page it cannot read. The other is the
 * `activitypub.id` a migrated post's file carries: the name its followers,
 * its replies and its RSS subscribers already hold, which has to keep
 * answering or every copy out there points at nothing. A browser that follows
 * one of those old links is sent on to the permalink, because that is the URL
 * a person should end up at.
 *
 * Anything else — a browser at a permalink, a `.md` or `.json` request, a
 * page, a listing — gets `undefined` and falls through to the public site
 * untouched.
 */
async function activityStreamsDocument(
  c: Context<GeekityEnv>,
  federation: SiteFederation,
): Promise<Response | undefined> {
  const wantsObject = prefersActivityStreams(c.req.header('accept'));

  if (wantsObject) {
    const atPermalink = publicDocumentAt(c.var.store, requestPath(c));
    if (atPermalink !== undefined && isFederatedDocument(atPermalink, c.var.store.now())) {
      return await article(c, federation, atPermalink);
    }
  }

  const stored = storedObjectAt(c);
  if (stored === undefined) return undefined;
  if (!wantsObject) return c.redirect(stored.permalink, 301);
  return await article(c, federation, stored);
}

/**
 * The post whose `activitypub.id` is the URL this request asks for, or
 * `undefined`.
 *
 * The candidate is built the way the ids themselves are — the request's path
 * and query on the site's base URL — rather than taken from `request.url`,
 * which behind a proxy is the internal address. A post whose stored id is its
 * permalink is not one of these: the permalink lookup has already answered for
 * it, and answering again here would only invite a redirect to itself.
 */
function storedObjectAt(c: Context<GeekityEnv>): Document | undefined {
  const { search } = new URL(c.req.url);
  const candidate = `${absoluteUrl(requestPath(c), c.var.config.baseUrl)}${search}`;

  const document = c.var.store.getByStoredObjectId(candidate);
  if (document === undefined || document.type !== 'post') return undefined;
  if (absoluteUrl(document.permalink, c.var.config.baseUrl) === candidate) return undefined;
  return document;
}

/**
 * One post as the ActivityStreams response a peer asked for.
 *
 * The article is built through the same {@link postArticle} the outbox uses,
 * off a context Fedify makes for this request, so the object a peer fetches
 * and the one it is delivered cannot drift apart.
 */
async function article(
  c: Context<GeekityEnv>,
  federation: SiteFederation,
  document: Document,
): Promise<Response> {
  const context = federation.createContext(c.req.raw, contextData(c));
  return await respondWithObject(postArticle(context, document), {
    contextLoader: context.contextLoader,
  });
}

/** What the dispatchers are handed, off the Hono context. */
function contextData(c: Context<GeekityEnv>): FederationContextData {
  return { admin: c.var.admin, store: c.var.store, config: c.var.config };
}
