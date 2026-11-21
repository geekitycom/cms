import type { AltTextLibrary } from '../content/alt-text.ts';
import { citedHost } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { documentLanguage } from '../content/locale.ts';
import { markdownDestination, rewriteMarkdownLinks } from '../content/markdown-links.ts';
import { photoAlt, photosOf } from '../content/photo.ts';
import { BEST_RATING, reviewOf, reviewWords } from '../content/review.ts';
import { permalinkBases, siteLocale, siteTimezone } from '../theme/site-data.ts';
import type { SiteData } from '../theme/site-data.ts';
import { formatDate } from '../theme/templates.ts';
import { absoluteFeedUrl, absoluteHtmlUrls } from '../util/absolute-urls.ts';
import { absoluteUrl } from '../util/url.ts';
import type { ReplyContext } from '../webmention/reply-context.ts';
import { markdownCites } from './markdown-cites.ts';
import { markdownText } from './markdown-conversation.ts';
import { escapeMarkdown } from './markdown-page.ts';
import type { MarkdownCite } from './markdown-page.ts';
import type { FeedComment } from './feed-source.ts';

export interface FeedMarkdownContext {
  readonly site: SiteData;
  readonly baseUrl: string;
  readonly altTexts?: AltTextLibrary | undefined;
  readonly replyContext?: ((target: string) => ReplyContext | undefined) | undefined;
}

export function feedMarkdown(
  document: Document,
  context: FeedMarkdownContext,
  link: string,
): string {
  const { site, baseUrl } = context;
  const url = (href: string): string => markdownDestination(absoluteFeedUrl(href, link, baseUrl));
  const locale = documentLanguage(document) ?? siteLocale(site);
  const day = (date: Date, zone?: string): string =>
    formatDate(date, 'readable', zone ?? siteTimezone(site), locale);

  const cites = markdownCites(document, context.replyContext).flatMap((cite) =>
    citeLines(cite, url, day),
  );
  const review = reviewLines(document, url);
  const photos = photosOf(document.extra).map(
    (photo) =>
      `![${escapeMarkdown(photoAlt(photo, context.altTexts ?? new Map()) ?? '')}]` +
      `(${markdownDestination(absoluteUrl(photo.url, baseUrl))})`,
  );
  const body = rewriteMarkdownLinks(
    document.body,
    (href) => {
      const absolute = absoluteFeedUrl(href, link, baseUrl);
      return absolute === href ? undefined : absolute;
    },
    {
      wikiBase: permalinkBases(site).wiki,
      rewriteImages: true,
      rewriteHtml: (html) => absoluteHtmlUrls(html, link, baseUrl),
    },
  );
  return [...cites, ...review, ...photos, body].filter((part) => part !== '').join('\n\n');
}

function citeLines(
  cite: MarkdownCite,
  url: (href: string) => string,
  day: (date: Date, zone?: string) => string,
): string[] {
  const line =
    `${cite.verb} [${escapeMarkdown(cite.name)}](${url(cite.url)})` +
    (cite.author === undefined ? '' : ` by ${escapeMarkdown(cite.author)}`) +
    (cite.site === undefined ? '' : ` · ${escapeMarkdown(cite.site)}`) +
    (cite.startDate === undefined ? '' : `, ${day(cite.startDate, cite.startZone)}`) +
    (cite.published === undefined ? '' : `, ${day(cite.published)}`) +
    (cite.location === undefined ? '' : `, ${escapeMarkdown(cite.location)}`);
  return cite.copy === undefined
    ? [line]
    : [
        line,
        `Also in reply to [its copy on ${escapeMarkdown(citedHost(cite.copy))}](${url(cite.copy)})`,
      ];
}

function reviewLines(document: Document, url: (href: string) => string): string[] {
  const review = reviewOf(document.extra);
  if (review === undefined) return [];
  const { link, about, by, uid, details } = reviewWords(review);
  const name = escapeMarkdown(review.item.name);
  return [
    'Review of ' +
      (link === undefined ? name : `[${name}](${url(link)})`) +
      (about.length === 0 ? '' : ` (${escapeMarkdown(about.join(', '))})`) +
      (by === undefined ? '' : `, ${escapeMarkdown(by)}`) +
      (uid === undefined ? '' : `, ${escapeMarkdown(uid)}`),
    escapeMarkdown(details.join(' ')),
    review.rating === undefined
      ? ''
      : `Rated ${String(review.rating)} out of ${String(BEST_RATING)}`,
  ];
}

/**
 * A comment's `source:markdown`: what a form comment's author typed, else its
 * sanitised HTML as Markdown. Raw HTML in typed Markdown was text on the page,
 * whose comment renderer escapes it, so it is escaped here too.
 */
export function feedCommentMarkdown(
  comment: Pick<FeedComment, 'url' | 'markdown'>,
  sanitizedHtml: string,
): string {
  const page = comment.url;
  const origin = new URL(page).origin;
  const absolute = (href: string): string | undefined => {
    const resolved = absoluteFeedUrl(href, page, origin);
    return resolved === href ? undefined : resolved;
  };
  return comment.markdown === undefined
    ? rewriteMarkdownLinks(markdownText(sanitizedHtml), absolute, {
        rewriteImages: true,
        rewriteHtml: (html) => absoluteHtmlUrls(html, page, origin),
      })
    : rewriteMarkdownLinks(comment.markdown, absolute, {
        rewriteImages: true,
        rewriteHtml: (html) => html.replaceAll('<', '\\<'),
      });
}
