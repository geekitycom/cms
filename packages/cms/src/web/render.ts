import type { Environment } from 'nunjucks';

import type { CommentFormContext, CommentViewer } from '../comments/form.ts';
import type { CommentThread, Conversation } from '../comments/conversation.ts';
import type { ResolvedConfig } from '../config.ts';
import type { ContactFormContext } from '../contact/form.ts';
import type { Document } from '../content/document.ts';
import type { SharedLocation } from '../content/location.ts';
import type { DocumentNeighbours, SearchHit } from '../content/store.ts';
import type { SyndicationTarget } from '../content/syndicate-to.ts';
import type { TaxonomyBases, TaxonomyRedirect } from '../content/taxonomy.ts';
import type { PageFont } from '../fonts/index.ts';
import type { AuthorContext } from '../site/authors.ts';
import type { SiteSettings } from '../site/settings.ts';
import type { User } from '../site/users.ts';
import type { SchemeTokens } from '../theme/scheme-tokens.ts';
import {
  createSiteDataSource,
  frontPageSlugs,
  postsPerPage,
  taxonomyBases,
  termRedirects,
  themeName,
} from '../theme/site-data.ts';
import type { FrontPageSlugs, SiteColors, SiteData, SiteDataSource } from '../theme/site-data.ts';
import { createThemeSource } from '../theme/themes.ts';
import type { ThemeColors, ThemeFont, ThemeSource } from '../theme/themes.ts';
import type { ReplyContext } from '../webmention/reply-context.ts';
import { createDocumentPages } from './document-render.ts';
import { createListingPages } from './listing-render.ts';
import { createMarkdownChrome } from './markdown-chrome.ts';
import { createMarkdownEnvironment } from './markdown-environment.ts';
import type { MarkdownChrome, MarkdownUrl } from './markdown-page.ts';
import type { TextFormat } from './negotiate.ts';
import { createPageContexts } from './page-context.ts';
import type { Pagination } from './pagination.ts';
import { requestSite } from './render-scope.ts';
import { createThemeEnvironment, siteColorsWithTokens } from './theme-environment.ts';
import { STATUS_PAGES, untilContext } from './theme-templates.ts';
import type { StatusPage, StatusPageName } from './theme-templates.ts';

export interface ThemeText {
  readonly format: TextFormat;
  readonly text: string;
}

export interface StatusMarkdownContext {
  /** The path the request was for. */
  url: string;
  markdownUrl: MarkdownUrl;
  /** On the maintenance page: when the operator expects the site back. */
  until?: Date | undefined;
  format: TextFormat;
}

/** What {@link Renderer.renderMarkdownChrome} writes links with. */
export interface MarkdownChromeOptions {
  /** A canonical URL as the representation links it. */
  markdownUrl: MarkdownUrl;
  /** The page, when it is the site's front page: `newestPosts` is offered there. */
  frontPage?: Document | undefined;
  /**
   * The document the Markdown is of, for its `categories`, `tags` and
   * `backlinks`, and `archiveMonths` when it says `archive: true`.
   */
  document?: Document | undefined;
  /**
   * For `gemini`, the archive page's descriptions are left off, so each of
   * its posts converts to a gemfeed line, `=> url YYYY-MM-DD title`.
   */
  format: TextFormat;
}

export interface MarkdownChromeText {
  readonly header: ThemeText;
  readonly footer: ThemeText;
}

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

