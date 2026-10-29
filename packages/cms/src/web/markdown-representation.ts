import { randomUUID } from 'node:crypto';

import { convert } from '@geekity/md2gemini';
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
import { commentedPost } from './conversation-lookup.ts';
import { markdownCommentThread } from './markdown-conversation.ts';
import {
  bioOf,
  entryList,
  escapeMarkdown,
  HOME_LINK,
  linkList,
  markdownFile,
  namedAuthor,
  navigationFrontMatter,
  oneLine,
} from './markdown-page.ts';
import type { MarkdownChrome, MarkdownFeed, MarkdownLink, MarkdownUrl } from './markdown-page.ts';
import { representationHref } from './negotiate.ts';
import type { TextFormat } from './negotiate.ts';
import type { Pagination } from './pagination.ts';
import type { LayoutParts, ThemeText } from './render.ts';
import {
  DOCUMENT_TEMPLATES,
  OPTIONAL_TEMPLATES,
  STATUS_PAGES,
  TEMPLATES,
} from './theme-templates.ts';
import type { StatusPageName } from './theme-templates.ts';
import { classifyPath } from './paths.ts';
import { documentLabel, encodePath } from './request.ts';
import { SEARCH_PATH, snippetMarkdown } from './search.ts';
import { servedPath, siteView } from './site-view.ts';
import type { WikiGroup } from './wiki-index.ts';

export function documentMarkdown(
  c: Context<GeekityEnv>,
  document: Document,
  url: string,
  format: TextFormat,
): string {
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

  return textPage(
    c,
    format,
    namedAuthor(documentFrontMatter({ ...document, permalink: url }), writer),
    chrome,
    [rewriteMarkdownLinks(body, siteHrefFor(c, url, format), siteView(c).bases.wiki)],
    {
      frontPage: url === '/' ? document : undefined,
      document,
      published: document.date,
      layouts:
        url === '/'
          ? [OPTIONAL_TEMPLATES.frontPage, TEMPLATES.page]
          : [DOCUMENT_TEMPLATES[document.type]],
    },
  );
}

export function listingMarkdown(
  c: Context<GeekityEnv>,
  archive: Archive,
  page: { href: string; title: string; pagination: Pagination; documents: readonly Document[] },
  format: TextFormat,
): string {
  const { next, previous } = page.pagination.href;
  const home = siteView(c).pages.home;
  const site = c.var.renderer.site();
  const description = oneLine(archive.description(site));
  const timezone = siteTimezone(site);
  const url = decodedPath(page.href);
  const linkUrl = siteUrlFor(c, url, format);

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
    description: format === 'gemini' ? undefined : document.description,
  }));
  const pager = [newer, older].filter((link) => link !== undefined);

  const { document, template } = archive.context;
  const layouts =
    template !== undefined
      ? [template]
      : document === undefined
        ? [TEMPLATES.home]
        : [OPTIONAL_TEMPLATES.postsPage, TEMPLATES.home];

  return textPage(
    c,
    format,
    { title: page.title, permalink: url },
    chrome,
    [
      description === '' ? '' : `> ${description}`,
      document === undefined
        ? ''
        : rewriteMarkdownLinks(
            normalizeBody(document.body),
            siteHrefFor(c, document.permalink, format),
            siteView(c).bases.wiki,
          ),
      entries.length === 0 ? '' : `## Posts\n\n${entryList(entries, linkUrl)}`,
      pager.length === 0 ? '' : `## More posts\n\n${linkList(pager, linkUrl)}`,
    ],
    { layouts },
  );
}

/**
 * The wiki index as text: a heading for each first letter and its pages
 * under it, linked to their own Markdown or Gemini.
 */
export function wikiIndexMarkdown(
  c: Context<GeekityEnv>,
  page: { href: string; title: string; groups: readonly WikiGroup<Document>[] },
  format: TextFormat,
): string {
  const url = page.href;
  const linkUrl = siteUrlFor(c, url, format);
  const wikiGroups = page.groups.map(({ letter, pages }) => ({
    letter,
    pages: pages.map((document) => ({
      label: documentLabel(c, document),
      url: document.permalink,
      description: format === 'gemini' ? undefined : document.description,
    })),
  }));
  const chrome: MarkdownChrome = {
    url,
    type: 'listing',
    title: page.title,
    feeds: siteFeeds(c.var.renderer.site().title),
    wikiGroups,
  };

  return textPage(
    c,
    format,
    { title: page.title, permalink: url },
    chrome,
    wikiGroups.map(
      ({ letter, pages }) => `## ${escapeMarkdown(letter)}\n\n${entryList(pages, linkUrl)}`,
    ),
    { layouts: [TEMPLATES.wikiIndex] },
  );
}

export function commentMarkdown(
  c: Context<GeekityEnv>,
  found: CommentThread,
  format: TextFormat,
): string {
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

  return textPage(
    c,
    format,
    {
      title: `${comment.author.name} on ${label}`,
      permalink: url,
      author: comment.author.name,
      date: comment.published,
    },
    chrome,
    [thread.comment.text],
    { layouts: [TEMPLATES.comment] },
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
  format: TextFormat,
): string {
  const { query, pagination } = page;
  const { next, previous } = pagination.href;
  const home = siteView(c).pages.home;
  const site = c.var.renderer.site();
  const timezone = siteTimezone(site);
  const linkUrl = siteUrlFor(c, SEARCH_PATH, format);
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
    description: format === 'gemini' ? undefined : snippetMarkdown(snippet),
  }));
  const pager = [newer, older].filter((link) => link !== undefined);

  return textPage(
    c,
    format,
    { title, permalink: page.href, ...(query === '' ? {} : { query }) },
    chrome,
    [
      summary,
      entries.length === 0 ? '' : `## Results\n\n${entryList(entries, linkUrl)}`,
      pager.length === 0 ? '' : `## More results\n\n${linkList(pager, linkUrl)}`,
    ],
    { layouts: [TEMPLATES.search] },
  );
}

