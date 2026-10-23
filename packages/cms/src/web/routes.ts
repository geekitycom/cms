import type { Context, Hono, MiddlewareHandler } from 'hono';

import { mountAvatars } from './avatar-routes.ts';
import { mountFonts } from './font-routes.ts';
import { mountComments } from './comment-routes.ts';
import { mountContact } from './contact-routes.ts';
import { COMMENT_PAGE_PREFIX } from '../content/guids.ts';
import { findPathRedirect, findQueryRedirect, redirectLocation } from '../content/redirects.ts';
import { UPLOAD_ASSET_PREFIX, VARIANT_ASSET_PREFIX } from '../content/uploads.ts';
import type { GeekityEnv } from './env.ts';
import { iconSetting } from '../images/icons.ts';
import { advertiseIdentityEndpoints } from './indieauth-discovery.ts';
import { mountNotificationLinks } from './notification-routes.ts';
import { robotsPolicyOf } from '../site/settings.ts';
import { mountPingbacks } from './pingback-routes.ts';
import { mountWebmentions } from './webmention-routes.ts';
import { favicon, imageVariant, themeAsset, upload } from './asset-routes.ts';
import { THEME_ASSET_PREFIX } from '../theme/assets.ts';
import { negotiateDocument } from './document-page.ts';
import { goneDocumentAt, previewDocumentAt } from '../content/permalinks.ts';
import { embedView, oEmbed } from './embed.ts';
import { commentPage, comments, feed, repliesFeed } from './feed-routes.ts';
import { feedPathUnder, FEED_FORMATS, REPLIES_ROOT, splitFeedPath } from './feeds.ts';
import { indexNowKeyPath, indexNowKeyResponse } from '../site/indexnow-key.ts';
import { listing, search } from './listing-pages.ts';
import { feedHref, SITE_POSTS } from './listing-subject.ts';
import { LLMS_TXT_LINK, LLMS_TXT_PATH } from './llms.ts';
import { FAVICON_PATH, manifestResponse, MANIFEST_PATH, webManifest } from './manifest.ts';
import {
  DOCUMENT_REPRESENTATIONS,
  LISTING_REPRESENTATIONS,
  representationHref,
  splitRepresentationExtension,
} from './negotiate.ts';
import { EMBED_PATH, OEMBED_PATH } from './oembed.ts';
import { openSearchDescription, openSearchResponse, OPENSEARCH_PATH } from './opensearch.ts';
import {
  canonicalHref,
  classifyPath,
  commentsFeedHref,
  movedHref,
  parseTermPath,
  slashedHref,
} from './paths.ts';
import type { PathMatch } from './paths.ts';
import {
  conditionalHeaders,
  encodePath,
  queryFeedFormat,
  requestPath,
  requestSearch,
  selectFromAccept,
} from './request.ts';
import { gone, notFound } from './status-pages.ts';
import { robotsResponse, ROBOTS_PATH } from './robots.ts';
import { SEARCH_PATH } from './search.ts';
import { llmsTxt, sitemap } from './site-index.ts';
import { siteView } from './site-view.ts';
import type { SiteView } from './site-view.ts';
import { SITEMAP_CHILD_ROUTE, SITEMAP_PATH } from './sitemap.ts';
import { redirectedTerm, termHref } from '../content/taxonomy.ts';
import type { TaxonomyTerm } from '../content/taxonomy.ts';

/**
 * Register the public site on a Hono app.
 *
 * The listings and the theme assets are routes; a document is resolved in the
 * not-found handler instead. That ordering is deliberate: admin and federation
 * routes registered after this one still win, and a permalink can never shadow
 * them, because the document lookup only runs once nothing else has matched.
 */
