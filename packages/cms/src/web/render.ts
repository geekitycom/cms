import type { Environment } from 'nunjucks';

import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import {
  createSiteDataSource,
  documentContext,
  postsPerPage,
  taxonomyBases,
  termRedirects,
} from './context.ts';
import type { CommentFormContext } from '../comments/form.ts';
import type { Conversation } from './conversation.ts';
import { activityStreamsId } from './documents.ts';
import { commentsFeedPath } from './feeds.ts';
import type { DocumentContext, SiteData } from './context.ts';
import { navigationMenu } from './navigation.ts';
import type { Pagination } from './pagination.ts';
import type { TaxonomyBases, TaxonomyRedirect } from './taxonomy.ts';
import { createTemplateEnvironment } from './templates.ts';

/** Templates the default theme ships and the public routes ask for by name. */
export const TEMPLATES = {
  home: 'layouts/home.njk',
  post: 'layouts/post.njk',
  page: 'layouts/page.njk',
  tag: 'layouts/tag.njk',
  category: 'layouts/category.njk',
  notFound: 'layouts/404.njk',
} as const;

/** A listing of documents, ready to render. */
export interface Listing {
  /** Heading for the page, and the basis of its `<title>`. */
  title: string;
  /** The listing's own URL, for `page.url`. */
  url: string;
  /** The documents on this page of the listing, newest first. */
  documents: Document[];
  /** Where this page sits in the sequence. */
  pagination: Pagination;
  /** The tag, on a tag archive. Absent on the home page. */
  tag?: string | undefined;
  /** The category, on a category archive. Absent on the home page. */
  category?: string | undefined;
  /** Which template to use. Defaults to the home layout. */
  template?: string | undefined;
}

/**
 * The HTML side of the public site: everything that turns a document or a
 * listing into a page of the theme.
 *
 * It is deliberately separate from the routes. Content negotiation picks a
 * representation and then asks the renderer for the HTML one; feeds ask for
 * nothing here at all. Nothing in this interface touches a request.
 */
export interface Renderer {
  /** Site-wide data, re-read when `content/_data/site.json` changes. */
  site(): SiteData;
  /** How many documents a listing page holds, per the site data. */
  pageSize(): number;
  /**
   * Where the taxonomy archives live, per the site data. The routes read it
   * per request rather than at boot, so a base saved on the settings screen
   * moves the archives on the very next one.
   */
  taxonomyBases(): TaxonomyBases;
  /**
   * The archive renames the site records, per the site data. Read per request
   * for the same reason the bases are: a rename made on the taxonomy screen
   * has to answer at the old URL on the very next one.
   */
  termRedirects(): readonly TaxonomyRedirect[];
  /**
   * One document through its type's layout.
   *
   * `extra` goes on the context last and so wins: it is how the comment
   * endpoint puts a refused form back on the page it came from, and how the
   * redirect after a submission gets its thank-you onto the post.
   */
  renderDocument(document: Document, extra?: Record<string, unknown>): string;
  /** A listing through the home, tag or category layout. */
  renderListing(listing: Listing): string;
  /** The 404 page, for a path that resolved to nothing. */
  renderNotFound(url: string): string;
  /** Any template by name, with the site data already in the context. */
  render(template: string, context?: Record<string, unknown>): string;
  /** The Nunjucks environment, for a site that wants to add its own filters. */
  readonly environment: Environment;
}

/** How to build a {@link Renderer}. */
export interface CreateRendererOptions {
  /** Config after defaults, for the theme directory, base URL and content directory. */
  config: ResolvedConfig;
  /**
   * The public pages, for the ones that put themselves in the site menu. Read
   * per render rather than at boot, because a page saved in the editor should
   * be in the menu on the very next request.
   *
   * A renderer built without it has a menu of exactly what the setting names,
   * which is what the tests over one template want and what a site with no
   * index would get anyway.
   */
  pages?: (() => readonly Document[]) | undefined;
  /**
   * What has been said about a post: the replies, likes and boosts the theme
   * renders under it (TASK-49).
   *
   * Injected rather than read here for the same reason the pages are — the
   * renderer holds no store — and read per render, so a reply that arrives
   * while the page is cached in nobody's browser is on the very next one. A
   * renderer built without it renders no conversation at all, which is what
   * every test over one template wants.
   */
  conversation?: ((document: Document) => Conversation) | undefined;
  /**
   * The comment form for a post that is taking comments, and `undefined` for
   * one that is not (TASK-50).
   *
   * Injected for the same reason the conversation is, and asked per render for
   * a sharper reason: whether a post is still open depends on the clock, so a
   * form decided at boot would go on being offered for a post that closed an
   * hour ago. A renderer built without it renders no form at all.
   */
  commentForm?: ((document: Document) => CommentFormContext | undefined) | undefined;
}