/** One page of search results, ready to render. */
export interface SearchPage {
  /** What the reader searched for, as the page read it. Empty before a search. */
  query: string;
  /** The page's own URL, query included, for `page.url`. */
  url: string;
  /** The documents on this page of the results, best match first. */
  hits: readonly SearchHit[];
  /** Where this page sits among all the results. */
  pagination: Pagination;
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
   * One document's page, as {@link renderDocument} or, with `frontPage`,
   * {@link renderFrontPage} draws it, together with what validates it.
   */
  renderPage(document: Document, options: RenderPageOptions): RenderedPage;
  /**
   * One document through its type's layout.
   *
   * `extra` goes on the context last and so wins: it is how the comment
   * endpoint puts a refused form back on the page it came from, and how the
   * redirect after a submission gets its thank-you onto the post.
   *
   * `viewer` is who the request's session says is reading, when it says
   * anybody. The only thing it changes is the comment form, which
   * is drawn for them rather than for a stranger; a caller with no request —
   * a feed, a preview, an email — passes nothing and gets the page everybody
   * else gets.
   */
  renderDocument(
    document: Document,
    extra?: Record<string, unknown>,
    viewer?: CommentViewer,
  ): string;
  /**
   * One page as the site's front page: the same context its own URL would give
   * it, at `/`, through the theme's front-page template if it has one and its
   * page layout if it has not.
   */
  renderFrontPage(
    document: Document,
    extra?: Record<string, unknown>,
    viewer?: CommentViewer,
  ): string;
  /** A listing through the home, tag or category layout. */
  renderListing(listing: Listing): string;
  /**
   * A page of search results, or the empty search form, through the search
   * layout. Each result is the document context a listing entry is, with a
   * `snippet` of HTML showing where the words were found.
   */
  renderSearch(search: SearchPage): string;
  /**
   * A native comment's own page through the comment layout: the
   * comment, the thread above it from its post down, and its replies.
   */
  renderComment(thread: CommentThread): string;
  /** The 404 page, for a path that resolved to nothing. */
  renderNotFound(url: string): string;
  /** The 410 page, for the URL of a document that was deleted. */
  renderGone(url: string): string;
  /** The 500 page, for a request whose handler threw. */
  renderServerError(url: string): string;
  /**
   * The maintenance page, for a request turned away while the site
   * is down on purpose. `until` is when the operator expects it back.
   */
  renderMaintenance(url: string, until: Date | undefined): string;
  /**
   * The body of a status page's Markdown or gemtext, from the theme's
   * templates in {@link STATUS_PAGES}, with autoescaping off. The template
   * gets `site`, `url`, `title`, the maintenance page's `until` and
   * `untilText`, and the filters the Markdown partials have.
   */
  renderStatusMarkdown(page: StatusPageName, context: StatusMarkdownContext): ThemeText;
  /**
   * The header and footer of a page's Markdown or gemtext, through
   * {@link CHROME_TEMPLATES} with autoescaping off: Markdown is not HTML.
   * The partials get `site`, `menus`, `soloAuthor`, the chrome's links as
   * data, a document's `categories`, `tags`, `backlinks`, `conversation` and
   * form links, `archiveMonths` on an archive page, and the `escapeMarkdown`,
   * `nest`, `markdownUrl` and `geminiUrl` filters.
   *
   * Gemtext comes from the first of the chosen theme's `.gmi.njk`, its
   * `.md.njk`, the default theme's `.gmi.njk` and its `.md.njk`,
   * and the result says which format the theme wrote.
   */
  renderMarkdownChrome(chrome: MarkdownChrome, options: MarkdownChromeOptions): MarkdownChromeText;
  /** Any template by name, with the site data already in the context. */
  render(template: string, context?: Record<string, unknown>): string;
  /**
   * The theme directories a render reads from right now, in order: what the
   * `/theme/` route serves the site's static files out of, so a stylesheet and
   * the page that links to it can never come from two different themes.
   */
  themeDirs(): readonly string[];
  /**
   * The colours of the theme a render wears right now, gap-filled from the
   * packaged theme: what the head declares and the web manifest repeats.
   */
  themeColors(): ThemeColors;
  /**
   * The scheme and mode the site draws its pages in right now, with the
   * scheme's colour tokens from the theme's stylesheet: what a page that does
   * not load the stylesheet, the embed view, colours itself with.
   * `undefined` under a theme with no schemes.
   */
  siteColors(): (SiteColors & { readonly tokens: SchemeTokens }) | undefined;
  /** The Nunjucks environment, for a site that wants to add its own filters. */
  readonly environment: Environment;
  /**
   * The twin the Markdown partials render through: the same loader and
   * filters, autoescaping off, and the two Markdown filters. A filter added to
   * `environment` is not seen here: add it to both when Markdown needs it too.
   */
  readonly markdownEnvironment: Environment;
}

/** What {@link CreateRendererOptions.syndication} answers for one post. */
export interface PostSyndication {
  /** The declared targets the post selects, in declaration order. */
  readonly targets: readonly SyndicationTarget[];
  /** The URLs of the copies those targets answered with. */
  readonly copies: readonly string[];
}

