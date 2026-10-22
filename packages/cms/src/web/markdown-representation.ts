import type { Context } from 'hono';

import { commentAnchor, commentKeyAt } from '../comments/conversation.ts';
import type { CommentThread } from '../comments/conversation.ts';
import { commentPageHref } from '../content/guids.ts';
import type { Document } from '../content/document.ts';
import type { SearchHit } from '../content/store.ts';
import { rewriteMarkdownLinks } from '../content/markdown-links.ts';
import { decodedPath } from '../content/redirects.ts';
import { isServed } from '../content/served.ts';
import { landing, siteLinkAt } from '../content/site-links.ts';
import { calendarDayIn } from '../content/time.ts';
import { documentFrontMatter, normalizeBody } from '../content/writer.ts';
import type { GeekityEnv } from './env.ts';
import {
  COMMENTS_TITLE_PREFIX,
  FEED_FORMATS,
  commentsFeedPath,
  feedPathUnder,
} from './feed-source.ts';
import type { FeedFormat } from './feed-source.ts';
import { absoluteUrl } from '../util/url.ts';
import { authorContext, siteAuthorContext } from '../site/authors.ts';
import { feedExcerpt } from '../content/excerpt.ts';
import { siteTimezone } from '../theme/site-data.ts';
import type { Archive } from './listing-subject.ts';
import { markdownCommentThread } from './markdown-conversation.ts';
import {
  bioOf,
  entryList,
  escapeMarkdown,
  linkList,
  markdownFile,
  namedAuthor,
  navigationFrontMatter,
  oneLine,
} from './markdown-page.ts';
import type { MarkdownChrome, MarkdownFeed, MarkdownLink, MarkdownUrl } from './markdown-page.ts';
import { representationHref } from './negotiate.ts';
import type { Pagination } from './pagination.ts';
import { classifyPath } from './paths.ts';
import { documentLabel, encodePath } from './request.ts';
import { SEARCH_PATH, snippetMarkdown } from './search.ts';
import { servedPath, siteView } from './site-view.ts';

/**
 * A document's Markdown at `url`, which is its permalink everywhere but the
 * front page. The front matter says where it is served; everything the page
 * lists about the document, such as its comments feed, is the stored one's.
 */
export function documentMarkdown(c: Context<GeekityEnv>, document: Document, url: string): string {
  const writer = authorContext(siteView(c).users(), document.author);
  const neighbours = document.type === 'post' ? c.var.store.neighbours(document) : {};
  const link = (neighbour: Document | undefined): MarkdownLink | undefined =>
    neighbour === undefined
      ? undefined
      : { label: documentLabel(c, neighbour), url: neighbour.permalink };

  const title = oneLine(document.title);
  const body = normalizeBody(document.body);
  const siteTitle = c.var.renderer.site().title;
  const chrome: MarkdownChrome = {
    url,
    type: document.type,
    title: title === '' || /^#[ \t]/.test(body.trimStart()) ? undefined : title,
    previous: link(neighbours.previous),
    next: link(neighbours.next),
    byline:
      document.type === 'post' && writer?.url !== undefined
        ? { label: writer.name, url: writer.url }
        : undefined,
    feeds: [
      ...siteFeeds(siteTitle),
      ...(isServed(document, c.var.store.now())
        ? [
            feed(
              'rss',
              `${COMMENTS_TITLE_PREFIX}${documentLabel(c, document)}`,
              commentsFeedPath(document.permalink),
            ),
          ]
        : []),
    ],
  };

  return markdownPage(
    c,
    namedAuthor(documentFrontMatter({ ...document, permalink: url }), writer),
    chrome,
    [rewriteMarkdownLinks(body, markdownHrefFor(c, url))],
    { frontPage: url === '/' ? document : undefined, document },
  );
}

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
  const ownFeeds = archive.feedHref('rss') === feedPathUnder('/', 'rss') ? [] : FEED_FORMATS;
  const chrome: MarkdownChrome = {
    url,
    type: 'listing',
    title: page.title,
    previous: newer,
    next: older,
    bio: bioOf(archive.author),
    feeds: [
      ...siteFeeds(site.title),
      ...ownFeeds.map((format) => feed(format, archive.feedTitle(site), archive.feedHref(format))),
    ],
  };
  const entries = page.documents.map((document) => ({
    label: documentLabel(c, document),
    url: servedPath(document, home),
    date: document.date === undefined ? undefined : calendarDayIn(document.date, timezone),
    description: document.description,
  }));
  const pager = [newer, older].filter((link) => link !== undefined);
  const { document } = archive.context;

  return markdownPage(c, { title: page.title, permalink: url }, chrome, [
    description === '' ? '' : `> ${description}`,
    document === undefined
      ? ''
      : rewriteMarkdownLinks(normalizeBody(document.body), markdownHrefFor(c, document.permalink)),
    entries.length === 0 ? '' : `## Posts\n\n${entryList(entries, markdownUrl)}`,
    pager.length === 0 ? '' : `## More posts\n\n${linkList(pager, markdownUrl)}`,
  ]);
}

/**
 * A native comment's page in Markdown: the post and the comments it answers
 * above it, its own words as the body, and its replies below.
 */