export function mountPublicSite(
  app: Hono<GeekityEnv>,
  {
    adminBar,
    pageTags,
  }: { adminBar?: MiddlewareHandler<GeekityEnv>; pageTags?: MiddlewareHandler<GeekityEnv> } = {},
): void {
  if (adminBar !== undefined) app.use('*', adminBar);
  if (pageTags !== undefined) app.use('*', pageTags);
  app.use('*', advertiseIdentityEndpoints);
  app.use('*', declaredQueryRedirect);

  app.get(`${THEME_ASSET_PREFIX}*`, themeAsset);
  // Derived images go on first: their prefix is inside the uploads one, so the
  // general route would otherwise swallow them and answer 404 for a file that
  // is not under `content/uploads/` at all.
  app.get(`${VARIANT_ASSET_PREFIX}*`, imageVariant);
  app.get(`${UPLOAD_ASSET_PREFIX}*`, upload);

  // Where the comment form under a post posts to (TASK-50). A POST at a fixed
  // path of the CMS's own, so no permalink can ever shadow it and the route
  // table does not grow with the site.
  mountComments(app);

  // And where a contact form's message is sent (TASK-56): the same prefix
  // again, so the page a form is on can be permalinked anywhere.
  mountContact(app);

  // And where a webmention is sent (TASK-51), for the same reason and under
  // the same prefix.
  mountWebmentions(app);
  mountPingbacks(app);

  // And where the one-click links in a notification land (TASK-55): the same
  // prefix again, and no session behind either of them.
  mountNotificationLinks(app);

  // And where the avatars a conversation shows are served from (TASK-134):
  // the same prefix again, so a reader's browser fetches every face from here.
  mountAvatars(app);

  mountFonts(app);

  app.get('/', (c) => {
    // The site's latest posts, or the page the Reading setting names — the
    // whole of WordPress's "Your homepage displays", decided per request off
    // `site.json` so a save on the settings screen moves the front page on the
    // very next one.
    const home = siteView(c).pages.home;
    const response =
      home === undefined
        ? listing(c, { subject: SITE_POSTS, pageNumber: 0 })
        : negotiateDocument(c, home, selectFromAccept(c, DOCUMENT_REPRESENTATIONS));
    // The home page is where a tool that found the site looks for its index
    // (TASK-149): a header, so it is found without parsing the page.
    if (c.var.siteAtRequestStart.llms_txt) {
      response.headers.append('link', LLMS_TXT_LINK);
    }
    return response;
  });

  // The site's own feeds are routes rather than representations, so a reader's
  // careless `Accept` header cannot land it on the HTML (doc-3), and so a
  // document permalinked at `/feed/` cannot take the subscribers' URL. Their
  // paths are fixed — only the taxonomy feeds hang off a configurable base —
  // so the route table can hold them.
  for (const format of FEED_FORMATS) {
    app.get(feedPathUnder('/', format), (c) => feed(c, format, SITE_POSTS));
  }

  // The site-wide comments feed, for the same reason and at WordPress's URL.
  app.get(commentsFeedHref(undefined), (c) => comments(c, undefined));

  // A native comment's own page (TASK-318), at a fixed path so a permalink
  // cannot take it.
  app.get(`${COMMENT_PAGE_PREFIX}:id/`, (c) => commentPage(c, c.req.param('id')));
  app.get(`${COMMENT_PAGE_PREFIX}:id/index.md`, (c) =>
    commentPage(c, c.req.param('id'), 'markdown'),
  );
  app.get(`${COMMENT_PAGE_PREFIX}:id/index.gmi`, (c) =>
    commentPage(c, c.req.param('id'), 'gemini'),
  );

  // The feed of one item's direct replies (TASK-324), fixed for the same reason.
  app.get(`${REPLIES_ROOT}:segment/`, (c) => repliesFeed(c, c.req.param('segment')));

  // The sitemap, its children and the robots file: fixed paths at the root of
  // the site, which is the only place a crawler looks, and routes for the same
  // reason the feeds are — no document permalinked there can take the URL a
  // search engine polls.
  app.get(SITEMAP_PATH, (c) => sitemap(c, undefined));
  app.get(SITEMAP_CHILD_ROUTE, (c) => sitemap(c, Number(c.req.param('page'))));
  app.get(ROBOTS_PATH, (c) =>
    robotsResponse(
      c.var.config.baseUrl,
      conditionalHeaders(c),
      robotsPolicyOf(c.var.siteAtRequestStart),
    ),
  );

  // The web app manifest and the root favicon (TASK-147), fixed paths at the
  // root for the same reason: a browser asks for `/favicon.ico` whatever the
  // head links, and no permalink may take either URL.
  app.get(MANIFEST_PATH, (c) => {
    const site = c.var.renderer.site();
    const manifest = webManifest({
      config: c.var.config,
      title: site.title,
      iconSetting: iconSetting(site),
      colors: c.var.renderer.themeColors(),
      scheme: c.var.renderer.siteColors(),
    });
    return manifestResponse(manifest, conditionalHeaders(c));
  });
  app.get(FAVICON_PATH, favicon);

  // The OpenSearch description (TASK-204), a fixed path at the root for the
  // same reason, read off the site data per request so a new title or icon
  // shows on the next one.
  app.get(OPENSEARCH_PATH, (c) =>
    openSearchResponse(
      openSearchDescription({ config: c.var.config, site: c.var.renderer.site() }),
      conditionalHeaders(c),
    ),
  );

  // The oEmbed provider (TASK-205), under the CMS's own prefix like the
  // comment endpoint, so no permalink can take it.
  app.get(OEMBED_PATH, oEmbed);

  // The embed view the oEmbed html frames (TASK-208), beside it under the
  // same prefix: the one response another site may put in a frame.
  app.get(EMBED_PATH, embedView);

  // The index for language models (TASK-149), a fixed path at the root for
  // the same reason.
  app.get(LLMS_TXT_PATH, llmsTxt);

  // The IndexNow key file (TASK-151), at the root because that is where an
  // engine checks for it. Any other `.txt` path is not this route's: it falls
  // through to whatever document or 404 would have answered it.
  app.get('/:file{[A-Za-z0-9-]{8,128}\\.txt}', async (c, next) => {
    const settings = c.var.siteAtRequestStart;
    const key = settings.index_now_key;
    if (!settings.index_now || key === '' || c.req.path !== indexNowKeyPath(key)) {
      await next();
      return;
    }
    return indexNowKeyResponse(key);
  });

  // The site's search (TASK-22): a route at a fixed path for the reason the
  // feeds are, so the form in every theme's footer submits somewhere no
  // permalink can take. It negotiates like a listing, and `/search/index.md`,
  // `/search/index.gmi` and `/search/index.json` are the same escape hatches a
  // listing has. The path without its slash is where a hand-typed URL lands,
  // and keeps its query on the way to the real one.
  app.get(SEARCH_PATH, (c) => search(c, selectFromAccept(c, LISTING_REPRESENTATIONS)));
  for (const representation of ['markdown', 'gemini', 'json'] as const) {
    app.get(representationHref(SEARCH_PATH, representation), (c) => search(c, representation));
  }
  app.get(SEARCH_PATH.slice(0, -1), (c) => c.redirect(`${SEARCH_PATH}${requestSearch(c)}`, 301));

  // The archives and the home listing's pages are deliberately not routes. A
  // route table is fixed when the app is built, and the bases and the posts
  // page are settings, so a listing is resolved per request in the not-found
  // handler, from what the site holds at that moment (TASK-36).
  app.notFound(resolveRequest);
}