/** How to build a {@link Renderer}. */
export interface CreateRendererOptions {
  /** Config after defaults, for the themes directory, base URL and content directory. */
  config: ResolvedConfig;
  /**
   * The Google Fonts a page is set in, per the site's `headingFont` and
   * `bodyFont` and the roles the theme declares. A renderer
   * built without it sets every role in the theme's own stack.
   */
  fonts?: ((site: SiteData, declared: readonly ThemeFont[]) => readonly PageFont[]) | undefined;
  /**
   * Which theme the site is rendering through, asked per render.
   *
   * Injected so that one CMS has one answer: the pages, the `/theme/` assets
   * and the site's email all read the same source, so a theme that has gone
   * missing is reported once rather than three times. A renderer built without
   * one makes its own from the config, and follows the setting just as well.
   */
  themes?: ThemeSource | undefined;
  /**
   * The public pages, for the one a site names as its posts page. Read per
   * render rather than at boot, because a page renamed in the editor should be
   * linked under its new title on the very next request.
   *
   * A renderer built without it draws no link to a posts page, which is what
   * the tests over one template want and what a site with no index would get
   * anyway.
   */
  pages?: (() => readonly Document[]) | undefined;
  /**
   * What has been said about a post: the replies, likes and boosts the theme
   * renders under it.
   *
   * Injected rather than read here for the same reason the pages are — the
   * renderer holds no store — and read per render, so a reply that arrives
   * while the page is cached in nobody's browser is on the very next one. A
   * renderer built without it renders no conversation at all, which is what
   * every test over one template wants.
   */
  conversation?: ((document: Document, site: SiteSettings) => Conversation) | undefined;
  /**
   * What is stored about a page a post cites, by its URL: what a reply
   * answers, and what a like, repost or bookmark cites.
   *
   * Read, never fetched: the context was fetched when the post was saved or
   * synced, so drawing it waits on nobody's server. A renderer built without
   * it draws every citation with a bare link.
   */
  replyContext?: ((target: string, site: SiteSettings) => ReplyContext | undefined) | undefined;
  /**
   * The syndication targets a post selects and the copies they answered with,
   * read from the site's files and never fetched. A renderer built
   * without it links a post to no target and prints only the copies its front
   * matter lists by hand.
   */
  syndication?: ((document: Document, site: SiteSettings) => PostSyndication) | undefined;
  /**
   * What the site shares of where a post was written, already
   * reduced by Settings > Privacy. Read per render so the
   * setting takes effect on the next request. A renderer built without it
   * prints no location, which is what every test over one template wants.
   */
  location?: ((document: Document, site: SiteSettings) => SharedLocation | undefined) | undefined;
  /**
   * The comment form for a post that is taking comments, and `undefined` for
   * one that is not.
   *
   * Injected for the same reason the conversation is, and asked per render for
   * a sharper reason: whether a post is still open depends on the clock, so a
   * form decided at boot would go on being offered for a post that closed an
   * hour ago. A renderer built without it renders no form at all.
   */
  commentForm?:
    | ((
        document: Document,
        viewer: CommentViewer | undefined,
        notifiable: boolean,
      ) => CommentFormContext | undefined)
    | undefined;
  /**
   * The contact form for a page whose front matter asks for one, and
   * `undefined` for every other document.
   *
   * Injected for the same reason the comment form is, and asked per render for
   * the same one: a `contact: true` saved in the editor a moment ago puts a
   * form on the page the next request draws. A renderer built without it
   * renders no contact form at all.
   */
  contactForm?: ((document: Document) => ContactFormContext | undefined) | undefined;
  /**
   * Who may sign in, for the byline.
   *
   * Injected and read per render for the reason the pages are: `data/users.json`
   * is the truth about who exists, a display name saved a moment
   * ago should be on the very next page, and the renderer holds no store. It
   * is asked once per render rather than once per document, so a listing of
   * ten posts costs one read of the file.
   *
   * A renderer built without it resolves no author at all, which is what a
   * test over one template wants: the front matter's own name is still printed,
   * it simply links nowhere.
   */
  users?: (() => readonly User[]) | undefined;
  /**
   * The published posts either side of one, for `previous` and `next` under an
   * entry.
   *
   * Injected for the reason the conversation is — the renderer holds no index
   * — and asked per render rather than at boot, because a post published a
   * minute ago is the neighbour the post before it should already be linking
   * to. A renderer built without it draws no such links, which is what a test
   * over one template wants.
   */
  neighbours?: ((document: Document) => DocumentNeighbours) | undefined;
  /**
   * The listed posts and pages of the site whose body links to a document,
   * newest first, for `backlinks` on its page. Injected and asked
   * per render for the reason the neighbours are; a renderer built without it
   * lists none.
   */
  backlinks?: ((document: Document) => readonly Document[]) | undefined;
  /**
   * The newest `count` published posts, for `newestPosts` on the front page.
   * The theme chooses the count; the index decides what is
   * published.
   */
  newestPosts?: ((count: number) => readonly Document[]) | undefined;
  /**
   * Every published post, for a page whose front matter says `archive: true`.
   *
   * Injected for the reason the newest posts are, and asked per render and
   * only for a page that asked for the list: an archive is the one listing
   * with no paging, so a site with a thousand posts runs the query on the one
   * page that prints a thousand links and on no other.
   */
  archivePosts?: (() => readonly Document[]) | undefined;
}

