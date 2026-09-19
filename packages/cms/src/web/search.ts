import { SNIPPET_CLOSE, SNIPPET_OPEN } from '../content/search.ts';
import type { SearchHit } from '../content/store.ts';
import { documentJson, JSON_SCHEMA_VERSION, representationHref } from './negotiate.ts';
import type { DocumentJson, Representation } from './negotiate.ts';
import type { Pagination } from './pagination.ts';

/**
 * The site's search (TASK-22): where it lives, how its URLs are spelled, and
 * what a hit looks like once it leaves the index.
 *
 * The page is a route at a fixed path rather than a document, for the reason
 * the feeds are: a search form in every theme's footer has to post somewhere
 * no permalink can take. The query travels in the URL, so a search is a link
 * a reader can bookmark or share and the page needs no JavaScript.
 */

/** Where the search page is. A document permalinked here is shadowed by it. */
export const SEARCH_PATH = '/search/';

/** The query-string key the words go in, which is what every search form sends. */
export const SEARCH_QUERY_PARAM = 'q';

/** The query-string key a page of results after the first goes in, one-based. */
export const SEARCH_PAGE_PARAM = 'page';

/** The longest query read. Past this it is not a search, it is a post pasted into the box. */
export const MAXIMUM_QUERY_LENGTH = 256;

/**
 * The URL of one page of the results for a query, in one representation.
 *
 * The first page carries no page number, so the form's own submission and the
 * pager's link back to it are the same URL. An empty query is the page with
 * the form and nothing else, at the bare path.
 */
export function searchHref(query: string, index: number, representation?: Representation): string {
  const params = new URLSearchParams();
  if (query !== '') params.set(SEARCH_QUERY_PARAM, query);
  if (index > 0) params.set(SEARCH_PAGE_PARAM, String(index + 1));
  const search = params.toString();
  const path =
    representation === undefined ? SEARCH_PATH : representationHref(SEARCH_PATH, representation);
  return search === '' ? path : `${path}?${search}`;
}

/**
 * The query a request asked for: trimmed, cut to {@link MAXIMUM_QUERY_LENGTH}
 * and empty when there is none.
 */
export function searchQuery(raw: string | undefined): string {
  return (raw ?? '').trim().slice(0, MAXIMUM_QUERY_LENGTH);
}

/**
 * The zero-based page a `?page=` asked for, or `undefined` when it names no
 * page at all. Missing is the first page.
 */
export function searchPageIndex(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return 0;
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const requested = Number(raw);
  return requested < 1 ? undefined : requested - 1;
}

/**
 * A snippet as HTML: escaped first, and only then are the index's marks turned
 * into `<mark>`, so the words of a post about markup are printed as words.
 */
export function snippetHtml(snippet: string): string {
  return escapeHtml(snippet)
    .replaceAll(SNIPPET_OPEN, '<mark>')
    .replaceAll(SNIPPET_CLOSE, '</mark>');
}

/** One hit as JSON: the document's own JSON summary, and where it matched. */
export interface SearchResultJson extends DocumentJson {
  /** {@link snippetHtml} of the passage the words were found in. */
  snippet: string;
}

/** The JSON representation of a page of results. */
export interface SearchJson {
  /** {@link JSON_SCHEMA_VERSION}. */
  schema: number;
  /** The query as the page read it. */
  query: string;
  /** Where this page sits among all the results. */
  pagination: Omit<Pagination, 'pages'>;
  /** The documents on this page, best match first. */
  results: SearchResultJson[];
}

/** How to build a {@link SearchJson}. */
export interface SearchJsonOptions {
  query: string;
  hits: readonly SearchHit[];
  pagination: Pagination;
  baseUrl: string;
  /** Whether each result carries its Markdown and HTML, as `?full` asks. */
  body: boolean;
}

/**
 * A page of results as JSON.
 *
 * An object rather than the bare array a listing is, because a search result
 * is meaningless without the query that found it and a count of how many more
 * there are. `pages` is left out of the pagination: one URL per page of a
 * search that matched everything is a long list to hand a client that only
 * wanted the next one.
 */
export function searchJson(options: SearchJsonOptions): SearchJson {
  const { pages: _pages, ...pagination } = options.pagination;
  return {
    schema: JSON_SCHEMA_VERSION,
    query: options.query,
    pagination,
    results: options.hits.map((hit) => ({
      ...documentJson(hit.document, { baseUrl: options.baseUrl, body: options.body }),
      snippet: snippetHtml(hit.snippet),
    })),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