export function statusMarkdown(
  c: Context<GeekityEnv>,
  page: StatusPageName,
  url: string,
  format: TextFormat,
  until?: Date,
): string {
  const { title } = STATUS_PAGES[page];
  const chrome: MarkdownChrome = {
    url,
    type: 'status',
    title,
    feeds: siteFeeds(c.var.renderer.site().title),
  };
  const body = c.var.renderer.renderStatusMarkdown(page, {
    url,
    markdownUrl: siteUrlFor(c, url, format),
    until,
    format,
  });
  return textPage(
    c,
    format,
    { title, ...(until === undefined ? {} : { until: until.toISOString() }) },
    chrome,
    [body],
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

function siteFeeds(siteTitle: string): MarkdownFeed[] {
  return [
    ...FEED_FORMATS.map((format) => feed(format, siteTitle, feedPathUnder('/', format))),
    feed('rss', `${siteTitle} comments`, commentsFeedPath()),
  ];
}

function textPage(
  c: Context<GeekityEnv>,
  format: TextFormat,
  frontMatter: Record<string, unknown>,
  chrome: MarkdownChrome,
  blocks: readonly (string | ThemeText)[],
  {
    published,
    ...pages
  }: {
    frontPage?: Document | undefined;
    document?: Document | undefined;
    published?: string | undefined;
    layouts?: readonly string[] | undefined;
  } = {},
): string {
  const linkUrl = siteUrlFor(c, chrome.url, format);
  const { header, footer, layout } = c.var.renderer.renderMarkdownChrome(chrome, {
    markdownUrl: linkUrl,
    format,
    ...pages,
  });
  const body = blocks.map((block) =>
    typeof block === 'string' ? { format: 'markdown' as const, text: block } : block,
  );
  if (format === 'markdown') {
    return markdownFile(
      { ...frontMatter, ...navigationFrontMatter(chrome, linkUrl) },
      layout === undefined
        ? [header, ...body, footer].map(({ text }) => text)
        : [layout.render(markdownParts(header, body, footer))],
    );
  }

  const day =
    published === undefined
      ? undefined
      : calendarDayIn(published, siteTimezone(c.var.renderer.site()));
  const dateline = {
    format: 'markdown' as const,
    text: day === undefined ? '' : `Published ${day}`,
  };
  const gemtext =
    layout === undefined
      ? gemtextOf([header, dateline, ...body, footer])
      : layout.format === 'gemini'
        ? `${layout.render(gemtextParts(header, [dateline, ...body], footer)).trim()}\n`
        : gemtextOf([
            {
              format: 'markdown',
              text: layout.render(markdownParts(header, [dateline, ...body], footer)),
            },
          ]);
  const home = `=> ${linkUrl(HOME_LINK.url)} ${HOME_LINK.label}`;
  return gemtext.split('\n').includes(home) ? gemtext : `${gemtext}\n${home}\n`;
}

function markdownParts(
  header: ThemeText,
  content: readonly ThemeText[],
  footer: ThemeText,
): LayoutParts {
  return {
    header: header.text.trim(),
    content: content
      .map(({ text }) => text.trim())
      .filter((text) => text !== '')
      .join('\n\n'),
    footer: footer.text.trim(),
  };
}

function gemtextParts(
  header: ThemeText,
  content: readonly ThemeText[],
  footer: ThemeText,
): LayoutParts {
  return {
    header: gemtextOf([header]).trim(),
    content: gemtextOf(content).trim(),
    footer: gemtextOf([footer]).trim(),
  };
}

function gemtextOf(parts: readonly ThemeText[]): string {
  const token = `geekity-gemtext-${randomUUID()}`;
  const gemtext: string[] = [];
  const markdown = parts
    .map(({ format, text }) => ({ format, text: text.trim() }))
    .filter(({ text }) => text !== '')
    .map(({ format, text }) =>
      format === 'markdown' ? text : `${token}-${String(gemtext.push(text) - 1)}`,
    )
    .join('\n\n');
  return convert(markdown, GEMTEXT).replace(
    new RegExp(`^${token}-(\\d+)$`, 'gm'),
    (_, index: string) => gemtext[Number(index)] ?? '',
  );
}

export const GEMTEXT = { plain: true, stripHtml: true } as const;

export function siteUrlFor(
  c: Context<GeekityEnv>,
  pageUrl: string,
  format: TextFormat,
): MarkdownUrl {
  const href = siteHrefFor(c, pageUrl, format);
  return (url) => href(url) ?? url;
}

function siteHrefFor(
  c: Context<GeekityEnv>,
  pageUrl: string,
  format: TextFormat,
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
      if (match?.kind === 'listing' || match?.kind === 'wiki-index') return candidate;
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
    return `${representationHref(`${pathname}${query}`, format)}${target?.hash ?? ''}`;
  };
}

function hasCommentPage(c: Context<GeekityEnv>, key: string): boolean {
  const post = commentedPost(c.var, key);
  return post !== undefined && isServed(post, c.var.store.now());
}
