import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import { DEFAULT_TIMEZONE } from '../content/time.ts';
import { siteImageMarkup } from '../images/markup.ts';
import type { ImageConfig } from '../images/variants.ts';
import type { AuthorContext } from './authors.ts';
import { feedExcerpt } from './feed-item.ts';
import { DEFAULT_TAXONOMY_BASES, taxonomyBasesOrDefault, taxonomyRedirectsOf } from './taxonomy.ts';
import type { TaxonomyBases, TaxonomyRedirect } from './taxonomy.ts';

/** Where the site-wide data file lives, relative to the content directory. */
export const SITE_DATA_FILE = '_data/site.json';

/** How many posts a listing page holds when the site does not say. */
export const DEFAULT_POSTS_PER_PAGE = 10;

/**
 * Site-wide data, from `content/_data/site.json` when the site has one.
 *
 * Eleventy exposes the same file as the `site` global, so a layout ported from
 * an Eleventy build reads `{{ site.title }}` unchanged. Unknown keys are kept,
 * so a site can put anything in the file and reach it from its templates.
 */
export interface SiteData {
  /** Site title. Defaults to `Geekity`. */
  title: string;
  /** One-line description, shown under the title. */
  tagline?: string | undefined;
  /** Public origin. Defaults to the configured `baseUrl`. */
  url: string;
  /** Site author. */
  author?: string | undefined;
  /**
   * The site's language as a BCP 47 tag, `en` unless the site says otherwise.
   * It is the `<html lang>`, the RSS channel's `<language>` and the Atom
   * feed's `xml:lang`.
   */
  language?: string | undefined;
  /**
   * The site's avatar, as the public path it is served at. Empty until one has
   * been uploaded on the settings screen; the ActivityPub actor's `icon`.
   */
  avatar?: string | undefined;
  /** How many posts a listing page holds. */
  postsPerPage?: number | undefined;
  /**
   * The first URL segment the tag archives live under, without slashes:
   * `tag` unless the site says otherwise.
   */
  tagBase?: string | undefined;
  /** The same for the category archives. `category` by default. */
  categoryBase?: string | undefined;
  /**
   * The rssCloud and WebSub server the feeds advertise and this site pings,
   * as an absolute URL. Empty — or missing — means the site names none.
   */
  notifyServer?: string | undefined;
  /**
   * The relay inboxes the site subscribes to (FEP-ae0c), as absolute URLs.
   * The setting itself; where each subscription stands lives in the database
   * rather than here, because a handshake is not the site's to decide.
   */
  relays?: readonly string[] | undefined;
  /**
   * The theme the site renders through: the name of one directory under the
   * configured themes directory. Absent — the ordinary state — is the theme
   * the package ships (decision-15).
   */
  theme?: string | undefined;
  /**
   * The slug of the page served at `/`, when the site shows a page there
   * rather than its latest posts. Absent for the latest posts.
   */
  homepage?: string | undefined;
  /**
   * The slug of the page whose own URL carries the post listing, when there is
   * one. Absent unless `homepage` names a page as well.
   */
  postsPage?: string | undefined;
  /**
   * The taxonomy archives that have moved, as `{ taxonomy, from, to }`: what
   * lets the URL a renamed archive used to live at point at the one it lives
   * at now. Written by the taxonomy screens; an Eleventy build of the same
   * content can publish the same redirects from it.
   */
  taxonomyRedirects?: readonly TaxonomyRedirect[] | undefined;
  [key: string]: unknown;
}

/**
 * What Eleventy calls `page`: the data about the document being rendered, as
 * opposed to the document's own front matter.
 */
export interface PageContext {
  /** The document's URL path. Always ends in `/`. */
  url: string;
  /** Publish date, absent for a document that has none. */
  date?: Date | undefined;
  /** The permalink's last segment, Eleventy's `page.fileSlug`. */
  fileSlug: string;
  /** The source file, relative to the content directory, Eleventy-style. */
  inputPath: string;
}

/**
 * One document as a template sees it.
 *
 * The shape mirrors what an Eleventy layout receives: the front matter at the
 * top level, the rendered body as `content`, and `page` alongside. Two keys
 * Eleventy puts on a collection item rather than on the page — `url` and
 * `tags` — are here too, so one shape serves both a rendered page and an entry
 * in a listing.
 */
