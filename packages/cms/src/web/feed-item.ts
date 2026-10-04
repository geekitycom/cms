import type { User } from '../admin/accounts.ts';
import { citationsOf, citedHost, previewShown } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { enclosureOf } from '../content/enclosure.ts';
import type { Enclosure } from '../content/enclosure.ts';
import { photoAlt, photosOf } from '../content/photo.ts';
import { readLine, readOf } from '../content/read.ts';
import type { Photo } from '../content/photo.ts';
import type { AltTextLibrary } from '../images/alt-text.ts';
import { replyTarget, showsTitle } from '../content/post-type.ts';
import { authorName, siteAuthorName } from './authors.ts';
import type { SiteData } from './context.ts';
import { absoluteHtmlUrls } from './absolute-urls.ts';
import { activityStreamsId } from './documents.ts';
import { feedLanguage, feedPathUnder } from './feed-source.ts';
import { escapeXml } from './feed-xml.ts';
import { resolveLicense } from './license.ts';
import type { ContentLicense } from './license.ts';
import { canonicalLocale, documentLanguage } from './locale.ts';
import { absoluteUrl, lastModifiedOf } from './negotiate.ts';
import { citedPictureAlt, citesAnImage } from '../webmention/cited-picture.ts';
import type { ReplyContext } from '../webmention/reply-context.ts';

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
 * decision-12 is what each of those answers is, and the shape here is what
 * makes it unavoidable: there is one {@link FeedItem.id}, one
 * {@link FeedItem.terms} list and one {@link FeedItem.summary}, so a format
 * cannot print a second-best version of any of them. The one pair left,
 * {@link FeedItem.id} beside {@link FeedItem.link}, is two real things: what
 * the post is called and where it is read, which differ only for a post
 * carrying a stored id.
 */
export interface FeedItem {
  /**
   * The post's name: its ActivityStreams object id, which after decision-13 is
   * the permalink, or the stored id a migrated post carries. decision-12 makes
   * this every feed's key for the post, so all three formats print it: RSS as
   * `guid`, Atom as `<id>` and JSON Feed as `id`.
   */
  id: string;
  /**
   * Where the post is read: its permalink, absolute on the site's base URL.
   * The same in every format — RSS's `link`, Atom's `rel="alternate"` and JSON
   * Feed's `url` — and equal to {@link FeedItem.id} unless the post carries a
   * stored one.
   */
  link: string;
  /**
   * Display title, absent for a note (Post Type Discovery): a note has no
   * name, and each format leaves the title out as far as it is allowed to.
   * RSS drops `<title>` and keeps the `<description>` it then requires, JSON
   * Feed drops `title`, and Atom, which requires the element, writes it empty.
   */
  title?: string | undefined;
  /** When it was published, if it carries a date that parses. */
  published?: Date | undefined;
  /** When it last changed: its `updated`, else its date. */
  updated?: Date | undefined;
  /**
   * The post's own author as a name to print, when it names one. Atom and
   * JSON Feed print this.
   */
  author?: string | undefined;
  /**
   * Who a feed credits: the post's own author, else the site's, else the site
   * title. RSS's `dc:creator` prints it, because an RSS item has nowhere else
   * to say it.
   */
  creator: string;
  /**
   * What the post is filed under and tagged with, categories first and each in
   * file order, as one list.
   *
   * One list rather than two because no feed format distinguishes them: RSS has
   * a single `<category>`, Atom a single `<category term>` and JSON Feed a
   * single `tags`, which is exactly how WordPress publishes both taxonomies
   * too. decision-12 says every format lists every term, and a model that
   * cannot say which vocabulary a term came from is a model no format can
   * quietly list half of.
   */
  terms: readonly string[];
  /**
   * What every format prints as the summary: the description the author wrote,
   * else an excerpt of the rendered body. Never the whole post — the content is
   * where that goes — and empty only for a post with nothing to summarise,
   * which is the one case a format leaves the element out.
   *
   * Plain text, never markup: a format that reads its summary as HTML prints
   * {@link excerptHtml} of it.
   */
  summary: string;
  /**
   * What every format prints as the content: a read post's read line
   * (TASK-233), the post's photos (TASK-166), then its rendered body with every
   * relative URL in it made absolute. Each photo
   * is a plain `<img>` of the original, absolute on the site's base URL, with
   * the alt text the page gives it (decision-10: a reader cannot resolve the
   * site's variants), so a photo-only post does not read empty.
   */
  html: string;
  /**
   * The item's main image, absolute: the post's `image`, else its first photo.
   * JSON Feed writes it as `image`; the XML formats have no such field.
   */
  image?: string | undefined;
  /** The Markdown the body was written from, for `source:markdown`. */
  markdown: string;
  /**
   * Where this item's comments are, and how many there are, or `undefined`
   * when the feed did not resolve the counts. A feed whose builder did not
   * would otherwise publish "0 comments" about a post with plenty.
   */
  comments?: FeedItemComments | undefined;
  /**
   * The URL the post answers, when it is a reply: its `in-reply-to`, and only
   * when that is a URL a reader can follow ({@link replyTarget}). Atom writes
   * it as `thr:in-reply-to` and JSON Feed in its `_geekity` extension; RSS 2.0
   * has nowhere to put it.
   */
  inReplyTo?: string | undefined;
  /**
   * The language the post is written in, when its front matter names one that
   * is not the feed's own (TASK-154). A post in the feed's language says
   * nothing, since every format already declares that once for the whole
   * feed. RSS writes it as `dc:language`, Atom as `xml:lang` on the entry and
   * JSON Feed as the item's `language`.
   */
  language?: string | undefined;
  /**
   * What readers may do with the post: its front matter's
   * `license`, else the site's, or absent for none. Atom writes it as an
   * entry's `rel="license"` link and RSS as `creativeCommons:license`; JSON
   * Feed has no field for it and leaves it out.
   */
  license?: ContentLicense | undefined;
  /**
   * The post's recording (TASK-213), with every URL absolute on the site's
   * base URL. RSS writes the main file as `<enclosure>` and the rest in the
   * Podcasting 2.0 namespace, Atom writes the main file as a
   * `rel="enclosure"` link, and JSON Feed lists every version as an
   * attachment. A post without one prints none of it, so its bytes are what
   * they were before recordings existed, which is why
   * {@link FEED_ITEM_REVISION} did not move for it.
   */
  enclosure?: Enclosure | undefined;
}