/** Which page of a document {@link Renderer.renderPage} draws, and for whom. */
export interface RenderPageOptions {
  /** Whether it is being served at `/` as the site's front page. */
  frontPage?: boolean | undefined;
  /** Context that goes on last and wins, as {@link Renderer.renderDocument} takes it. */
  extra?: Record<string, unknown> | undefined;
  /** Who the request's session says is reading, when it says anybody. */
  viewer?: CommentViewer | undefined;
}

/** A document's page and the fingerprint its ETag is made from. */
export interface RenderedPage {
  /** The page as it is sent. */
  readonly html: string;
  /**
   * Everything the page shows except the forms' loaded-at stamps, which are
   * the clock rather than the page: the same page drawn a second later is
   * the same page. The window each stamp falls in goes in instead, so a
   * browser revalidating an old copy is told it is fresh only while the stamp
   * it holds is young enough to submit.
   */
  readonly fingerprint: string;
}

/**
 * What every part of a renderer reads from: the options it was built with and
 * the sources made from them once, so the theme environment, the page context
 * builders and the page renderers all see one site.
 */
export interface RenderDeps {
  readonly options: CreateRendererOptions;
  readonly config: ResolvedConfig;
  readonly siteData: SiteDataSource;
  readonly themes: ThemeSource;
  readonly pages: () => readonly Document[];
  readonly users: () => readonly User[];
  readonly citedPage: ((url: string) => ReplyContext | undefined) | undefined;
}

/** Build the renderer for one site out of its theme, Markdown and page parts. */
export function createRenderer(options: CreateRendererOptions): Renderer {
  const deps = renderDeps(options);
  const { siteData, themes } = deps;
  const theme = createThemeEnvironment(deps);
  const markdown = createMarkdownEnvironment(deps);
  const contexts = createPageContexts(deps);
  const { renderPage } = createDocumentPages(deps, theme.render, contexts);
  const { render } = theme;

  function statusPage(
    { template, title }: StatusPage,
    url: string,
    extra: Record<string, unknown> = {},
  ): string {
    return render(template, { title, url, page: { url }, ...extra });
  }

  return {
    environment: theme.environment,
    markdownEnvironment: markdown.environment,
    ...createMarkdownChrome(deps, markdown, contexts),
    ...createListingPages(deps, render, contexts),
    site: () => siteData.read(),
    themeDirs: () => themes.current().dirs,
    themeColors: () => themes.current().colors,
    siteColors: () => siteColorsWithTokens(deps),
    pageSize: () => postsPerPage(siteData.read()),
    taxonomyBases: () => taxonomyBases(siteData.read()),
    termRedirects: () => termRedirects(siteData.read()),
    frontPageSlugs: () => frontPageSlugs(siteData.read()),
    renderPage,
    renderDocument: (document, extra = {}, viewer = undefined) =>
      renderPage(document, { extra, viewer }).html,
    renderFrontPage: (document, extra = {}, viewer = undefined) =>
      renderPage(document, { frontPage: true, extra, viewer }).html,
    renderNotFound: (url) => statusPage(STATUS_PAGES.notFound, url),
    renderGone: (url) => statusPage(STATUS_PAGES.gone, url),
    renderServerError: (url) => statusPage(STATUS_PAGES.serverError, url),
    renderMaintenance: (url, until) =>
      statusPage(STATUS_PAGES.maintenance, url, untilContext(until)),
    render,
  };
}

function renderDeps(options: CreateRendererOptions): RenderDeps {
  const { config, replyContext } = options;
  const siteData = createSiteDataSource(config);
  return {
    options,
    config,
    siteData,
    // Which theme every render reads from. Built here when the caller did not
    // bring one so that a renderer made on its own — a test over one template,
    // a site rendering a fragment of its own — still follows the `theme` in
    // `site.json`; `createCms` hands in the one the mail templates and the
    // `/theme/` assets share, so a site has a single answer and logs a bad
    // choice once.
    themes:
      options.themes ??
      createThemeSource({ themesDir: config.themesDir, chosen: () => themeName(siteData.read()) }),
    pages: options.pages ?? ((): readonly Document[] => []),
    users: options.users ?? ((): readonly User[] => []),
    citedPage:
      replyContext === undefined
        ? undefined
        : (url: string): ReplyContext | undefined => replyContext(url, requestSite()),
  };
}
