import type { Document } from '../content/document.ts';
import type { ListOptions } from '../content/store.ts';
import { authorFeedHref, authorHref, profileContext } from './authors.ts';
import type { AuthorContext } from './authors.ts';
import type { SiteData } from './context.ts';
import { feedPathUnder } from './feeds.ts';
import type { FeedFormat } from './feeds.ts';
import { TEMPLATES } from './render.ts';
import type { Listing } from './render.ts';
import type { AuthorListing, FrontPages, SiteView } from './site-view.ts';
import { PAGE_SEGMENT, termHref } from './taxonomy.ts';
import type { TaxonomyBases, TaxonomyTerm } from './taxonomy.ts';

/**
 * What a listing is over: the site's posts, one taxonomy term, or one person.
 *
 * The site's posts live at `/`, or under the posts page on a site whose
 * Reading setting names one.
 */
export type ListingSubject =
  | { kind: 'home'; postsPage: Document | undefined }
  | { kind: 'term'; term: TaxonomyTerm }
  | { kind: 'author'; author: AuthorListing };

/** Which page of which listing a request is for. */
export interface ListingRequest {
  subject: ListingSubject;
  /** Zero-based index of the page. */
  pageNumber: number;
}

/** The site's own posts, at `/` rather than under any posts page. */
export const SITE_POSTS: ListingSubject = { kind: 'home', postsPage: undefined };

/** What the theme is told about one listing, beyond its page and its posts. */
type ListingContext = Pick<Listing, 'tag' | 'category' | 'author' | 'template' | 'document'>;

/** Everything that differs between the kinds of listing, answered in one place. */
export interface Archive {
  /** How many published documents the listing holds. */
  count: () => number;
  /** One page of its documents, newest first, or all of them. */
  list: (paging?: ListOptions) => Document[];
  /** The URL of one of its pages, by zero-based index. */
  href: (index: number) => string;
  /** The URL of one format of its feed. */
  feedHref: (format: FeedFormat) => string;
  /** The heading of one of its pages. */
  pageTitle: (site: SiteData) => string;
  /** What its feed calls itself, so a reader of several of a site's feeds can tell them apart. */
  feedTitle: (site: SiteData) => string;
  /** The line under the heading of its Markdown. */
  description: (site: SiteData) => string;
  /** Whose archive it is, for the bio its Markdown carries. */
  author: AuthorContext | undefined;
  /** The theme's context for it. */
  context: ListingContext;
}

export function archiveOf(
  view: Pick<SiteView, 'store' | 'bases'>,
  subject: ListingSubject,
): Archive {
  const { store, bases } = view;

  if (subject.kind === 'home') {
    const { postsPage } = subject;
    const root = postsPage?.permalink ?? '/';
    return {
      count: () => store.counts().posts,
      list: (paging) => store.listPosts(paging),
      href: (index) => listingPageHref(root, index),
      // The feeds stay at the root wherever the listing is: a subscriber's URL
      // is the one they already hold.
      feedHref: (format) => feedPathUnder('/', format),
      pageTitle: (site) => postsPage?.title || site.title,
      feedTitle: (site) => site.title,
      description: (site) => postsPage?.description ?? site.tagline ?? '',
      author: undefined,
      // Its words go above the posts, which is what a posts page is for: a
      // theme prints `{{ content | safe }}` over the list.
      context: postsPage === undefined ? {} : { document: postsPage },
    };
  }

  const about = (name: string): Pick<Archive, 'pageTitle' | 'feedTitle'> => ({
    pageTitle: () => name,
    feedTitle: (site) => `${site.title}: ${name}`,
  });

  if (subject.kind === 'term') {
    const { term } = subject;
    return {
      count: () =>
        term.taxonomy === 'tag' ? store.countByTag(term.term) : store.countByCategory(term.term),
      list: (paging) =>
        term.taxonomy === 'tag'
          ? store.listByTag(term.term, paging)
          : store.listByCategory(term.term, paging),
      href: (index) => termHref(term, index, bases),
      feedHref: (format) => feedPathUnder(termHref(term, 0, bases), format),
      ...about(term.term),
      description: () => '',
      author: undefined,
      context:
        term.taxonomy === 'tag'
          ? { tag: term.term, template: TEMPLATES.tag }
          : { category: term.term, template: TEMPLATES.category },
    };
  }

  // One shape for a byline and for the heading of the archive it links to, so
  // a theme that can print one can print the other.
  const { user, names } = subject.author;
  const profile = profileContext(user);
  return {
    count: () => store.countByAuthor(names),
    list: (paging) => store.listByAuthor(names, paging),
    href: (index) => authorHref(user.username, index),
    feedHref: (format) => authorFeedHref(user.username, format),
    ...about(user.profile?.displayName ?? user.username),
    description: () => '',
    author: profile,
    context: { author: profile, template: TEMPLATES.author },
  };
}

/**
 * The home listing as the Reading setting places it: at `/` for a site showing
 * its latest posts, under the posts page on a site that names one, and nowhere
 * on a site whose homepage is a page and which named no posts page.
 */
export function homeListing(pages: FrontPages): ListingSubject | undefined {
  if (pages.home === undefined) return SITE_POSTS;
  return pages.posts === undefined ? undefined : { kind: 'home', postsPage: pages.posts };
}

/** The URL of a page of the home listing, by zero-based index. */
export function homeHref(index: number): string {
  return listingPageHref('/', index);
}

/**
 * The URL of a page of the listing that hangs off `root`, by zero-based index.
 *
 * The first page is the root itself: `/` or the posts page's own permalink,
 * which is what makes a posts page one URL rather than two.
 */
export function listingPageHref(root: string, index: number): string {
  return index === 0 ? root : `${root}${PAGE_SEGMENT}/${String(index + 1)}/`;
}

/**
 * The URL of a feed: the whole site's, or one taxonomy archive's.
 *
 * WordPress's layout, so a subscriber of a migrated site keeps polling the URL
 * they already hold: `/feed/` is RSS 2.0, `/feed/atom/` and `/feed/json/` are
 * its siblings, and an archive's feeds hang off the archive.
 */
export function feedHref(
  term: TaxonomyTerm | undefined,
  format: FeedFormat,
  bases: TaxonomyBases,
): string {
  return feedPathUnder(term === undefined ? '/' : termHref(term, 0, bases), format);
}
