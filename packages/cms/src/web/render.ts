import type { Environment } from 'nunjucks';

import type { User } from '../admin/accounts.ts';
import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import { postLabel, replyTarget } from '../content/post-type.ts';
import type { DocumentNeighbours, SearchHit } from '../content/store.ts';
import { siteIcons } from '../images/icons.ts';
import { archiveMonths, archiveOpen } from './archive.ts';
import { authorContext, siteAuthorContext } from './authors.ts';
import type { AuthorContext } from './authors.ts';
import {
  createSiteDataSource,
  documentContext,
  frontPageSlugs,
  postsPerPage,
  siteTimezone,
  taxonomyBases,
  termRedirects,
  themeName,
} from './context.ts';
import type { CommentFormContext, CommentViewer } from '../comments/form.ts';
import type { ContactFormContext } from '../contact/form.ts';
import type { Conversation } from './conversation.ts';
import { activityStreamsId } from './documents.ts';
import { commentsFeedPath } from './feeds.ts';
import type { DocumentContext, FrontPageSlugs, NeighbourContext, SiteData } from './context.ts';
import { navigationMenus } from './navigation.ts';
import type { Pagination } from './pagination.ts';
import { snippetHtml } from './search.ts';
import type { TaxonomyBases, TaxonomyRedirect } from './taxonomy.ts';
import { createTemplateEnvironment, useThemeDirs } from './templates.ts';
import { createThemeSource, findThemeFile } from './themes.ts';
import type { ThemeSource } from './themes.ts';
import type { ReplyContext } from '../webmention/reply-context.ts';
import { webmentionEndpointFor } from '../webmention/routes.ts';

/** Templates the default theme ships and the public routes ask for by name. */
export const TEMPLATES = {
  home: 'layouts/home.njk',
  post: 'layouts/post.njk',
  page: 'layouts/page.njk',
  tag: 'layouts/tag.njk',
  category: 'layouts/category.njk',
  author: 'layouts/author.njk',
  search: 'layouts/search.njk',
  notFound: 'layouts/404.njk',
} as const;

/**
 * The two templates named for the Reading choice, which a theme may write and
 * which fall back to an ordinary layout when it has not.
 *
 * They are WordPress's own `front-page.php` and `home.php`, and they exist for
 * the same reason: a front page is often the one page of a site that looks
 * like nothing else, and saying so should not mean overriding the layout every
 * other page uses. The default theme ships `front-page.njk` (TASK-85) and no
 * posts page layout, so a site that sets a posts page gets the listing layout
 * until it writes one.
 */
