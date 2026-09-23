import type { SiteData } from './context.ts';
import { excerptFromHtml, feedItems } from './feed-item.ts';
import type { FeedItem } from './feed-item.ts';
import {
  contentTypeOf,
  EMPTY_FEED_UPDATED,
  FEED_GENERATOR,
  feedLanguage,
  notifyServerOf,
} from './feed-source.ts';
import type { CommentFeedSource, FeedComment, FeedSource } from './feed-source.ts';
import {
  cdata,
  DC_NAMESPACE,
  element,
  escapeXml,
  optionalElement,
  rfc822,
  SOURCE_NAMESPACE,
  WFW_NAMESPACE,
} from './feed-xml.ts';
import { absoluteUrl, latestModified } from './negotiate.ts';
import { sanitizeCommentHtml } from './sanitize.ts';

/**
 * RSS 2.0: the post feed, the comments feed, and the channel they share.
 *
 * The items come from {@link FeedItem}s rather than from documents, so what an
 * RSS item says about a post is decided in one place and read here — and says
 * the same as what Atom and JSON Feed say about it, because there is only one
 * id, one term list and one summary on the item to print.
 */

/** One feed as an RSS 2.0 document. */
export function rssFeed(source: FeedSource): string {
  const { site, documents, baseUrl } = source;
  const link = absoluteUrl(source.href, baseUrl);
  const built = latestModified(documents) ?? EMPTY_FEED_UPDATED;

  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"',
    '     xmlns:atom="http://www.w3.org/2005/Atom"',
    '     xmlns:content="http://purl.org/rss/1.0/modules/content/"',
    `     xmlns:dc="${DC_NAMESPACE}"`,
    `     xmlns:source="${SOURCE_NAMESPACE}"`,
    `     xmlns:wfw="${WFW_NAMESPACE}">`,
    '  <channel>',
    element('title', source.title, 2),
    element('link', link, 2),
    // Required by the spec even when the site has no tagline, so it is written
    // empty rather than left out.
    element('description', site.tagline ?? '', 2),
    element('language', feedLanguage(site), 2),
    element('lastBuildDate', rfc822(built), 2),
    element('generator', FEED_GENERATOR, 2),
    `    <atom:link rel="self" type="${escapeXml(
      contentTypeOf('rss'),
    )}" href="${escapeXml(absoluteUrl(source.feedHref, baseUrl))}"/>`,
    ...cloudElements(site),
    ...channelImage(source, link),
  ];

  for (const item of feedItems(documents, source)) {
    lines.push(...rssItem(item));
  }

  lines.push('  </channel>', '</rss>', '');
  return lines.join('\n');
}

/**
 * The notify server, said the three ways an RSS channel can say it: the legacy
 * `<cloud>` a 2001 aggregator understands, `<source:cloud>` for one that reads
 * Dave Winer's namespace, and the WebSub `rel="hub"` link.
 *
 * All three name the same server, so a subscriber gets told the moment the
 * feed changes whichever of the protocols it speaks. Nothing at all when the
 * site names no server.
 */
function cloudElements(site: SiteData): string[] {
  const notify = notifyServerOf(site);
  if (notify === undefined) return [];
  const { cloud } = notify;

  return [
    `    <cloud domain="${escapeXml(cloud.domain)}" port="${String(cloud.port)}"` +
      ` path="${escapeXml(cloud.path)}"` +
      ` registerProcedure="${escapeXml(cloud.registerProcedure)}"` +
      ` protocol="${escapeXml(cloud.protocol)}"/>`,
    element('source:cloud', notify.pleaseNotify, 2),
    `    <atom:link rel="hub" href="${escapeXml(notify.hub)}"/>`,
  ];
}

/**
 * The channel's `<image>`, from the site's avatar.
 *
 * RSS wants the title and the link to repeat the channel's own, and a reader
 * that shows a feed icon is showing the site's face; the avatar setting is the
 * only picture a site names.
 */
function channelImage(source: FeedSource, link: string): string[] {
  const avatar = source.site.avatar;
  if (avatar === undefined || avatar === '') return [];

  return [
    '    <image>',
    element('url', absoluteUrl(avatar, source.baseUrl), 3),
    element('title', source.title, 3),
    element('link', link, 3),
    '    </image>',
  ];
}

/**
 * One item as RSS.
 *
 * The `guid` is the item's id, which decision-12 makes every feed's key for
 * the post: after decision-13 that is the permalink itself, or the stored id a
 * migrated post carries. `isPermaLink` tells a reader which of the two it is
 * looking at — `true` when the id is the permalink, so a reader that resolves
 * a guid finds the post, and `false` when it is a stored name like WordPress's
 * `?p=813`, which is the id that post's subscribers already hold.
 */