export interface DocumentContext {
  /** Display title. */
  title: string;
  /** Publish date, absent for a document that has none. */
  date?: Date | undefined;
  /** Taxonomy, in the order the file lists it. */
  tags: string[];
  /** The second taxonomy: what the document is filed under, in file order. */
  categories: string[];
  /** The Markdown body rendered to HTML. Templates print it with `| safe`. */
  content: string;
  /**
   * What the document is about in one line of plain text: the `description`
   * the author wrote, else an excerpt of the rendered body, else empty.
   *
   * The very string the feeds publish as a summary, from the same function, so
   * a feed item and the entry a listing prints for the same post cannot say
   * two different things (decision-16). Always present, empty included, so a
   * theme prints it without asking whether it is there.
   */
  summary: string;
  /** The document's URL path, the same value as `page.url`. */
  url: string;
  /** Eleventy's `page`. */
  page: PageContext;
  /** `post` or `page`. */
  type: string;
  /** Everything else from the front matter, including unmodelled keys. */
  [key: string]: unknown;
}

/**
 * One of a post's neighbours by date, as a theme links it: `previous` and
 * `next` under an entry.
 *
 * Two keys rather than the whole document, because that is what the link is —
 * the words on it and where it goes — and a theme that was handed a second
 * document context would be a theme that could print a second post by
 * accident.
 */
export interface NeighbourContext {
  /** The neighbour's title, which is what the link says. */
  title: string;
  /** Its URL path. */
  url: string;
}

/**
 * A document as a template sees it.
 *
 * Front matter goes on first so the keys the CMS models always win: a file
 * with a stray `content` or `page` key cannot displace the rendered body or
 * the page data.
 *
 * `images` is the site's image config, and giving it is what turns an uploaded
 * picture in `content` into a `<picture>` with a `srcset` (decision-10). It is
 * an argument rather than something `renderMarkdown` does, because only the
 * theme's HTML may have it: the feeds, the JSON and Markdown representations
 * and the ActivityStreams `content` all read `document.html` directly and must
 * keep the plain `<img>` of the original.
 *
 * `author` is the profile behind the front matter's `author` (TASK-67), and it
 * is an argument for the reason `images` is: only something holding the site's
 * users can resolve a name to a person. Given one, the context's `author` is
 * that object rather than the raw string — `author.name` to print and
 * `author.url` to link — so a theme writes one thing whether the file names a
 * login, a display name from before decision-14, or somebody who has no
 * account here at all. Without one the file's own string is left where it was,
 * which is what a test over a single template renders.
 */
export function documentContext(
  document: Document,
  images?: ImageConfig,
  author?: AuthorContext,
): DocumentContext {
  const date = toDate(document.date);

  return {
    ...document.extra,
    permalink: document.permalink,
    slug: document.slug,
    draft: document.draft,
    ...optional('description', document.description),
    ...optional('author', author ?? document.author),
    ...optional('updated', toDate(document.updated)),
    ...optional('activitypub', document.activitypub),

    title: document.title,
    ...optional('date', date),
    tags: document.tags,
    categories: document.categories,
    content: images === undefined ? document.html : siteImageMarkup(images, document.html),
    // The plain-text summary, taken off the document rather than off the
    // markup above: an excerpt is text, and the `<picture>` a site's image
    // config puts in the HTML is not something to cut words out of.
    summary: feedExcerpt(document),
    url: document.permalink,
    type: document.type,
    page: {
      url: document.permalink,
      ...optional('date', date),
      fileSlug: document.slug,
      inputPath: `./${document.path}`,
    },
  };
}

/** Reads `content/_data/site.json`, and re-reads it when the file changes. */
export interface SiteDataSource {
  /** The current site data, defaults filled in. */
  read(): SiteData;
}

/**
 * A source over one site's data.
 *
 * `content/_data/site.json` is the only source of it (decision-9): the
 * settings screen writes that file and nothing else remembers what it said, so
 * a save and a hand edit reach the theme by exactly the same route.
 *
 * The file is read on every call and parsed only when its bytes differ from
 * the last read, so a render costs one small read rather than one parse. A
 * `stat` key was tried first and is not enough: a filesystem rounds the
 * modification time to its clock tick, a few milliseconds on Linux, so a
 * second write inside one tick that keeps the size and the inode, a theme
 * name swapped for one of the same length say, looked like no write at all.
 * The file is a few hundred bytes; reading it is cheaper than being wrong. A
 * file that is missing or will not parse falls back to the defaults instead
 * of failing the request: a typo in `site.json` should not take the site down.
 */
