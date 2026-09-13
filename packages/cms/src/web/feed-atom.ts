import type { SiteData } from './context.ts';
import { feedItems } from './feed-item.ts';
import type { FeedItem } from './feed-item.ts';
import {
  contentTypeOf,
  EMPTY_FEED_UPDATED,
  FEED_GENERATOR,
  FEED_GENERATOR_URI,
  feedLanguage,
  notifyServerOf,
} from './feed-source.ts';
import type { FeedSource } from './feed-source.ts';
import { author, element, escapeXml, link, optionalElement, SOURCE_NAMESPACE } from './feed-xml.ts';
import { absoluteUrl, latestModified } from './negotiate.ts';

/**
 * Atom 1.0: the feed and its entries, rendered from {@link FeedItem}s.
 *
 * Atom names an entry by its permalink and tags it with the post's tags alone,
 * which is not what RSS does with the same item. decision-12 settles that
 * disagreement in favour of the object id and both taxonomies; TASK-64 is what
 * changes the bytes here.
 */

/** One feed as an Atom 1.0 document. */
export function atomFeed(source: FeedSource): string {
  const { site, documents, baseUrl } = source;
  const updated = latestModified(documents) ?? EMPTY_FEED_UPDATED;

  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom"`,
    `      xmlns:source="${SOURCE_NAMESPACE}"`,
    `      xml:lang="${escapeXml(feedLanguage(site))}">`,
    element('id', absoluteUrl(source.href, baseUrl)),
    element('title', source.title),
    ...optionalElement('subtitle', site.tagline),
    element('updated', updated.toISOString()),
    link({
      rel: 'self',
      type: contentTypeOf('atom'),
      href: absoluteUrl(source.feedHref, baseUrl),
    }),
    link({ rel: 'alternate', type: 'text/html', href: absoluteUrl(source.href, baseUrl) }),
    ...atomCloud(site),
    `  <generator uri="${escapeXml(FEED_GENERATOR_URI)}">${escapeXml(FEED_GENERATOR)}</generator>`,
    ...author(site.author, 1),
  ];

  for (const item of feedItems(documents, source)) {
    lines.push(...atomEntry(item));
  }

  lines.push('</feed>', '');
  return lines.join('\n');
}

/**
 * The notify server as an Atom feed can say it: the `rel="hub"` link WebSub
 * defines, and `<source:cloud>`, which is namespaced and so belongs here as
 * much as in RSS. The legacy `<cloud>` is not: it is an RSS 2.0 element with
 * no namespace, and Atom has nowhere to put it.
 */
function atomCloud(site: SiteData): string[] {
  const notify = notifyServerOf(site);
  if (notify === undefined) return [];

  return [element('source:cloud', notify.pleaseNotify), link({ rel: 'hub', href: notify.hub })];
}

/** One item as an Atom entry. */
export function atomEntry(item: FeedItem): string[] {
  return [
    '  <entry>',
    element('id', item.link, 2),
    element('title', item.title, 2),
    element('updated', (item.updated ?? EMPTY_FEED_UPDATED).toISOString(), 2),
    ...(item.published === undefined
      ? []
      : [element('published', item.published.toISOString(), 2)]),
    link({ rel: 'alternate', type: 'text/html', href: item.link }, 2),
    ...author(item.author, 2),
    ...item.tags.map((tag) => `    <category term="${escapeXml(tag)}"/>`),
    ...(item.description === undefined
      ? []
      : [`    <summary type="text">${escapeXml(item.description)}</summary>`]),
    // `type="html"` means the markup is escaped rather than inlined, so a
    // reader that does not parse XHTML still gets the whole post.
    `    <content type="html">${escapeXml(item.html)}</content>`,
    '  </entry>',
  ];
}
