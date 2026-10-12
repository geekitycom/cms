import type { Context } from 'hono';

import type { Document } from '../content/document.ts';
import { rewriteMarkdownLinks } from '../content/markdown-links.ts';
import { calendarDayIn } from '../content/time.ts';
import { documentFrontMatter, normalizeBody } from '../content/writer.ts';
import type { GeekityEnv } from '../env.ts';
import { absoluteUrl } from '../util/url.ts';
import { landing, siteLinkAt } from '../webmention/links.ts';
import { authorContext } from './authors.ts';
import { siteTimezone } from './context.ts';
import { isServed } from './documents.ts';
import type { Archive } from './listing-subject.ts';
import {
  bioOf,
  entryList,
  linkList,
  markdownFile,
  namedAuthor,
  navigationFrontMatter,
  oneLine,
} from './markdown-page.ts';
import type { MarkdownChrome, MarkdownLink, MarkdownUrl } from './markdown-page.ts';
import { representationHref } from './negotiate.ts';
import type { Pagination } from './pagination.ts';
import { classifyPath } from './paths.ts';
import { decodedPath } from './redirects.ts';
import { documentLabel, encodePath } from './request.ts';
import { servedPath, siteView } from './site-view.ts';

/** One document as the Markdown file a reader or a model is handed. */
export function documentMarkdown(c: Context<GeekityEnv>, document: Document): string {
  const writer = authorContext(siteView(c).users(), document.author);
  const neighbours = document.type === 'post' ? c.var.store.neighbours(document) : {};
  const link = (neighbour: Document | undefined): MarkdownLink | undefined =>
    neighbour === undefined
      ? undefined
      : { label: documentLabel(c, neighbour), url: neighbour.permalink };

  const title = oneLine(document.title);
  const body = normalizeBody(document.body);
  const chrome: MarkdownChrome = {
    url: document.permalink,
    title: title === '' || /^#[ \t]/.test(body.trimStart()) ? undefined : title,
    previous: link(neighbours.previous),
    next: link(neighbours.next),
    byline:
      document.type === 'post' && writer?.url !== undefined
        ? { label: writer.name, url: writer.url }
        : undefined,
  };

  return markdownPage(
    c,
    namedAuthor(documentFrontMatter(document), writer),
    chrome,
    [rewriteMarkdownLinks(body, markdownHrefFor(c, document.permalink))],
    document.permalink === '/' ? document : undefined,
  );
}

/** One page of a listing as Markdown: its description, its posts and its pager. */
export function listingMarkdown(
  c: Context<GeekityEnv>,
  archive: Archive,
  page: { href: string; title: string; pagination: Pagination; documents: readonly Document[] },
): string {
  const { next, previous } = page.pagination.href;
  const home = siteView(c).pages.home;
  const site = c.var.renderer.site();
  const description = oneLine(archive.description(site));
  const timezone = siteTimezone(site);
  const url = decodedPath(page.href);
  const markdownUrl = markdownUrlFor(c, url);

  const newer = previous === null ? undefined : { label: 'Newer posts', url: previous };
  const older = next === null ? undefined : { label: 'Older posts', url: next };
  const chrome: MarkdownChrome = {
    url,
    title: page.title,
    previous: newer,
    next: older,
    bio: bioOf(archive.author),
  };
  const entries = page.documents.map((document) => ({
    label: documentLabel(c, document),
    url: servedPath(document, home),
    date: document.date === undefined ? undefined : calendarDayIn(document.date, timezone),
    description: document.description,
  }));
  const pager = [newer, older].filter((link) => link !== undefined);

  return markdownPage(c, { title: page.title, permalink: url }, chrome, [
    description === '' ? '' : `> ${description}`,
    entries.length === 0 ? '' : `## Posts\n\n${entryList(entries, markdownUrl)}`,
    pager.length === 0 ? '' : `## More posts\n\n${linkList(pager, markdownUrl)}`,
  ]);
}

function markdownPage(
  c: Context<GeekityEnv>,
  frontMatter: Record<string, unknown>,
  chrome: MarkdownChrome,
  blocks: readonly string[],
  frontPage?: Document,
): string {
  const markdownUrl = markdownUrlFor(c, chrome.url);
  const { header, footer } = c.var.renderer.renderMarkdownChrome(chrome, {
    markdownUrl,
    frontPage,
  });
  return markdownFile({ ...frontMatter, ...navigationFrontMatter(chrome, markdownUrl) }, [
    header,
    ...blocks,
    footer,
  ]);
}

/** {@link markdownHrefFor}, keeping a link that names nothing as it was. */
export function markdownUrlFor(c: Context<GeekityEnv>, pageUrl: string): MarkdownUrl {
  const href = markdownHrefFor(c, pageUrl);
  return (url) => href(url) ?? url;
}

/**
 * A link on the page at `pageUrl` as the Markdown URL of what it names, or
 * `undefined` when it names nothing on this site with a Markdown
 * representation.
 *
 * The link is followed the way the site answers a request for it: a query
 * redirect, then whatever is served at the path, then a moved document, then
 * a declared redirect, so `/?p=7`, a `redirect_from` and the homepage's own
 * permalink all land on the `.md` of the document they reach. A fragment is
 * kept.
 */
function markdownHrefFor(
  c: Context<GeekityEnv>,
  pageUrl: string,
): (href: string) => string | undefined {
  const { config } = c.var;
  const view = siteView(c);
  const { store } = view;
  const table = c.var.redirects.current();
  const page = absoluteUrl(pageUrl, config.baseUrl);

  const servedAt = (sitePath: string): string | undefined => {
    if (sitePath === '/') return '/';
    const directory = sitePath.endsWith('/') ? sitePath : `${sitePath}/`;
    const candidates = [directory, sitePath];
    for (const candidate of candidates) {
      const match = classifyPath(view, candidate);
      if (match?.kind === 'document') return servedPath(match.document, view.pages.home);
      if (match?.kind === 'listing') return candidate;
    }
    for (const candidate of candidates) {
      const moved = store.getByFormerPermalink(candidate);
      if (moved !== undefined && isServed(moved, store.now())) {
        return servedPath(moved, view.pages.home);
      }
    }
    return undefined;
  };

  return (href) => {
    const link = siteLinkAt(href, page, config.baseUrl);
    if (link === undefined) return undefined;
    const landed = landing(table, link, (sitePath) => servedAt(sitePath) !== undefined);
    const served = landed === undefined ? undefined : servedAt(landed);
    if (served === undefined) return undefined;
    const { pathname } = new URL(absoluteUrl(encodePath(served), config.baseUrl));
    const hash = URL.parse(href, page)?.hash ?? '';
    return `${representationHref(pathname, 'markdown')}${hash}`;
  };
}
