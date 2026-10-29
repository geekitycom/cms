import type { Context } from 'hono';

import type { Document, DocumentType } from '../content/document.ts';
import { isListed } from '../content/served.ts';
import { calendarDayIn } from '../content/time.ts';
import type { GeekityEnv } from './env.ts';
import { capsuleUrl } from '../gemini/capsule.ts';
import { absoluteUrl } from '../util/url.ts';
import { siteTimezone } from '../theme/site-data.ts';
import { feedExcerpt } from '../content/excerpt.ts';
import { archiveOf, homeListing } from './listing-subject.ts';
import type { ListingSubject } from './listing-subject.ts';
import { generatedLlmsTxt, llmsTxtResponse, ownLlmsTxt } from './llms.ts';
import type { LlmsEntry, LlmsIndex } from './llms.ts';
import { siteUrlFor } from './markdown-representation.ts';
import { navigationLinks } from '../site/navigation.ts';
import { lastModifiedOf, latestModified } from './negotiate.ts';
import { pageCount } from './pagination.ts';
import { conditionalHeaders, documentLabel, encodePath } from './request.ts';
import { notFound } from './status-pages.ts';
import { servedPath, siteView } from './site-view.ts';
import { sitemapResponse } from './sitemap.ts';
import { wikiIndexHref } from './wiki-index.ts';
import type { SitemapUrl } from './sitemap.ts';

/**
 * The sitemap, or one of its children once the site is too big for one file.
 *
 * A child that does not exist 404s through the theme like any other missing
 * URL: `/sitemap-1.xml` names nothing at all on a site whose whole sitemap
 * fits, and a crawler asking for one should be told so rather than handed an
 * empty file it would come back to.
 */
export function sitemap(c: Context<GeekityEnv>, page: number | undefined): Response {
  const response = sitemapResponse({
    urls: sitemapUrls(c),
    baseUrl: c.var.config.baseUrl,
    page,
    conditional: conditionalHeaders(c),
  });
  return response ?? notFound(c);
}

export function llmsTxt(c: Context<GeekityEnv>): Response {
  const { contentDir, baseUrl } = c.var.config;
  if (!c.var.siteAtRequestStart.llms_txt) return notFound(c);
  const file =
    ownLlmsTxt(contentDir) ??
    generatedLlmsTxt(llmsIndex(c), baseUrl, siteUrlFor(c, '/', 'markdown'));
  return llmsTxtResponse(file, conditionalHeaders(c));
}

/**
 * Every URL the public site publishes, in the order the sitemap lists them:
 * the home archive's pages, then every post, page and wiki page, the wiki index, then every tag archive
 * and every category archive with their own pages.
 */
function sitemapUrls(c: Context<GeekityEnv>): SitemapUrl[] {
  const view = siteView(c);
  const { store, pages } = view;
  const size = c.var.renderer.pageSize();
  const urls: SitemapUrl[] = [];

  /** The pages of one listing, each dated by the newest document on it. */
  const listingPages = (subject: ListingSubject, documents: readonly Document[]): void => {
    const archive = archiveOf(view, subject);
    const totalPages = pageCount(documents.length, size);
    for (let index = 0; index < totalPages; index += 1) {
      const onPage = documents.slice(index * size, (index + 1) * size);
      urls.push({ loc: archive.href(index), lastmod: latestModified(onPage) });
    }
  };

  const { posts, pages: documents, wiki } = listedDocuments(c);

  // The listing's pages, wherever it lives: under `/`, under the posts page,
  // or nowhere at all on a site whose homepage is a page and which named no
  // posts page. Its first page is that root, which is why `/` and the posts
  // page's own URL are listed here rather than with the documents.
  const home = homeListing(pages);
  if (home !== undefined) listingPages(home, posts);

  // And `/` itself when it is a page rather than the listing: the front page
  // is published at one URL, and it is this one.
  if (pages.home !== undefined) urls.push({ loc: '/', lastmod: lastModifiedOf(pages.home) });

  for (const document of [...posts, ...documents, ...wiki]) {
    // The homepage answers at `/` and redirects from its own permalink, and
    // the posts page is the listing's first page, which is already listed:
    // neither is advertised twice.
    if (document.path === pages.home?.path || document.path === pages.posts?.path) continue;
    urls.push({ loc: document.permalink, lastmod: lastModifiedOf(document) });
  }

  // The wiki index exists while a wiki page is listed, and is dated by the
  // newest change to any of them.
  if (wiki.length > 0) urls.push({ loc: wikiIndexHref(view.bases), lastmod: latestModified(wiki) });

  // A taxonomy archive exists only while something public carries the term,
  // which is exactly what these two queries report.
  const terms: ListingSubject[] = [
    ...store.listTags().map(({ tag }): ListingSubject => ({
      kind: 'term',
      term: { taxonomy: 'tag', term: tag },
    })),
    ...store.listCategories().map(({ category }): ListingSubject => ({
      kind: 'term',
      term: { taxonomy: 'category', term: category },
    })),
  ];
  for (const term of terms) listingPages(term, archiveOf(view, term).list());

  return urls;
}

/**
 * Every post, page and wiki page the public site lists, posts newest first,
 * read in one query: what the sitemap and `/llms.txt` both publish, so the two cannot
 * disagree. The index's query already excludes drafts, the trash, documents
 * whose date has not arrived and unlisted or private ones; {@link isListed} is
 * asked again with the store's own clock so the two answers cannot drift apart.
 */
function listedDocuments(c: Context<GeekityEnv>): Record<'posts' | 'pages' | 'wiki', Document[]> {
  const now = c.var.store.now();
  const listed: Record<DocumentType, Document[]> = { post: [], page: [], wiki: [] };
  for (const document of c.var.store.listListed()) {
    if (!isListed(document, now)) continue;
    listed[document.type].push(document);
  }
  return { posts: listed.post, pages: listed.page, wiki: listed.wiki };
}

/**
 * What a generated `/llms.txt` lists: every listed page by its label, every
 * listed wiki page by its label, then every listed post, newest first, with its date and the summary the feeds
 * carry, each linked to its Markdown.
 *
 * The homepage is listed at `/`, which is where it is published; its own
 * permalink redirects there.
 */
function llmsIndex(c: Context<GeekityEnv>): LlmsIndex {
  const site = c.var.renderer.site();
  const timezone = siteTimezone(site);
  const home = siteView(c).pages.home;
  const { posts, pages, wiki } = listedDocuments(c);

  const entry = (document: Document): LlmsEntry => ({
    title: documentLabel(c, document),
    href: encodePath(servedPath(document, home)),
    description: document.description,
    lastModified: lastModifiedOf(document),
  });

  return {
    title: site.title,
    description: site.tagline ?? '',
    capsule: capsuleUrl(
      c.var.config,
      c.var.siteAtRequestStart,
      new URL(absoluteUrl('/', c.var.config.baseUrl)).pathname,
    ),
    navigation: navigationLinks(site).map((item) => ({ title: item.label, href: item.url })),
    pages: pages.map(entry).sort((a, b) => a.title.localeCompare(b.title)),
    wiki: wiki.map(entry).sort((a, b) => a.title.localeCompare(b.title)),
    posts: posts.map((document) => ({
      ...entry(document),
      date: document.date === undefined ? undefined : calendarDayIn(document.date, timezone),
      description: feedExcerpt(document),
    })),
  };
}