/**
 * Which revision of the item's serialisation a feed's validator is keyed by.
 *
 * A feed's ETag is a hash of the documents and the site's metadata, because
 * those are what usually move it. The rules for turning a document into an item
 * are not in that hash, so a release that changes them — revision 2 changed
 * every RSS `guid`, the other formats' ids, their terms and their summaries,
 * revision 3 dropped the title of a post whose title only repeats its opening
 * words, and revision 4 named a reply's target in Atom and JSON Feed, and
 * revision 5 named a post's own language in all three, and revision 6 printed
 * a stored username as the user's display name and credited the site title
 * where nobody was named, and revision 7 printed a post's photos and named its
 * main image, and revision 8 made the relative URLs in a post's body absolute,
 * and revision 9 opened a read post with its read line and summarised it by
 * that line, and revision 10 opened a post that cites a page with a line
 * naming it and that page's copied picture, and revision 11 named a page
 * nothing was read from by its host and a cited image as one, and revision 12
 * kept the title of a titled post with no words,
 * and revision 13 escaped the RSS description as HTML text —
 * would leave the validator where it was, and a reader polling with
 * `If-None-Match` would be handed a 304 that hides the new bytes.
 *
 * Bumping this moves every post feed's ETag exactly once, at the upgrade, and
 * never again until the next such change. The comments feeds do not carry it:
 * a comment is not a {@link FeedItem}, and their validator has a label of its
 * own in `commentsFeedResponse`.
 */
export const FEED_ITEM_REVISION = 13;

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
  /** Everyone with an account, so a stored username prints as a display name. */
  users: readonly User[];
  /** The site's public origin, for absolute ids and links. */
  baseUrl: string;
  /** How many replies each document has, by permalink. See {@link FeedItem.comments}. */
  commentCounts?: ReadonlyMap<string, number> | undefined;
  /** The media library, for a photo's alt text the post does not give. Empty when absent. */
  altTexts?: AltTextLibrary | undefined;
  /**
   * What is stored about a page a post cites (decision-19), by its URL. A
   * citation with nothing stored names the page by its host.
   */
  replyContext?: ((target: string) => ReplyContext | undefined) | undefined;
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
  const author = authorName(context.users, document.author);
  const photos = photosOf(document.extra);

  const item: FeedItem = {
    // A page or a draft has no ActivityStreams id to advertise, and falls back
    // to its address. A feed only ever carries published posts, so in practice
    // this is the object id; the fallback is what keeps the shape total.
    id: activityStreamsId(document, baseUrl) ?? link,
    link,
    terms: [...document.categories, ...document.tags],
    summary: feedExcerpt(document),
    html:
      citationLines(document, context.replyContext, baseUrl) +
      readLine(readOf(document.extra)) +
      photosHtml(photos, context.altTexts ?? new Map(), baseUrl) +
      absoluteHtmlUrls(document.html, link, baseUrl),
    markdown: document.body,
    creator: author ?? siteAuthorName(context.users, context.site),
  };

  if (showsTitle(document)) item.title = document.title;
  if (published !== undefined && !Number.isNaN(published.getTime())) item.published = published;

  const updated = lastModifiedOf(document);
  if (updated !== undefined) item.updated = updated;

  if (author !== undefined) item.author = author;

  const image = ownImage(document) ?? photos[0]?.url;
  if (image !== undefined) item.image = absoluteUrl(image, baseUrl);

  const inReplyTo = replyTarget(document);
  if (inReplyTo !== undefined) item.inReplyTo = inReplyTo;

  const language = documentLanguage(document);
  if (language !== undefined && language !== canonicalLocale(feedLanguage(context.site))) {
    item.language = language;
  }

  const license = resolveLicense(context.site, document.extra);
  if (license !== undefined) item.license = license;

  const enclosure = enclosureOf(document.extra);
  if (enclosure !== undefined) item.enclosure = absoluteEnclosure(enclosure, baseUrl);

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

