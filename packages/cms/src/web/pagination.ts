/**
 * Where one listing page sits in the sequence.
 *
 * `pageNumber` is zero-based, as it is in Eleventy, so a layout ported from an
 * Eleventy build does the same arithmetic. `href` holds the URLs a pager needs;
 * `next` and `previous` are `null` at the ends rather than absent, which is
 * what Eleventy does and what `{% if pagination.href.next %}` expects.
 */
export interface Pagination {
  /** Zero-based index of this page. */
  pageNumber: number;
  /** How many pages the listing has. At least 1, even when it is empty. */
  totalPages: number;
  /** How many documents the whole listing holds. */
  total: number;
  /** How many documents fit on a page. */
  size: number;
  /** Where the pager links. */
  href: {
    first: string;
    last: string;
    next: string | null;
    previous: string | null;
  };
  /** Every page's URL, in order, so a template can render a numbered pager. */
  pages: string[];
}

/** What {@link paginate} needs to place a page. */
export interface PaginateOptions {
  /** How many documents the listing holds in total. */
  total: number;
  /** How many fit on a page. Values below 1 are treated as 1. */
  size: number;
  /** Zero-based index of the page being rendered. */
  pageNumber: number;
  /** The URL of a page, by zero-based index. */
  hrefForPage: (index: number) => string;
}

/** How many documents to skip to reach a page. */
export function offsetForPage(pageNumber: number, size: number): number {
  return pageNumber * Math.max(1, size);
}

/**
 * The page count and the pager URLs for a listing.
 *
 * An empty listing still has one page, so the home page of a site with no
 * posts renders normally instead of 404ing.
 */
export function paginate(options: PaginateOptions): Pagination {
  const size = Math.max(1, options.size);
  const totalPages = Math.max(1, Math.ceil(options.total / size));
  const pageNumber = options.pageNumber;
  const pages = Array.from({ length: totalPages }, (_, index) => options.hrefForPage(index));

  return {
    pageNumber,
    totalPages,
    total: options.total,
    size,
    href: {
      first: options.hrefForPage(0),
      last: options.hrefForPage(totalPages - 1),
      next: pageNumber + 1 < totalPages ? options.hrefForPage(pageNumber + 1) : null,
      previous: pageNumber > 0 ? options.hrefForPage(pageNumber - 1) : null,
    },
    pages,
  };
}
