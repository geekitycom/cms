import type { Document } from '../content/document.ts';
import type { ListOptions } from '../content/store.ts';
import { authorFeedHref } from './feed-source.ts';
import { authorHref } from '../content/authors.ts';
import { profileContext } from '../site/authors.ts';
import type { AuthorContext } from '../site/authors.ts';
import type { SiteData } from '../theme/site-data.ts';
import { feedPathUnder } from './feeds.ts';
import type { FeedFormat } from './feeds.ts';
import { TEMPLATES } from './theme-templates.ts';
import type { Listing } from './render.ts';
import type { AuthorListing, FrontPages, SiteView } from './site-view.ts';
import { PAGE_SEGMENT, termHref } from '../content/taxonomy.ts';
import type { TaxonomyBases, TaxonomyTerm } from '../content/taxonomy.ts';

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

export const SITE_POSTS: ListingSubject = { kind: 'home', postsPage: undefined };

type ListingContext = Pick<Listing, 'tag' | 'category' | 'author' | 'template' | 'document'>;

export interface Archive {
  count: () => number;
  list: (paging?: ListOptions) => Document[];
  href: (index: number) => string;
  feedHref: (format: FeedFormat) => string;
  pageTitle: (site: SiteData) => string;
  feedTitle: (site: SiteData) => string;
  description: (site: SiteData) => string;
  author: AuthorContext | undefined;
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