export function createSiteDataSource(config: ResolvedConfig): SiteDataSource {
  const file = path.join(config.contentDir, ...SITE_DATA_FILE.split('/'));

  let cached: Record<string, unknown> = {};
  let cachedText: string | undefined;

  function fromFile(): Record<string, unknown> {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      cachedText = undefined;
      cached = {};
      return cached;
    }

    if (text === cachedText) return cached;

    cachedText = text;
    cached = parseSiteFile(text);
    return cached;
  }

  return {
    read() {
      // The defaults are rebuilt per read rather than captured, because
      // `config.baseUrl` may have been settled from the settings after this
      // source was made.
      const defaults: SiteData = {
        title: 'Geekity',
        url: config.baseUrl,
        tagBase: DEFAULT_TAXONOMY_BASES.tag,
        categoryBase: DEFAULT_TAXONOMY_BASES.category,
      };
      return { ...defaults, ...fromFile() };
    },
  };
}

function parseSiteFile(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** How many posts a listing page holds, from the site data or the default. */
export function postsPerPage(site: SiteData): number {
  const configured = site['postsPerPage'];
  if (typeof configured === 'number' && Number.isInteger(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_POSTS_PER_PAGE;
}

/**
 * The theme this site has chosen, from the site data, or the empty string for
 * the theme the package ships.
 *
 * Read as tolerantly as everything else out of `site.json` — a key of the
 * wrong type is a site on the packaged theme rather than a broken render —
 * and read as a name rather than resolved to a directory, for the reason the
 * front page is read as a slug: only something holding the themes directory
 * can say whether the name still points at a theme.
 */
export function themeName(site: SiteData): string {
  return typeof site['theme'] === 'string' ? site['theme'].trim() : '';
}

/**
 * The zone this site's dates are read in, from the site data, or UTC when it
 * names none.
 *
 * The same lens the `date` filter applies (decision-11), for the things the
 * CMS rather than a template has to put a date through: which month of an
 * archive a post belongs to is the same calendar question as which day the
 * line under it says, and the two must not be answered by different clocks.
 */
export function siteTimezone(site: SiteData): string {
  const timezone = site['timezone'];
  return typeof timezone === 'string' && timezone !== '' ? timezone : DEFAULT_TIMEZONE;
}

/** WordPress's Reading choice, as `site.json` spells it. */
export interface FrontPageSlugs {
  /** The page served at `/`, or empty for the site's latest posts. */
  homepage: string;
  /** The page whose permalink carries the listing, or empty for none. */
  postsPage: string;
}

/**
 * Which page is the front page and which carries the listing, from the site
 * data.
 *
 * Read as tolerantly as everything else out of `site.json`, and read as slugs
 * rather than resolved to documents: only something holding the index can say
 * whether a slug still names a published page, and a slug that names none is a
 * site showing its latest posts.
 */
export function frontPageSlugs(site: SiteData): FrontPageSlugs {
  const homepage = typeof site['homepage'] === 'string' ? site['homepage'].trim() : '';
  const postsPage = typeof site['postsPage'] === 'string' ? site['postsPage'].trim() : '';

  // A posts page without a homepage would be a second URL for the listing that
  // is already at `/`. The settings screen refuses the pair; a hand-edited
  // file is read the same way rather than serving it.
  return { homepage, postsPage: homepage === '' ? '' : postsPage };
}

/**
 * Where this site's taxonomy archives live, from the site data.
 *
 * A base the site could not actually be served under — an empty one, one with
 * a slash in it, one that would shadow `/admin`, or two that are the same word
 * — falls back to the default rather than taking the archives down: the value
 * was refused at the settings screen, so anything that reaches here came from
 * a hand-edited `site.json`.
 */
export function taxonomyBases(site: SiteData): TaxonomyBases {
  return taxonomyBasesOrDefault({ tag: site['tagBase'], category: site['categoryBase'] });
}

/**
 * The archive renames this site records, from the site data.
 *
 * Read as tolerantly as everything else out of `site.json`: an entry that is
 * not a rename is dropped rather than taking the archives down, because a site
 * may have written the key by hand.
 */
export function termRedirects(site: SiteData): TaxonomyRedirect[] {
  return taxonomyRedirectsOf(site['taxonomyRedirects']);
}

function toDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
