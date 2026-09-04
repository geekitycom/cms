import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import { DEFAULT_TAXONOMY_BASES, taxonomyBasesOrDefault } from './taxonomy.ts';
import type { TaxonomyBases } from './taxonomy.ts';

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
 * A document as a template sees it.
 *
 * Front matter goes on first so the keys the CMS models always win: a file
 * with a stray `content` or `page` key cannot displace the rendered body or
 * the page data.
 */
export function documentContext(document: Document): DocumentContext {
  const date = toDate(document.date);

  return {
    ...document.extra,
    permalink: document.permalink,
    slug: document.slug,
    draft: document.draft,
    ...optional('description', document.description),
    ...optional('author', document.author),
    ...optional('updated', toDate(document.updated)),
    ...optional('activitypub', document.activitypub),

    title: document.title,
    ...optional('date', date),
    tags: document.tags,
    categories: document.categories,
    content: document.html,
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
 * The settings the admin stores, as site data.
 *
 * The admin's settings screen is the source of truth for the values it
 * manages, and `content/_data/site.json` is the mirror it writes for an
 * Eleventy build. Handing the source a reader for the settings is what makes a
 * saved title show on the very next request rather than on the next time the
 * file's modification time is noticed.
 */
export interface SiteSettingsSource {
  /** The stored settings as site data. Empty when nothing is stored. */
  read(): Partial<SiteData>;
}

/** What {@link createSiteDataSource} reads from besides the config. */
export interface CreateSiteDataSourceOptions {
  /** The admin's settings, when the CMS has an admin store to read them from. */
  settings?: SiteSettingsSource | undefined;
}

/**
 * A source over one site's data.
 *
 * The file is read once and then only again when its modification time moves,
 * so a render costs one `stat` rather than one parse. A file that is missing
 * or will not parse falls back to the defaults instead of failing the request:
 * a typo in `site.json` should not take the site down.
 *
 * The stored settings, when there are any, go on top of the file. They are the
 * same values the file was last written from, so the two normally agree; the
 * overlay is what keeps them agreeing in the moment between a save and the
 * file's `mtime` being noticed, and the file underneath is what carries the
 * keys the settings form does not manage.
 */
export function createSiteDataSource(
  config: ResolvedConfig,
  options: CreateSiteDataSourceOptions = {},
): SiteDataSource {
  const file = path.join(config.contentDir, ...SITE_DATA_FILE.split('/'));
  const settings = options.settings;

  let cached: Record<string, unknown> = {};
  let cachedAt: number | undefined;

  function fromFile(): Record<string, unknown> {
    let modifiedAt: number | undefined;
    try {
      modifiedAt = statSync(file).mtimeMs;
    } catch {
      cachedAt = undefined;
      cached = {};
      return cached;
    }

    if (modifiedAt === cachedAt) return cached;

    cachedAt = modifiedAt;
    cached = readSiteFile(file);
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
      return { ...defaults, ...fromFile(), ...settings?.read() };
    },
  };
}

function readSiteFile(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
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

function toDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
