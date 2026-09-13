import type { Document } from '../content/document.ts';
import type { SiteData } from './context.ts';
import { activityStreamsId } from './documents.ts';
import { feedPathUnder } from './feed-source.ts';
import { absoluteUrl, lastModifiedOf } from './negotiate.ts';

/**
 * One post as a feed shows it, in one shape whatever format the feed is.
 *
 * This is the model the three serialisers render. It exists because they used
 * to read the {@link Document} themselves, three times, and disagreed about
 * what they found: RSS keyed an item by the post's ActivityStreams object id
 * where Atom and JSON Feed used the permalink, RSS listed both taxonomies
 * where the others listed tags only, and RSS fell back to an excerpt where the
 * others printed nothing. One derivation, done once per post and site, means
 * there is one answer to each of those questions and one place to change it.
 *
 * A few fields are still pairs — {@link FeedItem.id} beside
 * {@link FeedItem.link}, {@link FeedItem.categories} beside
 * {@link FeedItem.tags}, {@link FeedItem.description} beside
 * {@link FeedItem.summary} — because TASK-63 is the refactor and each format
 * keeps printing exactly what it printed before. TASK-64 is what settles
 * decision-12 on the wire, after which every format reads the same half of
 * each pair.
 */
export interface FeedItem {
  /**
   * The post's name: its ActivityStreams object id, which after decision-13 is
   * the permalink, or the stored id a migrated post carries. decision-12 makes
   * this every feed's key for the post; today only RSS's `guid` prints it.
   */
  id: string;
  /** Where the post is read: its permalink, absolute on the site's base URL. */
  link: string;
  /** Display title. */
  title: string;
  /** When it was published, if it carries a date that parses. */
  published?: Date | undefined;
  /** When it last changed: its `updated`, else its date. */
  updated?: Date | undefined;
  /** The post's own author, when it names one. Atom and JSON Feed print this. */
  author?: string | undefined;
  /**
   * Who a feed credits: the post's own author, else the site's. RSS's
   * `dc:creator` prints it, because an RSS item has nowhere else to say it.
   */
  creator?: string | undefined;
  /** What the post is filed under, in file order. */
  categories: readonly string[];
  /** What the post is tagged with, in file order. */
  tags: readonly string[];
  /** The description the author wrote, when there is one. */
  description?: string | undefined;
  /**
   * What a feed prints as the summary: the description, else an excerpt of the
   * rendered body. Never the whole post — the content is where that goes.
   */
  summary: string;
  /** The rendered body. */
  html: string;
  /** The Markdown the body was written from, for `source:markdown`. */
  markdown: string;
  /**
   * Where this item's comments are, and how many there are, or `undefined`
   * when the feed did not resolve the counts. A feed whose builder did not
   * would otherwise publish "0 comments" about a post with plenty.
   */
  comments?: FeedItemComments | undefined;
}

/** Where one item's comments are, counted. */
export interface FeedItemComments {
  /** The page a person reads them on. */
  page: string;
  /** The feed a reader polls for them. */
  feed: string;
  /** How many there are. */
  count: number;
}

/** What an item needs to know about the feed it is part of. */
export interface FeedItemContext {
  /** Site-wide data, for the author a post does not name. */
  site: SiteData;
  /** The site's public origin, for absolute ids and links. */
  baseUrl: string;
  /** How many replies each document has, by permalink. See {@link FeedItem.comments}. */
  commentCounts?: ReadonlyMap<string, number> | undefined;
}

/**
 * One document as the item every format renders.
 *
 * The only reading of a {@link Document} a feed does: after this, a serialiser
 * sees an item and nothing else, so two formats cannot quietly disagree about
 * what a post's summary or its name is.
 */
export function feedItem(document: Document, context: FeedItemContext): FeedItem {
  const { baseUrl } = context;
  const link = absoluteUrl(document.permalink, baseUrl);
  const published = document.date === undefined ? undefined : new Date(document.date);

  const item: FeedItem = {
    // A page or a draft has no ActivityStreams id to advertise, and falls back
    // to its address. A feed only ever carries published posts, so in practice
    // this is the object id; the fallback is what keeps the shape total.
    id: activityStreamsId(document, baseUrl) ?? link,
    link,
    title: document.title,
    categories: document.categories,
    tags: document.tags,
    summary: feedExcerpt(document),
    html: document.html,
    markdown: document.body,
  };

  if (published !== undefined && !Number.isNaN(published.getTime())) item.published = published;

  const updated = lastModifiedOf(document);
  if (updated !== undefined) item.updated = updated;

  if (document.author !== undefined) item.author = document.author;

  const creator = document.author ?? context.site.author;
  if (creator !== undefined && creator !== '') item.creator = creator;

  if (document.description !== undefined) item.description = document.description;

  const counts = context.commentCounts;
  if (counts !== undefined) {
    item.comments = {
      page: `${link}#comments`,
      feed: absoluteUrl(feedPathUnder(document.permalink, 'rss'), baseUrl),
      count: counts.get(document.permalink) ?? 0,
    };
  }

  return item;
}

/** One item per document, in the order the feed was given them. */
export function feedItems(
  documents: readonly Document[],
  context: FeedItemContext,
): readonly FeedItem[] {
  return documents.map((document) => feedItem(document, context));
}

/**
 * How many words of the rendered text an excerpt keeps when a post carries no
 * `description`. WordPress's own excerpt length, so a migrated site's feed
 * reads the same.
 */
export const EXCERPT_WORDS = 55;

/**
 * The plain-text summary a feed carries for a post.
 *
 * The `description` front matter when the post has one — it is what the author
 * wrote for exactly this — and otherwise the first paragraph of the rendered
 * body, stripped to text and cut where WordPress cuts an excerpt. Never the
 * whole post: the content element is where the whole post goes, and a reader
 * that shows both should have something to choose between.
 */
export function feedExcerpt(document: Document): string {
  if (document.description !== undefined) return document.description;
  return excerptFromHtml(document.html);
}

/**
 * The first paragraph of some HTML as plain text, cut where WordPress cuts an
 * excerpt. What a post falls back to when it carries no `description`, and
 * what a comment — which never carries one — always uses.
 */
export function excerptFromHtml(html: string): string {
  // Tags are dropped rather than replaced by a space: the markup inside a
  // paragraph is inline, and "now</span>," is one word followed by a comma.
  // What separates the words is the whitespace the renderer already put
  // between its block tags, which the collapse below turns into single spaces.
  const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? html;
  const text = decodeHtmlText(paragraph.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return '';

  const words = text.split(' ');
  return words.length <= EXCERPT_WORDS ? text : `${words.slice(0, EXCERPT_WORDS).join(' ')} …`;
}

/**
 * The five named entities the Markdown renderer emits, resolved.
 *
 * An excerpt is text rather than markup, so `&amp;` in the rendered HTML has
 * to become `&` here before the XML escaping puts it back: leaving it would
 * publish a summary reading "Fish &amp;amp; chips".
 */
function decodeHtmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&amp;/g, '&');
}
