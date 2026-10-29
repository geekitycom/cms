import type { Environment } from 'nunjucks';

import type { CommentFormContext, CommentViewer } from '../comments/form.ts';
import type { CommentThread, Conversation } from '../comments/conversation.ts';
import type { ResolvedConfig } from '../config.ts';
import type { ContactFormContext } from '../contact/form.ts';
import type { Document } from '../content/document.ts';
import type { SharedLocation } from '../content/location.ts';
import type { DocumentNeighbours, SearchHit } from '../content/store.ts';
import type { SyndicationTarget } from '../content/syndicate-to.ts';
import type { PermalinkBases, TaxonomyBases, TaxonomyRedirect } from '../content/taxonomy.ts';
import type { PageFont } from '../fonts/index.ts';
import type { AuthorContext } from '../site/authors.ts';
import type { SiteSettings } from '../site/settings.ts';
import type { User } from '../site/users.ts';
import type { SchemeTokens } from '../theme/scheme-tokens.ts';
import {
  createSiteDataSource,
  frontPageSlugs,
  permalinkBases,
  postsPerPage,
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
import type { WikiGroup } from './wiki-index.ts';
import type { StatusPage, StatusPageName } from './theme-templates.ts';

export interface ThemeText {
  readonly format: TextFormat;
  readonly text: string;
}

export interface StatusMarkdownContext {
  url: string;
  markdownUrl: MarkdownUrl;
  until?: Date | undefined;
  format: TextFormat;
}

export interface MarkdownChromeOptions {
  markdownUrl: MarkdownUrl;
  frontPage?: Document | undefined;
  document?: Document | undefined;
  /**
   * For `gemini`, the archive page's descriptions are left off, so each of
   * its posts converts to a gemfeed line, `=> url YYYY-MM-DD title`.
   */
  format: TextFormat;
  /**
   * The HTML layouts whose text templates may write the page, first choice
   * first: a front page names `layouts/front-page.njk` and then
   * `layouts/page.njk`. Absent on a status page.
   */
  layouts?: readonly string[] | undefined;
}

/** The parts a layout's text template places, already written in its format. */
export interface LayoutParts {
  readonly header: string;
  readonly content: string;
  readonly footer: string;
}

/** A theme's text template for the page's layout, in the format it is written in. */
export interface TextLayout {
  readonly format: TextFormat;
  render(parts: LayoutParts): string;
}

export interface MarkdownChromeText {
  readonly header: ThemeText;
  readonly footer: ThemeText;
  /** Present when a theme writes this page's layout as text. */
  readonly layout?: TextLayout | undefined;
}

export interface Listing {
  title: string;
  url: string;
  documents: Document[];
  pagination: Pagination;
  tag?: string | undefined;
  category?: string | undefined;
  author?: AuthorContext | undefined;
  template?: string | undefined;
  document?: Document | undefined;
}

export interface WikiIndexPage {
  title: string;
  url: string;
  groups: readonly WikiGroup<Document>[];
}

export interface SearchPage {
  query: string;
  url: string;
  hits: readonly SearchHit[];
  pagination: Pagination;
}

export interface Renderer {
  site(): SiteData;
  pageSize(): number;
  /** Where the tag and category archives live. */
  taxonomyBases(): TaxonomyBases;
  /** Where the archives and the wiki pages live. */
  permalinkBases(): PermalinkBases;
  termRedirects(): readonly TaxonomyRedirect[];
  frontPageSlugs(): FrontPageSlugs;
  renderPage(document: Document, options: RenderPageOptions): RenderedPage;
  renderDocument(
    document: Document,
    extra?: Record<string, unknown>,
    viewer?: CommentViewer,
  ): string;
  renderFrontPage(
    document: Document,
    extra?: Record<string, unknown>,
    viewer?: CommentViewer,
  ): string;
  renderListing(listing: Listing): string;
  renderSearch(search: SearchPage): string;
  renderWikiIndex(index: WikiIndexPage): string;
  renderComment(thread: CommentThread): string;
  renderNotFound(url: string): string;
  renderGone(url: string): string;
  renderServerError(url: string): string;
  renderMaintenance(url: string, until: Date | undefined): string;
  renderStatusMarkdown(page: StatusPageName, context: StatusMarkdownContext): ThemeText;
  renderMarkdownChrome(chrome: MarkdownChrome, options: MarkdownChromeOptions): MarkdownChromeText;
  render(template: string, context?: Record<string, unknown>): string;
  themeDirs(): readonly string[];
  themeColors(): ThemeColors;
  siteColors(): (SiteColors & { readonly tokens: SchemeTokens }) | undefined;
  readonly environment: Environment;
  readonly markdownEnvironment: Environment;
}

export interface PostSyndication {
  readonly targets: readonly SyndicationTarget[];
  readonly copies: readonly string[];
}

export interface CreateRendererOptions {
  config: ResolvedConfig;
  fonts?: ((site: SiteData, declared: readonly ThemeFont[]) => readonly PageFont[]) | undefined;
  themes?: ThemeSource | undefined;
  pages?: (() => readonly Document[]) | undefined;
  conversation?: ((document: Document, site: SiteSettings) => Conversation) | undefined;
  replyContext?: ((target: string, site: SiteSettings) => ReplyContext | undefined) | undefined;
  syndication?: ((document: Document, site: SiteSettings) => PostSyndication) | undefined;
  location?: ((document: Document, site: SiteSettings) => SharedLocation | undefined) | undefined;
  commentForm?:
    | ((
        document: Document,
        viewer: CommentViewer | undefined,
        notifiable: boolean,
      ) => CommentFormContext | undefined)
    | undefined;
  contactForm?: ((document: Document) => ContactFormContext | undefined) | undefined;
  users?: (() => readonly User[]) | undefined;
  neighbours?: ((document: Document) => DocumentNeighbours) | undefined;
  backlinks?: ((document: Document) => readonly Document[]) | undefined;
  newestPosts?: ((count: number) => readonly Document[]) | undefined;
  archivePosts?: (() => readonly Document[]) | undefined;
}

export interface RenderPageOptions {
  frontPage?: boolean | undefined;
  extra?: Record<string, unknown> | undefined;
  viewer?: CommentViewer | undefined;
}

export interface RenderedPage {
  readonly html: string;
  readonly fingerprint: string;
}

export interface RenderDeps {
  readonly options: CreateRendererOptions;
  readonly config: ResolvedConfig;
  readonly siteData: SiteDataSource;
  readonly themes: ThemeSource;
  readonly pages: () => readonly Document[];
  readonly users: () => readonly User[];
  readonly citedPage: ((url: string) => ReplyContext | undefined) | undefined;
}

export function createRenderer(options: CreateRendererOptions): Renderer {
  const deps = renderDeps(options);
  const { siteData, themes } = deps;
  const theme = createThemeEnvironment(deps);
  const { render } = theme;
  const markdown = createMarkdownEnvironment(deps);
  const contexts = createPageContexts(deps);
  const { renderPage } = createDocumentPages(deps, render, contexts);

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
    taxonomyBases: () => permalinkBases(siteData.read()),
    permalinkBases: () => permalinkBases(siteData.read()),
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