/**
 * A declared redirect whose source names a query, WordPress's `/?p=123` above
 * all (TASK-128). It is answered before any route because `/` is one the
 * not-found handler never sees, and it shadows nothing: no document is
 * addressed by a query.
 */
const declaredQueryRedirect: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') {
    const search = requestSearch(c);
    const redirect =
      search === ''
        ? undefined
        : findQueryRedirect(c.var.redirects.current(), requestPath(c), search);
    if (redirect !== undefined) return c.redirect(redirect.location, redirect.status);
  }
  await next();
};

function resolveRequest(c: Context<GeekityEnv>): Response {
  const view = siteView(c);
  const pathname = requestPath(c);
  const search = requestSearch(c);
  const here = encodePath(pathname);

  const match = classifyPath(view, pathname);
  if (match !== undefined) {
    const href = canonicalHref(view, match);
    if (href !== here || (match.kind === 'feed' && !match.canonical)) {
      return c.redirect(`${href}${search}`, 301);
    }
    return serve(c, match);
  }

  const hidden = hiddenDocumentForSignedInHtml(c, pathname);
  if (hidden !== undefined) return hidden;

  const extension = splitRepresentationExtension(pathname);
  if (extension !== undefined) {
    const { representation } = extension;
    for (const candidate of extension.paths) {
      const found = classifyPath(view, candidate);
      if (found === undefined || found.kind === 'feed') continue;
      if (found.kind === 'listing' && !LISTING_REPRESENTATIONS.includes(representation)) continue;

      const href = representationHref(canonicalHref(view, found), representation);
      if (href !== here) return c.redirect(`${href}${search}`, 301);
      return found.kind === 'listing'
        ? listing(c, found, representation)
        : negotiateDocument(c, found.document, representation);
    }
  }

  // Nothing lives here, so a URL something used to live at leads on to where
  // it lives now. Asked only after every live lookup, which is what lets a new
  // document take an old URL over, and a term that comes back into use beat
  // the record of what it was renamed to.
  const formerly =
    movedHref(view, pathname, undefined) ??
    extension?.paths
      .map((candidate) => movedHref(view, candidate, extension.representation))
      .find((href) => href !== undefined) ??
    renamedTermHref(c, view, pathname);
  if (formerly !== undefined) return c.redirect(`${formerly}${search}`, 301);

  const deleted = [pathname, ...(extension?.paths ?? [])].some(
    (candidate) => goneDocumentAt(view.store, candidate) !== undefined,
  );
  if (deleted) return gone(c);

  const slashed = slashedHref(view, pathname, c.var.renderer.pageSize());
  if (slashed !== undefined) return c.redirect(`${slashed}${search}`, 301);

  // And a URL the site itself says has moved (TASK-128), after every live
  // lookup and after the slash that would lead to one, so a declared source
  // never shadows a live document.
  const redirect = findPathRedirect(c.var.redirects.current(), pathname);
  if (redirect !== undefined) {
    return c.redirect(redirectLocation(redirect, search), redirect.status);
  }

  return notFound(c);
}