/**
 * Build the renderer for one site.
 *
 * Templates are cached unless the content watcher is on, which is the same
 * switch as "this is a development server": with `watch: true` a template edit
 * shows up on the next request, exactly as a content edit does.
 */
export function createRenderer(options: CreateRendererOptions): Renderer {
  const { config } = options;
  const environment = createTemplateEnvironment({
    themeDir: config.themeDir,
    baseUrl: config.baseUrl,
    noCache: config.watch,
  });
  const siteData = createSiteDataSource(config);
  const pages = options.pages ?? ((): readonly Document[] => []);

  function render(template: string, context: Record<string, unknown> = {}): string {
    const site = siteData.read();
    // The menu is built here rather than by each caller because every page of
    // the site carries it: a listing, a document, the 404 and the editor's
    // preview all go through here, and a header that appeared on some of them
    // and not others would be a worse contract than one that is simply always
    // there. It is `menu` rather than `navigation` because `navigation` is the
    // front-matter key a page opts in with, and a document's own front matter
    // goes on top of the globals exactly as Eleventy's data cascade does.
    const menu = navigationMenu({ site, pages: pages(), url: currentUrl(context) });
    return environment.render(template, { site, menu, ...context });
  }

  return {
    environment,

    site() {
      return siteData.read();
    },

    pageSize() {
      return postsPerPage(siteData.read());
    },

    taxonomyBases() {
      return taxonomyBases(siteData.read());
    },

    termRedirects() {
      return termRedirects(siteData.read());
    },

    renderDocument(document, extra = {}) {
      const template = document.type === 'post' ? TEMPLATES.post : TEMPLATES.page;
      // `activityStreams` is the object id the base layout advertises. It is
      // added here rather than in `documentContext` because it needs the
      // site's base URL, which a document on its own does not carry.
      const objectId = activityStreamsId(document, config.baseUrl);
      // `commentsFeed` is where this post's replies are syndicated. It is set
      // here rather than in a layout because only a published post has one —
      // a page never federates, so nothing can ever have replied to it — and
      // because a site that overrides `post.njk` should keep the link anyway.
      // `conversation` is what the fediverse said back. It is on the context
      // only when there is something in it, so a theme can ask `{% if
      // conversation %}` and a post nobody has answered renders no empty
      // section (TASK-49).
      const said = options.conversation?.(document);
      // `commentForm` is on the context only when the post is open, so the
      // theme asks `{% if commentForm %}` rather than working the rules out
      // for itself — and a closed post shows the thread with no form.
      const form = options.commentForm?.(document);

      return render(template, {
        ...documentContext(document, config),
        ...(objectId === undefined
          ? {}
          : {
              activityStreams: objectId,
              commentsFeed: commentsFeedPath(document.permalink),
            }),
        ...(said === undefined || said.counts.total === 0 ? {} : { conversation: said }),
        ...(form === undefined ? {} : { commentForm: form }),
        ...extra,
      });
    },

    renderListing(listing) {
      const items: DocumentContext[] = listing.documents.map((document) =>
        documentContext(document, config),
      );

      return render(listing.template ?? TEMPLATES.home, {
        title: listing.title,
        url: listing.url,
        page: { url: listing.url },
        // `posts` is the friendly name a theme loops over; `pagination.items`
        // is the same array under the name Eleventy gives it.
        posts: items,
        pagination: { ...listing.pagination, items },
        ...(listing.tag === undefined ? {} : { tag: listing.tag }),
        ...(listing.category === undefined ? {} : { category: listing.category }),
      });
    },

    renderNotFound(url) {
      return render(TEMPLATES.notFound, {
        title: 'Not found',
        url,
        page: { url },
      });
    },

    render,
  };
}

/**
 * The path a render is of, for marking the current menu item.
 *
 * Read off `page.url` and then `url`, the two names every caller here already
 * sets, so nothing has to pass the path a third time. A template rendered with
 * neither — a site calling `render` for a fragment of its own — is treated as
 * the home page's, which marks nothing that a page of the site would not.
 */
function currentUrl(context: Record<string, unknown>): string {
  const page = context['page'];
  if (typeof page === 'object' && page !== null) {
    const url = (page as Record<string, unknown>)['url'];
    if (typeof url === 'string') return url;
  }
  return typeof context['url'] === 'string' ? context['url'] : '/';
}
