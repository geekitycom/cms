import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ResolvedConfig } from '../config.ts';
import { canonicalLocale, DEFAULT_LOCALE } from '../content/locale.ts';
import {
  DEFAULT_TAXONOMY_BASES,
  taxonomyBasesOrDefault,
  taxonomyRedirectsOf,
} from '../content/taxonomy.ts';
import type { TaxonomyBases, TaxonomyRedirect } from '../content/taxonomy.ts';
import { DEFAULT_TIMEZONE } from '../content/time.ts';
import { isRecord } from '../util/guards.ts';
import { COLOR_MODES, themeScheme } from './themes.ts';
import type { ColorMode, ThemeScheme } from './themes.ts';

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
   * The locale dates and counts are written in, as a BCP 47 tag, when it is
   * not the language: `en-US` on an `en` site, say. Absent or empty means the
   * language. {@link siteLocale} is the one reading of it.
   */
  locale?: string | undefined;
  /**
   * The site's avatar, as the public path it is served at. Empty until one has
   * been uploaded on the settings screen; the ActivityPub actor's `icon`.
   */
  avatar?: string | undefined;
  /**
   * The upload the site's icons are drawn from, when it is not the avatar: a
   * logo, say, for a site whose avatar is a face. An SVG is linked as itself
   * as well as rasterised. Absent means the avatar.
   */
  icon?: string | undefined;
  /**
   * What readers may do with the site's posts: a Creative Commons
   * key such as `cc-by-sa`, or a custom license's URL. Absent, or `none`, is
   * all rights reserved. A post's own `license` front matter overrides it;
   * `resolveLicense` in `license.ts` is the one reading of both.
   */
  license?: string | undefined;
  /** A custom license's name, beside its URL in `license`. */
  licenseName?: string | undefined;
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
   * the package ships.
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

/** Reads `content/_data/site.json`, and re-reads it when the file changes. */
export interface SiteDataSource {
  /** The current site data, defaults filled in. */
  read(): SiteData;
}

/**
 * A source over one site's data.
 *
 * `content/_data/site.json` is the only source of it: the
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
export function createSiteDataSource(
  config: Pick<ResolvedConfig, 'contentDir' | 'baseUrl'>,
): SiteDataSource {
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
    return isRecord(parsed) ? parsed : {};
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
 * The same lens the `date` filter applies, for the things the
 * CMS rather than a template has to put a date through: which month of an
 * archive a post belongs to is the same calendar question as which day the
 * line under it says, and the two must not be answered by different clocks.
 */
export function siteTimezone(site: SiteData): string {
  const timezone = site['timezone'];
  return typeof timezone === 'string' && timezone !== '' ? timezone : DEFAULT_TIMEZONE;
}

/**
 * The locale this site's dates and counts are written in: the `locale`
 * setting, else the `language`, else `en`. A tag Intl will not take is passed
 * over, so a hand-edited `site.json` costs the locale and not the page.
 */
export function siteLocale(site: SiteData): string {
  for (const tag of [site['locale'], site['language']]) {
    if (typeof tag !== 'string' || tag.trim() === '') continue;
    const locale = canonicalLocale(tag);
    if (locale !== undefined) return locale;
  }
  return DEFAULT_LOCALE;
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

/** WordPress's Reading choice, as `site.json` spells it. */
export interface FrontPageSlugs {
  /** The page served at `/`, or empty for the site's latest posts. */
  homepage: string;
  /** The page whose permalink carries the listing, or empty for none. */
  postsPage: string;
}

export interface SiteColors {
  readonly scheme: ThemeScheme;
  readonly mode: ColorMode;
}

/**
 * The scheme a page of this site is drawn in, out of the theme's `schemes`,
 * and its mode: `colorScheme` when the theme declares it, else the theme's
 * first, and `colorMode` when it is one of {@link COLOR_MODES}, else `system`.
 * `undefined` for a theme with no schemes, whose page names neither.
 */
export function siteColors(
  site: SiteData,
  schemes: readonly ThemeScheme[],
): SiteColors | undefined {
  const named = site['colorScheme'];
  const scheme = themeScheme(schemes, typeof named === 'string' ? named.trim() : '');
  if (scheme === undefined) return undefined;
  const mode = COLOR_MODES.find((each) => each === site['colorMode']) ?? 'system';
  return { scheme, mode };
}
