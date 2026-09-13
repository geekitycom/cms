import type { Environment } from 'nunjucks';

import type { User } from '../admin/accounts.ts';
import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import { authorContext } from './authors.ts';
import type { AuthorContext } from './authors.ts';
import {
  createSiteDataSource,
  documentContext,
  frontPageSlugs,
  postsPerPage,
  taxonomyBases,
  termRedirects,
  themeName,
} from './context.ts';
import type { CommentFormContext } from '../comments/form.ts';
import type { ContactFormContext } from '../contact/form.ts';
import type { Conversation } from './conversation.ts';
import { activityStreamsId } from './documents.ts';
import { commentsFeedPath } from './feeds.ts';
import type { DocumentContext, FrontPageSlugs, SiteData } from './context.ts';
import { navigationMenu } from './navigation.ts';
import type { Pagination } from './pagination.ts';
import type { TaxonomyBases, TaxonomyRedirect } from './taxonomy.ts';
import { createTemplateEnvironment, useThemeDirs } from './templates.ts';
import { createThemeSource, findThemeFile } from './themes.ts';
import type { ThemeSource } from './themes.ts';
import { webmentionEndpointFor } from '../webmention/routes.ts';

/** Templates the default theme ships and the public routes ask for by name. */
export const TEMPLATES = {
  home: 'layouts/home.njk',
  post: 'layouts/post.njk',
  page: 'layouts/page.njk',
  tag: 'layouts/tag.njk',
  category: 'layouts/category.njk',
  author: 'layouts/author.njk',
  notFound: 'layouts/404.njk',
} as const;

/**
 * The two templates a theme may add for the Reading choice, neither of which
 * the default theme ships.
 *
 * They are override points rather than layouts: a site that sets a static
 * homepage gets the page layout and a site that sets a posts page gets the
 * listing layout, until it writes one of these — which is WordPress's own
 * `front-page.php` and `home.php`, and the same reason for having them. A
 * front page is often the one page of a site that looks like nothing else, and
 * saying so should not mean overriding the layout every other page uses.
 */
export const OPTIONAL_TEMPLATES = {
  /** The front page alone. Falls back to {@link TEMPLATES.page}. */
  frontPage: 'layouts/front-page.njk',
  /** The listing on the posts page. Falls back to {@link TEMPLATES.home}. */
  postsPage: 'layouts/posts-page.njk',
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
  /**
   * Whose archive this is, on an author archive: the same profile a post's
   * byline is given, so a theme prints the heading of an archive with what it
   * already knows how to print under a post.
   */
  author?: AuthorContext | undefined;
  /** Which template to use. Defaults to the home layout. */
  template?: string | undefined;
  /**
   * The page whose permalink this listing is at, when the site has a posts
   * page. Its front matter and its rendered body go on the context under the
   * listing's own title and URL, so a theme prints the words above the posts.
   */
  document?: Document | undefined;
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
   * The Reading choice, per the site data: which page is served at `/`, and
   * which one's URL carries the listing. Read per request for the reason the
   * bases are — a save on the settings screen moves the front page on the very
   * next one — and answered as slugs, because only the index knows whether one
   * still names a published page.
   */
  frontPageSlugs(): FrontPageSlugs;
  /**
   * One document through its type's layout.
   *
   * `extra` goes on the context last and so wins: it is how the comment
   * endpoint puts a refused form back on the page it came from, and how the
   * redirect after a submission gets its thank-you onto the post.
   */
  renderDocument(document: Document, extra?: Record<string, unknown>): string;
  /**
   * One page as the site's front page: the same context its own URL would give
   * it, at `/`, through the theme's front-page template if it has one and its
   * page layout if it has not.
   */
  renderFrontPage(document: Document, extra?: Record<string, unknown>): string;
  /** A listing through the home, tag or category layout. */
  renderListing(listing: Listing): string;
  /** The 404 page, for a path that resolved to nothing. */
  renderNotFound(url: string): string;
  /** Any template by name, with the site data already in the context. */
  render(template: string, context?: Record<string, unknown>): string;
  /**
   * The theme directories a render reads from right now, in order: what the
   * `/theme/` route serves the site's static files out of, so a stylesheet and
   * the page that links to it can never come from two different themes.
   */
  themeDirs(): readonly string[];
  /** The Nunjucks environment, for a site that wants to add its own filters. */
  readonly environment: Environment;
}

