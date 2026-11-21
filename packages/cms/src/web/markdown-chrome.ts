import type { CommentFormContext, CommentViewer } from '../comments/form.ts';
import type { Document } from '../content/document.ts';
import { postLabel } from '../content/post-type.ts';
import { reviewWords } from '../content/review.ts';
import { termHref } from '../content/taxonomy.ts';
import type { Taxonomy } from '../content/taxonomy.ts';
import { calendarDayIn } from '../content/time.ts';
import { siteAuthorContext } from '../site/authors.ts';
import { navigationLinks, navigationMenus } from '../site/navigation.ts';
import { siteTimezone, permalinkBases } from '../theme/site-data.ts';
import { absoluteUrl } from '../util/url.ts';
import { webmentionEndpointFor } from '../webmention/endpoint.ts';
import type { ArchiveMonth } from './archive.ts';
import { documentContext, locationContext } from './context.ts';
import type { MarkdownEnvironment } from './markdown-environment.ts';
import { markdownConversation } from './markdown-conversation.ts';
import { bioOf, HOME_LINK, oneLine } from './markdown-page.ts';
import type {
  MarkdownArchiveMonth,
  MarkdownChrome,
  MarkdownEntry,
  MarkdownLink,
} from './markdown-page.ts';
import { markdownCites } from './markdown-cites.ts';
import type { PageContexts } from './page-context.ts';
import type {
  MarkdownChromeOptions,
  MarkdownChromeText,
  RenderDeps,
  StatusMarkdownContext,
  ThemeText,
} from './render.ts';
import { requestSite } from './render-scope.ts';
import { CHROME_TEMPLATES, STATUS_PAGES, layoutText, untilContext } from './theme-templates.ts';
import type { StatusPageName, TextTemplates } from './theme-templates.ts';
import type { TextFormat } from './negotiate.ts';

export interface MarkdownChromePages {
  renderMarkdownChrome(chrome: MarkdownChrome, options: MarkdownChromeOptions): MarkdownChromeText;
  renderStatusMarkdown(page: StatusPageName, context: StatusMarkdownContext): ThemeText;
}

export function createMarkdownChrome(
  deps: RenderDeps,
  markdown: MarkdownEnvironment,
  contexts: PageContexts,
): MarkdownChromePages {
  const { siteData, users } = deps;

  function renderMarkdownChrome(
    { commentsFeed, ...chrome }: MarkdownChrome,
    { markdownUrl, frontPage, document, format, layouts = [] }: MarkdownChromeOptions,
  ): MarkdownChromeText {
    const site = siteData.read();
    const soloAuthor = siteAuthorContext(users(), site.author);
    const responses = markdownConversationContext(deps, document, chrome.url);
    const answerable = 'conversation' in responses || 'commentForm' in responses;
    const listedFeeds =
      answerable && commentsFeed !== undefined ? [...chrome.feeds, commentsFeed] : chrome.feeds;
    const context = {
      site,
      menus: navigationMenus({ site, url: chrome.url }),
      navigation: navigationLinks(site),
      ...(soloAuthor === undefined ? {} : { soloAuthor }),
      ...(frontPage === undefined ? {} : contexts.newestPostsContext(frontPage)),
      ...markdownArchiveContext(
        deps,
        document === undefined ? undefined : contexts.archiveOf(document),
        format === 'gemini',
      ),
      ...markdownLinksContext(deps, document),
      ...markdownKindContext(deps, document),
      ...responses,
      home: HOME_LINK,
      ...chrome,
      feeds: listedFeeds,
      bio: chrome.bio ?? (chrome.url === '/' ? bioOf(soloAuthor) : undefined),
      staticFrontPage: frontPage !== undefined,
      markdownUrl,
      ...(format === 'gemini' ? { geminiUrl: markdownUrl } : {}),
      ...(format === 'markdown' && chrome.type !== 'status'
        ? contexts.capsuleContext(chrome.url)
        : {}),
    };
    const layout = layoutSlot(markdown, layouts, format);
    if (layout === undefined) {
      return {
        listedFeeds,
        header: markdown.renderText(CHROME_TEMPLATES.header, format, context),
        footer: markdown.renderText(CHROME_TEMPLATES.footer, format, context),
      };
    }

    const written = (templates: TextTemplates): ThemeText =>
      layout.format === 'gemini'
        ? markdown.renderText(templates, format, context)
        : { format: 'markdown', text: markdown.render(templates.markdown, context) };
    return {
      listedFeeds,
      header: written(CHROME_TEMPLATES.header),
      footer: written(CHROME_TEMPLATES.footer),
      layout: {
        format: layout.format,
        render: (parts) =>
          markdown.render(layout.templates[layout.format], { ...context, ...parts }),
      },
    };
  }

  function renderStatusMarkdown(
    page: StatusPageName,
    { url, markdownUrl, until, format }: StatusMarkdownContext,
  ): ThemeText {
    const templates = STATUS_PAGES[page];
    return markdown.renderText(templates, format, {
      site: siteData.read(),
      url,
      title: templates.title,
      markdownUrl,
      ...(format === 'gemini' ? { geminiUrl: markdownUrl } : {}),
      ...untilContext(until),
    });
  }

  return { renderMarkdownChrome, renderStatusMarkdown };
}

