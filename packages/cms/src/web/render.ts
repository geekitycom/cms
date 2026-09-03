import type { Environment } from 'nunjucks';

import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import { createSiteDataSource, documentContext, postsPerPage } from './context.ts';
import type { DocumentContext, SiteData, SiteSettingsSource } from './context.ts';
import type { Pagination } from './pagination.ts';
import { createTemplateEnvironment } from './templates.ts';

/** Templates the default theme ships and the public routes ask for by name. */
export const TEMPLATES = {
  home: 'layouts/home.njk',
  post: 'layouts/post.njk',
  page: 'layouts/page.njk',
  tag: 'layouts/tag.njk',
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
  /** One document through its type's layout. */
  renderDocument(document: Document): string;
  /** A listing through the home or tag layout. */
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
   * The admin's stored settings, which win over `content/_data/site.json` for
   * the values the settings screen manages. Absent for a renderer built
   * without an admin store, which then reads the file alone.
   */
  settings?: SiteSettingsSource | undefined;
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
  const siteData = createSiteDataSource(config, { settings: options.settings });

  function render(template: string, context: Record<string, unknown> = {}): string {
    const site = siteData.read();
    return environment.render(template, { site, ...context });
  }

  return {
    environment,

    site() {
      return siteData.read();
    },

    pageSize() {
      return postsPerPage(siteData.read());
    },

    renderDocument(document) {
      const template = document.type === 'post' ? TEMPLATES.post : TEMPLATES.page;
      return render(template, documentContext(document));
    },

    renderListing(listing) {
      const items: DocumentContext[] = listing.documents.map(documentContext);

      return render(listing.template ?? TEMPLATES.home, {
        title: listing.title,
        url: listing.url,
        page: { url: listing.url },
        // `posts` is the friendly name a theme loops over; `pagination.items`
        // is the same array under the name Eleventy gives it.
        posts: items,
        pagination: { ...listing.pagination, items },
        ...(listing.tag === undefined ? {} : { tag: listing.tag }),
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