export function commentMarkdown(c: Context<GeekityEnv>, found: CommentThread): string {
  const { post, comment } = found;
  const url = commentPageHref(comment.key);
  const users = siteView(c).users();
  const site = c.var.renderer.site();
  const label = documentLabel(c, post);
  const by = authorContext(users, post.author) ?? siteAuthorContext(users, site.author);
  const thread = markdownCommentThread(
    found,
    {
      label,
      url: post.permalink,
      author: by === undefined ? undefined : { label: by.name, url: by.url },
      date: post.date,
      summary: feedExcerpt(post),
    },
    `${post.permalink}#${commentAnchor(comment.key)}`,
  );
  const chrome: MarkdownChrome = {
    url,
    type: 'comment',
    title: `Comment by ${comment.author.name} on ${label}`,
    feeds: siteFeeds(site.title),
    thread,
  };

  return markdownPage(
    c,
    {
      title: `${comment.author.name} on ${label}`,
      permalink: url,
      author: comment.author.name,
      date: comment.published,
    },
    chrome,
    [thread.comment.text],
  );
}

/**
 * One page of search results in the listing's shape: what was asked and how
 * much was found, the results with their snippets, and the pager. Every link
 * to another page of the results keeps the query.
 */
export function searchMarkdown(
  c: Context<GeekityEnv>,
  page: { href: string; query: string; pagination: Pagination; hits: readonly SearchHit[] },
): string {
  const { query, pagination } = page;
  const { next, previous } = pagination.href;
  const home = siteView(c).pages.home;
  const site = c.var.renderer.site();
  const timezone = siteTimezone(site);
  const markdownUrl = markdownUrlFor(c, SEARCH_PATH);
  const title =
    query === ''
      ? 'Search'
      : `Search results for “${query}”${pagination.pageNumber > 0 ? `, page ${String(pagination.pageNumber + 1)}` : ''}`;

  const newer = previous === null ? undefined : { label: 'Previous results', url: previous };
  const older = next === null ? undefined : { label: 'More results', url: next };
  const chrome: MarkdownChrome = {
    url: SEARCH_PATH,
    type: 'listing',
    title,
    previous: newer,
    next: older,
    feeds: siteFeeds(site.title),
  };
  const asked = `“${escapeMarkdown(query)}”`;
  const summary =
    query === ''
      ? 'Search this site by adding `?q=` and the words to this URL.'
      : pagination.total === 0
        ? `Nothing found for ${asked}.`
        : `${pagination.total === 1 ? 'One result' : `${String(pagination.total)} results`} for ${asked}.`;
  const entries = page.hits.map(({ document, snippet }) => ({
    label: documentLabel(c, document),
    url: servedPath(document, home),
    date: document.date === undefined ? undefined : calendarDayIn(document.date, timezone),
    description: snippetMarkdown(snippet),
  }));
  const pager = [newer, older].filter((link) => link !== undefined);

  return markdownPage(
    c,
    { title, permalink: page.href, ...(query === '' ? {} : { query }) },
    chrome,
    [
      summary,
      entries.length === 0 ? '' : `## Results\n\n${entryList(entries, markdownUrl)}`,
      pager.length === 0 ? '' : `## More results\n\n${linkList(pager, markdownUrl)}`,
    ],
  );
}

const FEED_NAMES: Readonly<Record<FeedFormat, Pick<MarkdownFeed, 'format' | 'type'>>> = {
  rss: { format: 'RSS', type: 'application/rss+xml' },
  atom: { format: 'Atom', type: 'application/atom+xml' },
  json: { format: 'JSON Feed', type: 'application/feed+json' },
};

function feed(format: FeedFormat, label: string, url: string): MarkdownFeed {
  return { label, url, ...FEED_NAMES[format] };
}

/** The feeds every page's head advertises: the site's posts in each format, and its comments. */
function siteFeeds(siteTitle: string): MarkdownFeed[] {
  return [
    ...FEED_FORMATS.map((format) => feed(format, siteTitle, feedPathUnder('/', format))),
    feed('rss', `${siteTitle} comments`, commentsFeedPath()),
  ];
}

function markdownPage(
  c: Context<GeekityEnv>,
  frontMatter: Record<string, unknown>,
  chrome: MarkdownChrome,
  blocks: readonly string[],
  pages: { frontPage?: Document | undefined; document?: Document | undefined } = {},
): string {
  const markdownUrl = markdownUrlFor(c, chrome.url);
  const { header, footer } = c.var.renderer.renderMarkdownChrome(chrome, {
    markdownUrl,
    ...pages,
  });
  return markdownFile({ ...frontMatter, ...navigationFrontMatter(chrome, markdownUrl) }, [
    header,
    ...blocks,
    footer,
  ]);
}

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
 * kept, and so is the query of a link to the search.
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
    if (directory === SEARCH_PATH) return SEARCH_PATH;
    const key = commentKeyAt(directory);
    if (key !== undefined) return hasCommentPage(c, key) ? directory : undefined;
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
    const target = URL.parse(href, page);
    const query = served === SEARCH_PATH ? (target?.search ?? '') : '';
    return `${representationHref(`${pathname}${query}`, 'markdown')}${target?.hash ?? ''}`;
  };
}

/**
 * Whether a native comment has a page a reader can open: an approved comment
 * left through the form on a post that is served. Read from the comment's own
 * record, so a page with a hundred replies does not read its thread a hundred
 * times over.
 */
function hasCommentPage(c: Context<GeekityEnv>, key: string): boolean {
  const stored = c.var.admin.getComment(key);
  if (stored?.source !== 'comment' || stored.status !== 'approved') return false;
  const post = c.var.store.getBySlug(stored.slug);
  return post !== undefined && isServed(post, c.var.store.now());
}