function layoutSlot(
  markdown: MarkdownEnvironment,
  layouts: readonly string[],
  format: TextFormat,
): { templates: TextTemplates; format: TextFormat } | undefined {
  for (const layout of layouts) {
    const templates = layoutText(layout);
    const written = markdown.slotFormat(templates, format);
    if (written !== undefined) return { templates, format: written };
  }
  return undefined;
}

function markdownArchiveContext(
  { siteData }: RenderDeps,
  months: readonly ArchiveMonth[] | undefined,
  gemfeed: boolean,
): Record<string, unknown> {
  if (months === undefined) return {};

  const timezone = siteTimezone(siteData.read());
  const markdownMonths: MarkdownArchiveMonth[] = months.map(({ month, posts }) => ({
    month,
    posts: posts.map((entry) => ({
      label: entry.title,
      url: entry.url,
      date: calendarDayIn(entry.date, timezone),
      description:
        gemfeed || entry.description === undefined ? undefined : oneLine(entry.description),
    })),
  }));
  return { archiveMonths: markdownMonths };
}

function markdownLinksContext(
  { siteData, options, citedPage }: RenderDeps,
  document: Document | undefined,
): Record<string, unknown> {
  if (document === undefined) return {};

  const site = siteData.read();
  const bases = permalinkBases(site);
  const timezone = siteTimezone(site);
  const terms = (taxonomy: Taxonomy, names: readonly string[]): MarkdownLink[] =>
    document.type === 'post'
      ? names.map((term) => ({ label: term, url: termHref({ taxonomy, term }, 0, bases) }))
      : [];
  const backlinks: MarkdownEntry[] = (options.backlinks?.(document) ?? []).map((linking) => ({
    label: postLabel(linking, citedPage),
    url: linking.permalink,
    date: linking.date === undefined ? undefined : calendarDayIn(linking.date, timezone),
  }));
  return {
    categories: terms('category', document.categories),
    tags: terms('tag', document.tags),
    backlinks,
  };
}

function markdownKindContext(
  { config, options, citedPage }: RenderDeps,
  document: Document | undefined,
): Record<string, unknown> {
  if (document?.type !== 'post') return {};

  const { postType, lang, rsvp, event, review, enclosure, photos } = documentContext(
    document,
    config,
    undefined,
    undefined,
    citedPage,
  );
  const shared = options.location?.(document, requestSite());
  return {
    postType,
    ...(lang === undefined ? {} : { lang }),
    cites: markdownCites(document, citedPage),
    photos: photos.map(({ url, alt }) => ({ url, alt })),
    ...(enclosure === undefined ? {} : { enclosure }),
    ...(rsvp === undefined ? {} : { rsvp: { value: rsvp.value, label: rsvp.label } }),
    ...(event === undefined ? {} : { event }),
    ...(review === undefined
      ? {}
      : {
          review: {
            item: review.item,
            kindLabel: review.kindLabel,
            ...(review.rating === undefined ? {} : { rating: review.rating }),
            best: review.best,
            ...reviewWords(review),
          },
        }),
    ...(shared === undefined ? {} : { location: locationContext(shared) }),
  };
}

function strangerCommentForm(
  { options }: RenderDeps,
  document: Document,
): CommentFormContext | undefined {
  const signedOut: CommentViewer | undefined = undefined;
  const offersNotifications = false;
  return options.commentForm?.(document, signedOut, offersNotifications);
}

function markdownConversationContext(
  deps: RenderDeps,
  document: Document | undefined,
  url: string,
): Record<string, unknown> {
  if (document === undefined) return {};

  const { config, siteData, options } = deps;
  const said = options.conversation?.(document, requestSite());
  const page = absoluteUrl(url, config.baseUrl);
  const takesComments = strangerCommentForm(deps, document) !== undefined;
  const webmention = webmentionEndpointFor(siteData.read());
  return {
    ...(said === undefined || said.counts.total === 0
      ? {}
      : { conversation: markdownConversation(said) }),
    ...(takesComments ? { commentForm: { url: `${page}#respond` } } : {}),
    ...(options.contactForm?.(document) === undefined
      ? {}
      : { contactForm: { url: `${page}#contact` } }),
    ...(webmention === undefined ? {} : { webmention }),
  };
}
