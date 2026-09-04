import { respondWithObject } from '@fedify/fedify';
import { federation as federationMiddleware } from '@fedify/hono';
import type { Context, Hono, MiddlewareHandler } from 'hono';

import type { GeekityEnv } from '../env.ts';
import { publicDocumentAt } from '../web/documents.ts';
import { prefersActivityStreams } from '../web/negotiate.ts';
import { requestPath } from '../web/routes.ts';
import { isFederatedDocument, postArticle } from './article.ts';
import type { FederationContextData, SiteFederation } from './federation.ts';

/**
 * Put Fedify in front of the rest of the app.
 *
 * The middleware only answers the paths Fedify registered — the actor, its
 * collections, the post objects, WebFinger and NodeInfo; everything else falls
 * through to `next()` and reaches the admin and the public site as before.
 * That is why it is mounted first: the public site claims every unmatched path
 * in its not-found handler, so anything registered after it never sees a
 * request.
 *
 * A post permalink asked for as ActivityStreams is answered here too, by
 * {@link activityStreamsDocument}, because Fedify only knows about the URLs it
 * minted and a permalink is not one of them.
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
 * The `Article` for the post at this URL, when the request asked for
 * ActivityStreams and the URL is a published post's permalink.
 *
 * doc-4 wants a peer that dereferences a link somebody shared — which is the
 * permalink, not the object id — to land on the object rather than on a page
 * it cannot read. The article is built through the same
 * {@link postArticle} the object dispatcher uses, off a context Fedify makes
 * for this request, so the two answers cannot drift apart; its `id` is the
 * object URL either way, so a peer stores one object however it arrived.
 *
 * Anything else — a browser, a `.md` or `.json` request, a page, a listing —
 * gets `undefined` and falls through to the public site untouched.
 */
async function activityStreamsDocument(
  c: Context<GeekityEnv>,
  federation: SiteFederation,
): Promise<Response | undefined> {
  if (!prefersActivityStreams(c.req.header('accept'))) return undefined;

  const document = publicDocumentAt(c.var.store, requestPath(c));
  if (document === undefined || !isFederatedDocument(document, c.var.store.now())) {
    return undefined;
  }

  const context = federation.createContext(c.req.raw, contextData(c));
  return await respondWithObject(postArticle(context, document), {
    contextLoader: context.contextLoader,
  });
}

/** What the dispatchers are handed, off the Hono context. */
function contextData(c: Context<GeekityEnv>): FederationContextData {
  return { admin: c.var.admin, store: c.var.store, config: c.var.config };
}