function serve(c: Context<GeekityEnv>, match: PathMatch): Response {
  switch (match.kind) {
    case 'listing':
      return listing(c, match);
    case 'feed':
      return match.target.kind === 'listing'
        ? feed(c, match.format, match.target.subject)
        : comments(c, match.target.document);
    case 'document':
      // WordPress answered `?feed=rss2` on a permalink with that document's
      // comments feed, which is the only feed a document has here too. The
      // other spellings name a format a comments feed does not come in, so
      // they are not a feed request at all and the page is served.
      if (queryFeedFormat(c) === 'rss') {
        return c.redirect(commentsFeedHref(match.document), 301);
      }
      return negotiateDocument(c, match.document, selectFromAccept(c, DOCUMENT_REPRESENTATIONS));
  }
}

function hiddenDocumentForSignedInHtml(
  c: Context<GeekityEnv>,
  pathname: string,
): Response | undefined {
  if (c.var.signedIn === undefined) return undefined;
  if (selectFromAccept(c, DOCUMENT_REPRESENTATIONS) !== 'html') return undefined;
  const hidden = previewDocumentAt(c.var.store, pathname);
  return hidden === undefined ? undefined : negotiateDocument(c, hidden, 'html');
}

/**
 * Where a renamed term's archive page or feed lives now, or `undefined` when
 * the path is neither or the site records no rename of its term.
 *
 * One hop: the list is stored with its chains already collapsed. A subscriber
 * to the old feed follows it to the new one, exactly as a reader of the archive
 * does.
 */
function renamedTermHref(
  c: Context<GeekityEnv>,
  view: SiteView,
  pathname: string,
): string | undefined {
  const feedPath = splitFeedPath(pathname);
  const asked = parseTermPath(view, feedPath?.root ?? pathname);
  if (asked === undefined || (feedPath !== undefined && asked.pageNumber !== 0)) return undefined;

  const to = redirectedTerm(c.var.renderer.termRedirects(), asked.term);
  if (to === undefined) return undefined;
  const moved: TaxonomyTerm = { taxonomy: asked.term.taxonomy, term: to };
  return feedPath === undefined
    ? termHref(moved, asked.pageNumber, view.bases)
    : feedHref(moved, feedPath.format, view.bases);
}