export const OPTIONAL_TEMPLATES = {
  /**
   * The front page alone. The default theme ships one (TASK-85), so the
   * fallback is only reached by a theme that replaced it with nothing.
   */
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

/** One page of search results, ready to render (TASK-22). */
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
   * One document through its type's layout.
   *
   * `extra` goes on the context last and so wins: it is how the comment
   * endpoint puts a refused form back on the page it came from, and how the
   * redirect after a submission gets its thank-you onto the post.
   *
   * `viewer` is who the request's session says is reading, when it says
   * anybody (TASK-103). The only thing it changes is the comment form, which
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
   * What is stored about the post a reply answers, by its URL (TASK-123).
   *
   * Read, never fetched: the context was fetched when the reply was saved or
   * synced, so drawing a reply waits on nobody's server. A renderer built
   * without it draws every reply with a bare link.
   */
  replyContext?: ((target: string) => ReplyContext | undefined) | undefined;
  /**
   * The comment form for a post that is taking comments, and `undefined` for
   * one that is not (TASK-50).
   *
   * Injected for the same reason the conversation is, and asked per render for
   * a sharper reason: whether a post is still open depends on the clock, so a
   * form decided at boot would go on being offered for a post that closed an
   * hour ago. A renderer built without it renders no form at all.
   */
  commentForm?:
    ((document: Document, viewer?: CommentViewer) => CommentFormContext | undefined) | undefined;
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
  /**
   * The published posts either side of one, for `previous` and `next` under an
   * entry (TASK-79).
   *
   * Injected for the reason the conversation is — the renderer holds no index
   * — and asked per render rather than at boot, because a post published a
   * minute ago is the neighbour the post before it should already be linking
   * to. A renderer built without it draws no such links, which is what a test
   * over one template wants.
   */
  neighbours?: ((document: Document) => DocumentNeighbours) | undefined;
  /**
   * The newest posts, for `recentPosts` on the front page (TASK-79).
   *
   * Which posts are recent is `web/recent.ts`'s rule and the query behind it
   * is the index's; this is only how the answer reaches a template. Asked per
   * render, and only while drawing the front page, so a site whose `/` is its
   * listing never runs it at all.
   */
  recentPosts?: (() => readonly Document[]) | undefined;
  /**
   * Every published post, for a page whose front matter says `archive: true`
   * (TASK-85).
   *
   * Injected for the reason the recent posts are, and asked per render and
   * only for a page that asked for the list: an archive is the one listing
   * with no paging, so a site with a thousand posts runs the query on the one
   * page that prints a thousand links and on no other.
   */
  archivePosts?: (() => readonly Document[]) | undefined;
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
    // The menus are built here rather than by each caller because every page
    // of the site carries them: a listing, a document, the 404 and the
    // editor's preview all go through here, and a menu that appeared on some
    // of them and not others would be a worse contract than one that is
    // simply always there. It is `menus` rather than `menus` read off `site`
    // because these items know which one the reader is on; a template reading
    // `site.menus` would be reading the raw lists.
    //
    // Every menu the site stores is here, keyed by name, not only the ones the
    // theme declares an area for: a name nothing loops over is rendered
    // nowhere and kept (TASK-107), and the declaration in `theme.json` is for
    // the screen that edits menus rather than a filter on the render.
    const menus = navigationMenus({ site, url: currentUrl(context) });
    // Who the page is by, for the bio, the `rel="me"` links and the structured
    // data (decision-16). It is here rather than in each caller because every
    // page of the site carries it, for the reason the menus do — and it is
    // the site's own author only when the page is about nobody in particular:
    // a document's byline and an author archive's person are put on the
    // context by the callers below, and win by going on last.
    const owner =
      context['siteAuthor'] === undefined ? siteAuthorContext(users(), site.author) : undefined;
    // The site's icons, as the three links a head carries (TASK-81). They are
    // computed here rather than in the layout because only this side knows
    // where a derived file is served and whether the site can derive one at
    // all: a theme that was handed the avatar path would have to build the URL
    // itself and would link three 404s on a site with image optimization off.
    const icons = siteIcons(config, site.avatar);
    return environment.render(template, {
      site,
      menus,
      icons,
      ...(owner === undefined ? {} : { siteAuthor: owner }),
      ...context,
    });
  }

  /**
   * The front page's recent posts, as the entries a listing prints, or nothing
   * at all when the renderer was built without a source for them.
   *
   * One read of the users file for the whole list, the way a listing does it:
   * five posts is five bylines resolved against the same people.
   */
  function recentPostsContext(): Record<string, unknown> {
    const posts = options.recentPosts?.();
    if (posts === undefined) return {};

    const people = users();
    return {
      recentPosts: posts.map((document) =>
        documentContext(document, config, authorContext(people, document.author)),
      ),
    };
  }

  /**
   * The whole archive as the months an archive page heads, or nothing at all
   * for every other document.
   *
   * The front matter key decides, so the list is on the context of exactly the
   * page that asked for it and a layout writes `{% if archiveMonths %}` rather
   * than reading front matter for itself — the way `contactForm` works.
   */
  function archiveContext(document: Document): Record<string, unknown> {
    if (!archiveOpen(document)) return {};
    const posts = options.archivePosts?.();
    if (posts === undefined) return {};

    return { archiveMonths: archiveMonths(posts, siteTimezone(siteData.read())) };
  }

  /**
   * The page whose own URL carries the listing, as the link a front page draws
   * to it, or nothing at all when the site names none.
   *
   * Resolved here rather than by the route because the renderer already holds
   * both halves — the setting and the published pages — and because the link
   * is the front page's alone: everywhere else the posts page is an ordinary
   * item of the site menu.
   */
  function postsPageContext(): Record<string, unknown> {
    const slug = frontPageSlugs(siteData.read()).postsPage;
    if (slug === '') return {};

    const found = pages().find((document) => document.slug === slug);
    return found === undefined ? {} : { postsPage: { title: found.title, url: found.permalink } };
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
    options_: {
      template: string;
      url?: string | undefined;
      extra: Record<string, unknown>;
      viewer?: CommentViewer | undefined;
    },
  ): string {
    const { template, extra } = options_;
    // The profile behind the document's `author`, resolved here rather than in
    // `documentContext` for the reason the object id is: it needs the site's
    // users, which a document on its own does not carry.
    const writer = authorContext(users(), document.author);
    const context = documentContext(document, config, writer);
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
    const form = options.commentForm?.(document, options_.viewer);
    // And the contact form, when the page's front matter asked for one
    // (TASK-56). Nothing about where a message would go is on the context:
    // the address is read when a submission arrives, so a theme cannot
    // print it however it is written.
    const contact = options.contactForm?.(document);
    // Where a webmention about this page is sent (TASK-51). On the context
    // only when the site takes them, so a theme asks `{% if webmention %}`
    // and a site that has turned them off advertises nothing.
    const webmention = webmentionEndpointFor(siteData.read());
    // The posts either side of this one, as the two links a theme draws under
    // an entry (TASK-79). Each is on the context only when there is one, so a
    // theme asks `{% if previous %}` and the ends of the archive draw nothing.
    const either = options.neighbours?.(document) ?? {};
    // What the post a reply answers says about itself, when it was fetched
    // (TASK-123). On the context only when there is some, so a theme draws
    // the bare link from `inReplyTo` and fills it in from `replyContext`.
    const target = replyTarget(document);
    const cited = target === undefined ? undefined : options.replyContext?.(target);

    return render(template, {
      ...context,
      // This page's own person, which is the site's author everywhere else:
      // the byline and the identity a theme prints are one object, so what a
      // reader sees and what the structured data says cannot drift.
      ...(writer === undefined ? {} : { siteAuthor: writer }),
      ...neighbourContext('previous', either.previous),
      ...neighbourContext('next', either.next),
      url,
      page: { ...context.page, url },
      ...(objectId === undefined
        ? {}
        : {
            activityStreams: objectId,
            commentsFeed: commentsFeedPath(document.permalink),
          }),
      // And the whole archive, for a page whose front matter asked for it
      // (TASK-85). On the context only for that page, so a theme asks
      // `{% if archiveMonths %}` exactly as it asks about the contact form.
      ...archiveContext(document),
      ...(said === undefined || said.counts.total === 0 ? {} : { conversation: said }),
      ...(form === undefined ? {} : { commentForm: form }),
      ...(contact === undefined ? {} : { contactForm: contact }),
      ...(webmention === undefined ? {} : { webmention }),
      ...(cited === undefined ? {} : { replyContext: replyContextFor(cited) }),
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

    renderDocument(document, extra = {}, viewer = undefined) {
      return documentPage(document, {
        template: document.type === 'post' ? TEMPLATES.post : TEMPLATES.page,
        extra,
        viewer,
      });
    },

    renderFrontPage(document, extra = {}, viewer = undefined) {
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
        // The newest posts under the page's own words, which is what a front
        // page is for (decision-16). Built here rather than by the route
        // because it is the same document context every listing entry is, and
        // resolved once for the whole list the way a listing's bylines are.
        // `postsPage` goes with them: the front page is the one page that
        // links the listing by name rather than by menu item.
        extra: { ...recentPostsContext(), ...postsPageContext(), ...extra },
        viewer,
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
        // the page's writer rather than whose archive this is. They are also
        // whose page this is, so the identity a theme prints is theirs rather
        // than the site's.
        ...(listing.author === undefined
          ? {}
          : { author: listing.author, siteAuthor: listing.author }),
      });
    },

    renderSearch(search) {
      const people = users();
      const items = search.hits.map((hit) => ({
        ...documentContext(hit.document, config, authorContext(people, hit.document.author)),
        // Escaped here and marked up here, so a theme prints it with `safe`
        // and cannot get the order of the two wrong.
        snippet: snippetHtml(hit.snippet),
      }));

      return render(TEMPLATES.search, {
        title: search.query === '' ? 'Search' : `Search results for “${search.query}”`,
        url: search.url,
        page: { url: search.url },
        // The words as the reader typed them, for the form to put back in the
        // box and the heading to repeat. Autoescaped like any other string.
        query: search.query,
        posts: items,
        pagination: { ...search.pagination, items },
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
 * One neighbour under the name a theme reads it by, or nothing at all when
 * there is no post on that side.
 *
 * The title and the URL and no more: a link is what it says and where it goes,
 * and handing a theme a second document context would be handing it a second
 * post to print by accident.
 */
function neighbourContext(
  key: 'previous' | 'next',
  document: Document | undefined,
): Record<string, NeighbourContext> | object {
  if (document === undefined) return {};
  return { [key]: { title: postLabel(document), url: document.permalink } };
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

/**
 * A stored reply context as a theme reads it: the published instant as a
 * `Date`, so the `date` filter prints it in the site's zone like any other.
 */
function replyContextFor(context: ReplyContext): Record<string, unknown> {
  const published = context.published === undefined ? undefined : new Date(context.published);
  const { published: _published, ...rest } = context;
  return published === undefined || Number.isNaN(published.getTime())
    ? rest
    : { ...rest, published };
}