/** How to build a {@link Renderer}. */
export interface CreateRendererOptions {
  /** Config after defaults, for the themes directory, base URL and content directory. */
  config: ResolvedConfig;
  /**
   * Which theme the site is rendering through, asked per render (decision-15).
   *
   * Injected so that one CMS has one answer: the pages, the `/theme/` assets
   * and the site's email all read the same source, so a theme that has gone
   * missing is reported once rather than three times. A renderer built without
   * one makes its own from the config, and follows the setting just as well.
   */
  themes?: ThemeSource | undefined;
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
  /**
   * The contact form for a page whose front matter asks for one, and
   * `undefined` for every other document (TASK-56).
   *
   * Injected for the same reason the comment form is, and asked per render for
   * the same one: a `contact: true` saved in the editor a moment ago puts a
   * form on the page the next request draws. A renderer built without it
   * renders no contact form at all.
   */
  contactForm?: ((document: Document) => ContactFormContext | undefined) | undefined;
  /**
   * Who may sign in, for the byline (TASK-67).
   *
   * Injected and read per render for the reason the pages are: `data/users.json`
   * is the truth about who exists (decision-9), a display name saved a moment
   * ago should be on the very next page, and the renderer holds no store. It
   * is asked once per render rather than once per document, so a listing of
   * ten posts costs one read of the file.
   *
   * A renderer built without it resolves no author at all, which is what a
   * test over one template wants: the front matter's own name is still printed,
   * it simply links nowhere.
   */
  users?: (() => readonly User[]) | undefined;
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
  const siteData = createSiteDataSource(config);
  // Which theme every render below reads from. Built here when the caller did
  // not bring one so that a renderer made on its own — a test over one
  // template, a site rendering a fragment of its own — still follows the
  // `theme` in `site.json`; `createCms` hands in the one the mail templates
  // and the `/theme/` assets share, so a site has a single answer and logs a
  // bad choice once.
  const themes =
    options.themes ??
    createThemeSource({ themesDir: config.themesDir, chosen: () => themeName(siteData.read()) });
  const environment = createTemplateEnvironment({
    themeDirs: themes.current().dirs,
    baseUrl: config.baseUrl,
    noCache: config.watch,
  });
  const pages = options.pages ?? ((): readonly Document[] => []);
  const users = options.users ?? ((): readonly User[] => []);

