import { respondWithObject } from '@fedify/fedify';
import { federation as federationMiddleware } from '@fedify/hono';
import type { Context, Hono, MiddlewareHandler } from 'hono';

import { listUsers } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import type { Document } from '../content/document.ts';
import type { GeekityEnv } from '../env.ts';
import { authorHref, parseAuthorPath } from '../web/authors.ts';
import { publicDocumentAt } from '../web/documents.ts';
import { absoluteUrl, prefersActivityStreams } from '../web/negotiate.ts';
import { requestPath } from '../web/routes.ts';
import { actorAliases, actorId } from './actor.ts';
import { isFederatedDocument, postArticle } from './article.ts';
import type { FederationContextData, SiteFederation } from './federation.ts';
import { federationOrigin, handleHref } from './paths.ts';

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
  // WebFinger is ours rather than Fedify's, and so has to be registered before
  // the middleware that would otherwise answer it. Fedify hard-codes the
  // `self` link to the dispatcher path and computes `aliases` from the
  // resource, neither of which can be added to, so an actor served under the
  // id it had elsewhere could never be discovered by it (doc-8). Owning the
  // route is a dozen lines and gives complete control of `subject`, `aliases`
  // and `links`.
  app.get(WEBFINGER_PATH, (c) => {
    const resource = c.req.query('resource') ?? '';
    const user = webFingerSubject(c, resource);
    if (user === undefined) return c.notFound();

    const context = federation.createContext(c.req.raw, contextData(c));
    const { baseUrl } = c.var.config;
    const aliases = actorAliases(context, user, baseUrl);

    return c.json(
      {
        subject: acctOf(user.username, c.var.config.baseUrl),
        aliases: aliases.map((alias) => alias.href),
        links: [
          {
            rel: 'self',
            type: 'application/activity+json',
            href: actorId(context, user).href,
          },
          {
            rel: 'http://webfinger.net/rel/profile-page',
            type: 'text/html',
            href: absoluteUrl(authorHref(user.username), baseUrl),
          },
        ],
      },
      200,
      {
        // The media type RFC 7033 defines, and the header that lets a browser
        // application read the answer, which is what every other WebFinger
        // server sends.
        'content-type': 'application/jrd+json; charset=utf-8',
        'access-control-allow-origin': '*',
      },
    );
  });

  // `/@ada`, the short URL WordPress publishes beside the author archive and
  // the one a person is most likely to type. It is an alias rather than a
  // second identity, so it goes where the identity is.
  app.get('/:handle{@.+}', (c) => {
    // The pattern is a regex rather than `/@:username`, because Hono's path
    // parameters are whole segments: the `@` has to be matched inside one.
    const handle = c.req.param('handle') ?? '';
    return c.redirect(authorHref(decodeURIComponent(handle.slice(1))), 301);
  });

  // `@fedify/hono` types its context as the two properties it actually reads,
  // which is looser than Hono's own; the cast is what puts `c.var` back.
  const fedify = federationMiddleware(federation, (context) => {
    const c = context as unknown as Context<GeekityEnv>;
    return contextData(c);
  }) as MiddlewareHandler<GeekityEnv>;

  // The one path where Fedify and the public site both have a claim: a user's
  // author archive is their actor id (decision-14), and Fedify answers a bare
  // `Accept: application/json` as an ActivityStreams request while doc-3 gives
  // that spelling the listing's own JSON. The CMS's rule decides, so a peer
  // asking for `activity+json` or `ld+json` gets the actor and everything else
  // — a browser, a reader, a feed tool — reaches the archive it asked for.
  // Every other Fedify path is left exactly as it was.
  const federationGate: MiddlewareHandler<GeekityEnv> = async (c, next) => {
    const isArchive = parseAuthorPath(requestPath(c)) !== undefined;
    if (isArchive && !prefersActivityStreams(c.req.header('accept'))) return await next();
    return await fedify(c, next);
  };

  app.use('*', federationGate);

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

/** Where WebFinger lives, which is defined on the host rather than under a site. */
export const WEBFINGER_PATH = '/.well-known/webfinger';

/** `acct:{username}@{host}`, the handle a person types into a search box. */
export function acctOf(username: string, baseUrl: string): string {
  return `acct:${username}@${federationOrigin(baseUrl === '' ? 'http://localhost' : baseUrl).handleHost}`;
}

/**
 * The user a WebFinger `resource` asks about, or `undefined` for one this site
 * answers for nobody.
 *
 * Four spellings resolve, and they are the same four decision-14 lists as a
 * user's aliases: the `acct:` handle, the actor id, the author archive and
 * `/@{username}`. Matching every one of them is what lets a peer that holds
 * any one URL for this person find the others — which is the whole job of
 * WebFinger, and what TASK-69's stored id will lean on when it joins the list.
 */
export function webFingerSubject(c: Context<GeekityEnv>, resource: string): User | undefined {
  const wanted = resource.trim();
  if (wanted === '') return undefined;

  const { baseUrl } = c.var.config;
  return listUsers(c.var.config.dataDir).find((user) => {
    if (wanted === acctOf(user.username, baseUrl)) return true;
    // A bare `user@host` is not what RFC 7033 asks for, but it is what enough
    // clients send that refusing it would only look like a missing account.
    if (wanted === acctOf(user.username, baseUrl).slice('acct:'.length)) return true;
    return (
      wanted === absoluteUrl(authorHref(user.username), baseUrl) ||
      wanted === absoluteUrl(handleHref(user.username), baseUrl)
    );
  });
}

/** What the dispatchers are handed, off the Hono context. */
function contextData(c: Context<GeekityEnv>): FederationContextData {
  return { admin: c.var.admin, store: c.var.store, config: c.var.config };
}