export function rssItem(item: FeedItem): string[] {
  return [
    '    <item>',
    ...optionalElement('title', item.title, 3),
    element('link', item.link, 3),
    `      <guid isPermaLink="${item.id === item.link ? 'true' : 'false'}">` +
      `${escapeXml(item.id)}</guid>`,
    ...(item.published === undefined ? [] : [element('pubDate', rfc822(item.published), 3)]),
    ...(item.creator === undefined ? [] : [element('dc:creator', item.creator, 3)]),
    // Every term becomes a category. RSS has one `<category>` and no way to say
    // which vocabulary a term came from, which is exactly how WordPress
    // publishes tags and categories too.
    ...item.terms.map((term) => `      <category>${escapeXml(term)}</category>`),
    ...commentPointers(item),
    element('description', item.summary, 3),
    `      <content:encoded>${cdata(item.html)}</content:encoded>`,
    // The source of the item, per the namespace: a reader that understands
    // Markdown should render from this rather than from the HTML above. It is
    // the same text the ActivityStreams `Article` carries as its `source`.
    `      <source:markdown>${cdata(item.markdown)}</source:markdown>`,
    '    </item>',
  ];
}

/**
 * Where one item's comments are, said three ways.
 *
 * `<comments>` is the page a person should read them on and `wfw:commentRss`
 * the feed a reader should poll, which is the pair WordPress publishes and so
 * the pair every reader already understands. `source:comments` is the same
 * feed with the count beside it, so a reader can say "3 comments" without
 * fetching anything.
 *
 * Written only when the item carries them: a feed whose builder did not
 * resolve the counts would otherwise publish "0 comments" about a post with
 * plenty.
 */
function commentPointers(item: FeedItem): string[] {
  const comments = item.comments;
  if (comments === undefined) return [];

  return [
    element('comments', comments.page, 3),
    element('wfw:commentRss', comments.feed, 3),
    `      <source:comments count="${String(comments.count)}" ` +
      `feedUrl="${escapeXml(comments.feed)}"/>`,
  ];
}

/** One comments feed as an RSS 2.0 document. */
export function commentsRssFeed(source: CommentFeedSource): string {
  const { site, comments, baseUrl } = source;
  const link = absoluteUrl(source.href, baseUrl);
  const built = comments[0]?.published ?? EMPTY_FEED_UPDATED;

  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"',
    '     xmlns:atom="http://www.w3.org/2005/Atom"',
    '     xmlns:content="http://purl.org/rss/1.0/modules/content/"',
    `     xmlns:dc="${DC_NAMESPACE}"`,
    `     xmlns:source="${SOURCE_NAMESPACE}">`,
    '  <channel>',
    element('title', source.title, 2),
    element('link', link, 2),
    element('description', site.tagline ?? '', 2),
    element('language', feedLanguage(site), 2),
    element('lastBuildDate', rfc822(built), 2),
    element('generator', FEED_GENERATOR, 2),
    `    <atom:link rel="self" type="${escapeXml(
      contentTypeOf('rss'),
    )}" href="${escapeXml(absoluteUrl(source.feedHref, baseUrl))}"/>`,
    // A comments feed is polled like any other, so it advertises the same
    // server: a subscriber to one is told a reply arrived rather than finding
    // out on its next poll.
    ...cloudElements(site),
  ];

  for (const comment of comments) lines.push(...commentItem(comment));

  lines.push('  </channel>', '</rss>', '');
  return lines.join('\n');
}

/**
 * One comment as an RSS item.
 *
 * A comment is not a {@link FeedItem}: it is one entry of the conversation
 * under a post, with its own id, its own author and no taxonomy at all, and
 * the Conversation module is what derives it. The sanitising happens here, at
 * the last moment before the markup a stranger wrote becomes bytes this site
 * publishes, so there is one place to check rather than one per caller.
 */
function commentItem(comment: FeedComment): string[] {
  const html = sanitizeCommentHtml(comment.html);
  const title =
    comment.post === undefined ? comment.author : `${comment.author} on ${comment.post.title}`;

  return [
    '    <item>',
    element('title', title, 3),
    element('link', comment.url, 3),
    // A reply's id is a name rather than an address: some servers publish a
    // note at an id nothing dereferences and a `url` somewhere else entirely.
    `      <guid isPermaLink="false">${escapeXml(comment.id)}</guid>`,
    element('pubDate', rfc822(comment.published), 3),
    element('dc:creator', comment.author, 3),
    // A comment never carries a description, so its summary is always an
    // excerpt of what it says.
    element('description', excerptFromHtml(html), 3),
    `      <content:encoded>${cdata(html)}</content:encoded>`,
    '    </item>',
  ];
}