  function render(template: string, context: Record<string, unknown> = {}): string {
    const site = siteData.read();
    // Before anything is looked up: a theme chosen on the Appearance screen, or
    // written into `site.json` by hand, decides this very render rather than
    // the next boot. It costs a comparison of two short arrays when nothing
    // has changed, which is every render of a site that is not being rethemed.
    useThemeDirs(environment, themes.current().dirs);
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

  /**
   * Which template one listing renders through: whatever it named, the posts
   * page's own template when it is one and the theme ships one, and the home
   * layout otherwise.
   */
  function listingTemplate(listing: Listing): string {
    if (listing.template !== undefined) return listing.template;
    if (listing.document === undefined) return TEMPLATES.home;
    return themeTemplate(themes.current().dirs, OPTIONAL_TEMPLATES.postsPage, TEMPLATES.home);
  }

  /**
   * One document through one template, with everything a page of the theme is
   * given: its own context, its ActivityStreams id, its conversation, its
   * forms and its webmention endpoint.
   *
   * The template and the URL are arguments because the front page is the same
   * page rendered somewhere else: `renderDocument` and `renderFrontPage` are
   * this with two different answers to "which layout, and at which URL".
   */
  function documentPage(
    document: Document,
    options_: { template: string; url?: string | undefined; extra: Record<string, unknown> },
  ): string {
    const { template, extra } = options_;
    // The profile behind the document's `author`, resolved here rather than in
    // `documentContext` for the reason the object id is: it needs the site's
    // users, which a document on its own does not carry.
    const context = documentContext(document, config, authorContext(users(), document.author));
    // The URL it is being served at, which is its own permalink everywhere but
    // the front page.
    const url = options_.url ?? context.url;
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
    // And the contact form, when the page's front matter asked for one
    // (TASK-56). Nothing about where a message would go is on the context:
    // the address is read when a submission arrives, so a theme cannot
    // print it however it is written.
    const contact = options.contactForm?.(document);
    // Where a webmention about this page is sent (TASK-51). On the context
    // only when the site takes them, so a theme asks `{% if webmention %}`
    // and a site that has turned them off advertises nothing.
    const webmention = webmentionEndpointFor(siteData.read());

    return render(template, {
      ...context,
      url,
      page: { ...context.page, url },
      ...(objectId === undefined
        ? {}
        : {
            activityStreams: objectId,
            commentsFeed: commentsFeedPath(document.permalink),
          }),
      ...(said === undefined || said.counts.total === 0 ? {} : { conversation: said }),
      ...(form === undefined ? {} : { commentForm: form }),
      ...(contact === undefined ? {} : { contactForm: contact }),
      ...(webmention === undefined ? {} : { webmention }),
      ...extra,
    });
  }

  return {
    environment,

    site() {
      return siteData.read();
    },

    themeDirs() {
      return themes.current().dirs;
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

    frontPageSlugs() {
      return frontPageSlugs(siteData.read());
    },

    renderDocument(document, extra = {}) {
      return documentPage(document, {
        template: document.type === 'post' ? TEMPLATES.post : TEMPLATES.page,
        extra,
      });
    },

    renderFrontPage(document, extra = {}) {
      return documentPage(document, {
        // A theme's own front page if it has written one, and the layout every
        // other page uses if it has not.
        template: themeTemplate(
          themes.current().dirs,
          OPTIONAL_TEMPLATES.frontPage,
          TEMPLATES.page,
        ),
        // At `/`, which is where it is being read: the canonical link, the
        // menu's current item and anything else a theme takes off `page.url`
        // should say the URL this is served at rather than the one that
        // redirects here.
        url: '/',
        extra,
      });
    },

    renderListing(listing) {
      // One read of the users file for the whole page, however many posts are
      // on it: every byline on a listing resolves against the same list.
      const people = users();
      const items: DocumentContext[] = listing.documents.map((document) =>
        documentContext(document, config, authorContext(people, document.author)),
      );
      // The posts page's own front matter and rendered body, under the
      // listing's title, URL and posts: a theme prints `{{ content | safe }}`
      // above the list and a site without a posts page has nothing there. The
      // listing's own keys go on after it, because this page of the listing is
      // what is being served — page two of it is not the page's own URL.
      const document =
        listing.document === undefined
          ? undefined
          : documentContext(
              listing.document,
              config,
              authorContext(people, listing.document.author),
            );

      return render(listingTemplate(listing), {
        ...document,
        title: listing.title,
        url: listing.url,
        page: { ...document?.page, url: listing.url },
        // `posts` is the friendly name a theme loops over; `pagination.items`
        // is the same array under the name Eleventy gives it.
        posts: items,
        pagination: { ...listing.pagination, items },
        ...(listing.tag === undefined ? {} : { tag: listing.tag }),
        ...(listing.category === undefined ? {} : { category: listing.category }),
        // On an author archive this is the person the archive is of, and it
        // goes on last so it wins over the posts page's own `author`, which is
        // the page's writer rather than whose archive this is.
        ...(listing.author === undefined ? {} : { author: listing.author }),
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
 * `preferred` when a theme in the search path ships it, and `fallback`
 * otherwise.
 *
 * Asked per render rather than at boot, so adding `front-page.njk` to a theme
 * shows on the next request exactly as editing one does. It costs one `stat`
 * per theme directory, and only on the two pages that have an override point
 * at all.
 */
function themeTemplate(themeDirs: readonly string[], preferred: string, fallback: string): string {
  return findThemeFile(themeDirs, preferred) === undefined ? fallback : preferred;
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