const CITATION_VERBS: Readonly<Record<string, string>> = {
  'in-reply-to': 'In reply to',
  'repost-of': 'Reposted',
  'like-of': 'Liked',
  'bookmark-of': 'Bookmarked',
};

function citationLines(
  document: Document,
  replyContext: FeedItemContext['replyContext'],
  baseUrl: string,
): string {
  const answered = replyTarget(document);
  const cited = [
    ...(answered === undefined ? [] : [{ property: 'in-reply-to', url: answered }]),
    ...citationsOf(document.extra),
  ];
  return cited
    .map(({ property, url }) => {
      const context = replyContext?.(url);
      const href = escapeXml(url);
      const image = context !== undefined && citesAnImage(context);
      const name =
        context?.name ??
        (context?.author !== undefined
          ? 'a post'
          : `${image ? 'an image from' : 'a page on'} ${citedHost(url)}`);
      const author = context?.author?.name;
      const credit =
        author !== undefined && !name.toLowerCase().endsWith(` by ${author.toLowerCase()}`)
          ? ` by ${escapeXml(author)}`
          : author === undefined && context?.site !== undefined
            ? ` · ${escapeXml(context.site)}`
            : '';
      const line = `<p class="cite-line">${CITATION_VERBS[property] ?? ''} <a href="${href}">${escapeXml(name)}</a>${credit}</p>\n`;
      if (context?.picture === undefined || !previewShown(document.extra)) return line;
      const { picture } = context;
      const alt = citedPictureAlt(property, context, document);
      return (
        line +
        `<p><a href="${href}"><img src="${escapeXml(absoluteUrl(picture.src, baseUrl))}"` +
        ` alt="${escapeXml(alt)}" width="${String(picture.width)}" height="${String(picture.height)}"></a></p>\n`
      );
    })
    .join('');
}

function photosHtml(photos: readonly Photo[], library: AltTextLibrary, baseUrl: string): string {
  return photos
    .map(
      (photo) =>
        `<figure><img src="${escapeXml(absoluteUrl(photo.url, baseUrl))}"` +
        ` alt="${escapeXml(photoAlt(photo, library) ?? '')}"></figure>`,
    )
    .join('');
}

function ownImage(document: Document): string | undefined {
  const image = document.extra['image'];
  return typeof image === 'string' && image.trim() !== '' ? image.trim() : undefined;
}

function absoluteEnclosure(enclosure: Enclosure, baseUrl: string): Enclosure {
  const { transcript } = enclosure;
  return {
    ...enclosure,
    url: absoluteUrl(enclosure.url, baseUrl),
    ...(transcript === undefined
      ? {}
      : { transcript: { ...transcript, url: absoluteUrl(transcript.url, baseUrl) } }),
    alternates: enclosure.alternates.map((alternate) => ({
      ...alternate,
      url: absoluteUrl(alternate.url, baseUrl),
    })),
  };
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
 * body, stripped to text and cut where WordPress cuts an excerpt. A read post's
 * first paragraph is its read line, so its summary says the current status. Never the
 * whole post: the content element is where the whole post goes, and a reader
 * that shows both should have something to choose between.
 */
export function feedExcerpt(document: Document): string {
  if (document.description !== undefined) return document.description;
  return excerptFromHtml(readLine(readOf(document.extra)) + document.html);
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
 * An excerpt as HTML that shows exactly its text, for the RSS description,
 * which readers render as markup.
 *
 * The excerpt has had its entities resolved, so text that was inert on the
 * page (`&lt;img&gt;`, a code span) is a tag again until this escapes it. Only
 * `&`, `<` and `>`: a text node needs no more, and `&apos;` is not HTML 4.
 */
export function excerptHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
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
