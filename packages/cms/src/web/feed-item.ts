import { CITATION_VERBS, citationsOf, citedPageName, previewShown } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { enclosureOf } from '../content/enclosure.ts';
import type { Enclosure } from '../content/enclosure.ts';
import { photoAlt, photosOf } from '../content/photo.ts';
import { reviewHtml, reviewOf, reviewSummary } from '../content/review.ts';
import { RSVP_PHRASES, rsvpLine, rsvpOf } from '../content/rsvp.ts';
import type { Photo } from '../content/photo.ts';
import type { AltTextLibrary } from '../content/alt-text.ts';
import { replyTarget, showsTitle } from '../content/post-type.ts';
import type { User } from '../site/users.ts';
import { absoluteUrl } from '../util/url.ts';
import { authorName, siteAuthorName } from '../site/authors.ts';
import type { SiteData } from '../theme/site-data.ts';
import { absoluteHtmlUrls } from './absolute-urls.ts';
import { feedGuid, repliesKey } from '../content/guids.ts';
import { feedLanguage, feedPathUnder, repliesFeedPath } from './feed-source.ts';
import { escapeXml } from './feed-xml.ts';
import { resolveLicense } from '../content/license.ts';
import type { ContentLicense } from '../content/license.ts';
import { canonicalLocale, documentLanguage } from '../content/locale.ts';
import { lastModifiedOf } from './negotiate.ts';
import { citedPictureAlt } from '../webmention/cited-picture.ts';
import type { ReplyContext } from '../webmention/reply-context.ts';
import { feedExcerpt } from '../content/excerpt.ts';

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
 * Every format gives the same answer to each, and the shape here is what
 * makes that unavoidable: there is one {@link FeedItem.id}, one
 * {@link FeedItem.terms} list and one {@link FeedItem.summary}, so a format
 * cannot print a second-best version of any of them. The one pair left,
 * {@link FeedItem.id} beside {@link FeedItem.link}, is two real things: what
 * the post is called and where it is read, which differ only for a post
 * carrying a stored id or a `guid`.
 */
export interface FeedItem {
  /**
   * The post's name: the `guid` its front matter sets, else its ActivityStreams
   * object id, which is the permalink, or the stored id a migrated post
   * carries. This is every feed's key for the post, so all three formats print
   * it: RSS as `guid`, Atom as `<id>` and JSON Feed as `id`.
   */
  id: string;
  /**
   * Where the post is read: its permalink, absolute on the site's base URL.
   * The same in every format — RSS's `link`, Atom's `rel="alternate"` and JSON
   * Feed's `url` — and equal to {@link FeedItem.id} unless the post carries a
   * stored id or a `guid`.
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
   * too. Every format lists every term, and a model that
   * cannot say which vocabulary a term came from is a model no format can
   * quietly list half of.
   */
  terms: readonly string[];
  /**
   * What every format prints as the summary: the description the author wrote,
   * else an excerpt of the rendered body, else the photos' alt text. Never the
   * whole post — the content is where that goes — and empty only for a post
   * with nothing to summarise,
   * which is the one case a format leaves the element out.
   */
  summary: string;
  /**
   * What every format prints as the content: a review's item and rating,
   * the post's photos, then its rendered body with
   * every relative URL in it made absolute. Each photo is a plain `<img>` of
   * the original, absolute on the site's base URL, with the alt text the page
   * gives it (a reader cannot resolve the site's variants), so a
   * photo-only post does not read empty.
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
   * it as `thr:in-reply-to`, JSON Feed in its `_geekity` extension and RSS as
   * the source namespace's `source:inReplyTo`.
   */
  inReplyTo?: string | undefined;
  /**
   * The language the post is written in, when its front matter names one that
   * is not the feed's own. A post in the feed's language says
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
   * The post's recording, with every URL absolute on the site's
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
 * and revision 13 escaped the RSS description as HTML text, and revision 14
 * pointed RSS `source:comments` at the direct replies' feed —
 * would leave the validator where it was, and a reader polling with
 * `If-None-Match` would be handed a 304 that hides the new bytes.
 *
 * Bumping this moves every post feed's ETag exactly once, at the upgrade, and
 * never again until the next such change. The comments feeds do not carry it:
 * a comment is not a {@link FeedItem}, and their validator has a label of its
 * own in `commentsFeedResponse`.
 */
export const FEED_ITEM_REVISION = 15;

/** Where one item's comments are, counted. */
export interface FeedItemComments {
  /** The page a person reads them on. */
  page: string;
  /** The feed of the whole thread, which a reader polls for them. */
  feed: string;
  /** How many replies answer the item directly, and the feed of only those. */
  replies: { count: number; feed: string };
}

/** What an item needs to know about the feed it is part of. */
export interface FeedItemContext {
  /** Site-wide data, for the author a post does not name. */
  site: SiteData;
  /** Everyone with an account, so a stored username prints as a display name. */
  users: readonly User[];
  /** The site's public origin, for absolute ids and links. */
  baseUrl: string;
  /** How many replies answer each document directly, by permalink. See {@link FeedItem.comments}. */
  commentCounts?: ReadonlyMap<string, number> | undefined;
  /** The media library, for a photo's alt text the post does not give. Empty when absent. */
  altTexts?: AltTextLibrary | undefined;
  /**
   * What is stored about a page a post cites, by its URL. A
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
  const review = reviewOf(document.extra);
  const excerpt = feedExcerpt(document);

  const item: FeedItem = {
    id: feedGuid(document, baseUrl),
    link,
    terms: [...document.categories, ...document.tags],
    summary:
      review === undefined || document.description !== undefined
        ? excerpt || photosSummary(photos, context.altTexts ?? new Map())
        : [reviewSummary(review), excerpt].filter((part) => part !== '').join(' '),
    html:
      citationLines(document, context.replyContext, baseUrl) +
      rsvpLine(rsvpOf(document.extra)) +
      reviewHtml(review, { library: context.altTexts, baseUrl }) +
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
      replies: {
        count: counts.get(document.permalink) ?? 0,
        feed: absoluteUrl(repliesFeedPath(repliesKey(item.id)), baseUrl),
      },
    };
  }

  return item;
}

const CITATION_LINE_VERBS: Readonly<Record<string, string>> = {
  'in-reply-to': 'In reply to',
  ...CITATION_VERBS,
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
      const shown = (property === 'in-reply-to' ? context?.original : undefined) ?? url;
      const href = escapeXml(shown);
      const name = citedPageName(shown, context);
      const author = context?.author?.name;
      const credit =
        author !== undefined && !name.toLowerCase().endsWith(` by ${author.toLowerCase()}`)
          ? ` by ${escapeXml(author)}`
          : author === undefined && context?.site !== undefined
            ? ` · ${escapeXml(context.site)}`
            : '';
      const rsvp = property === 'in-reply-to' ? rsvpOf(document.extra) : undefined;
      const verb = rsvp === undefined ? (CITATION_LINE_VERBS[property] ?? '') : RSVP_PHRASES[rsvp];
      const line = `<p class="cite-line">${verb} <a href="${href}">${escapeXml(name)}</a>${credit}</p>\n`;
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

function photosSummary(photos: readonly Photo[], library: AltTextLibrary): string {
  return photos
    .map((photo) => photoAlt(photo, library) ?? '')
    .filter((alt) => alt !== '')
    .join(' · ');
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
