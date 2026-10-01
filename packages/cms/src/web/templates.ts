import { Environment, FileSystemLoader } from 'nunjucks';

import { calendarDayIn, DEFAULT_TIMEZONE } from '../content/time.ts';
import { accountOf } from '../federation/paths.ts';
import { themeAssetUrl } from './assets.ts';
import { siteLocale, siteTimezone } from './context.ts';
import type { SiteData } from './context.ts';
import { canonicalLocale, DEFAULT_LOCALE, pluralForm } from './locale.ts';
import { themeSearchPath } from './themes.ts';

/** Where a {@link createTemplateEnvironment} looks, and how it caches. */
export interface CreateTemplateEnvironmentOptions {
  /**
   * The theme directories to read, in the order {@link themeSearchPath} gives
   * them. Defaults to the packaged theme alone, which is what a site that has
   * chosen no theme of its own renders through. None of them need exist.
   *
   * Where they came from is the caller's business, and changing them later is
   * {@link useThemeDirs}: this is the environment's starting point, not a
   * promise that it will read the same directories forever.
   */
  themeDirs?: readonly string[] | undefined;
  /** Public origin, for the `url` and `absoluteUrl` filters. */
  baseUrl: string;
  /**
   * Recompile a template on every render instead of caching it. On while the
   * content watcher is on, so editing a template in development shows up
   * without a restart.
   */
  noCache?: boolean | undefined;
  /**
   * Whether `{{ }}` escapes for HTML. On everywhere a page is rendered, and
   * off for the plain text half of an email (TASK-55): a text body and a
   * subject line are not HTML, so escaping there turns an ampersand in a URL
   * into `&amp;` and an apostrophe in a name into `&#39;`.
   */
  autoescape?: boolean | undefined;
}

/**
 * A Nunjucks environment whose loader searches the theme directories in the
 * order {@link themeSearchPath} gives them, one file at a time.
 *
 * That is the whole override mechanism: a theme that ships only
 * `layouts/post.njk` replaces the post layout and keeps receiving updates to
 * every other template.
 */
export function createTemplateEnvironment(options: CreateTemplateEnvironmentOptions): Environment {
  const loader = new FileSystemLoader([...(options.themeDirs ?? themeSearchPath())], {
    noCache: options.noCache === true,
  });

  const environment = new Environment(loader, {
    autoescape: options.autoescape ?? true,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true,
  });

  return addFilters(environment, options.baseUrl, loader);
}

/**
 * Point an environment at these theme directories for the renders that follow.
 *
 * This is what makes a change of theme take effect without a restart. An
 * environment is built once per process and holds the filters a site added to
 * it, so switching theme by building a second one would either lose those
 * filters or hand two objects to something that was promised one. Nunjucks
 * reads `searchPaths` afresh on every miss, so moving the path and dropping
 * the compiled templates is the whole of it.
 *
 * Directories that have not changed cost nothing: the compiled templates are
 * only thrown away when the answer is actually different, so the ordinary
 * request — every request on a site that never changes theme — pays one array
 * comparison.
 */
export function useThemeDirs(environment: Environment, dirs: readonly string[]): void {
  // Through a cast because neither the loader's search paths nor the cache it
  // keeps them for are in the published types, though both are documented API
  // and both have been there since Nunjucks 2.
  const internals = environment as unknown as {
    loaders: { searchPaths?: string[] }[];
    invalidateCache(): void;
  };

  for (const loader of internals.loaders) {
    const paths = loader.searchPaths;
    if (paths === undefined) continue;
    if (paths.length === dirs.length && paths.every((dir, index) => dir === dirs[index])) continue;

    loader.searchPaths = [...dirs];
    internals.invalidateCache();
  }
}

/** How `date` renders a value. */
export type DateFormat =
  'readable' | 'full' | 'long' | 'medium' | 'short' | 'iso' | 'html' | 'year' | 'month';

/**
 * The filter set, which is part of the semver contract because site templates
 * are written against it.
 *
 * Per decision-11 a date in a file is a UTC instant and the site's `timezone`
 * setting is the lens it is read through, so every format but `iso` is
 * rendered in the site's zone and `iso` stays the instant; the words are the
 * site's locale (TASK-153), unless a template passes a locale of its own
 * after the zone, as the default theme does for a date inside an article
 * written in another language (TASK-189). Both come from the `site` global of the render in
 * hand — Nunjucks calls a filter with the template context as `this`, so
 * nothing has to be threaded through every template — which is what lets a
 * setting change what every page shows without a file changing. An Eleventy
 * build of the same content applies the same lens and locale with Intl, both
 * read from `site.json` (`docs/eleventy.config.example.js`).
 */
function addFilters(
  environment: Environment,
  baseUrl: string,
  loader: FileSystemLoader,
): Environment {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');

  environment.addFilter(
    'date',
    function (
      this: unknown,
      value: unknown,
      format: unknown = 'readable',
      timezone?: unknown,
      locale?: unknown,
    ) {
      const site = renderSite(this);
      return formatDate(
        value,
        typeof format === 'string' ? format : 'readable',
        typeof timezone === 'string' && timezone !== '' ? timezone : siteTimezone(site),
        (typeof locale === 'string' ? canonicalLocale(locale) : undefined) ?? siteLocale(site),
      );
    },
  );

  // `{{ count | plural({ one: "# reply", other: "# replies" }) }}`: the form
  // for the count's plural category in the site's locale (TASK-153). A theme
  // whose strings are in one language names it, so their grammar is that
  // language's whatever the site's locale.
  environment.addFilter(
    'plural',
    function (this: unknown, count: unknown, forms: unknown, locale?: unknown) {
      if (typeof forms !== 'object' || forms === null) return '';
      const tag =
        (typeof locale === 'string' ? canonicalLocale(locale) : undefined) ??
        siteLocale(renderSite(this));
      return pluralForm(Number(count), forms as Record<string, unknown>, tag);
    },
  );

  // Eleventy's `url` filter: make a site-root path absolute against the base
  // path, so a site served from a subdirectory links correctly.
  const withBasePath = (value: unknown): string => {
    const pathname = typeof value === 'string' ? value : '';
    return pathname.startsWith('/') ? `${basePath}${pathname}` : pathname;
  };

  environment.addFilter('url', withBasePath);

  // A theme file's URL with a hash of its bytes in it, so it can be cached for
  // a year. The directories are the loader's own, read on every call, so a
  // theme switch through `useThemeDirs` moves assets and layouts together.
  // The same cast as `useThemeDirs`, for the same undeclared field.
  const searchPaths = loader as unknown as { searchPaths: string[] };
  environment.addFilter('asset', (value: unknown) =>
    withBasePath(themeAssetUrl(typeof value === 'string' ? value : '', searchPaths.searchPaths)),
  );

  // A fully qualified URL, for canonical links, feeds and ActivityPub ids.
  // The base path goes on first, because a root-relative URL resolved against
  // an origin would otherwise throw the subdirectory away.
  environment.addFilter('absoluteUrl', (value: unknown) => {
    const pathname = withBasePath(value);
    try {
      return new URL(pathname, base).href;
    } catch {
      return pathname;
    }
  });

  // `{{ siteAuthor.username | fediverseHandle }}`: a user's own account on
  // this site, `@ada@example.com`, exactly as WebFinger answers for it
  // (TASK-202), so a theme never spells the host.
  environment.addFilter('fediverseHandle', (value: unknown) =>
    typeof value === 'string' && value !== '' ? `@${accountOf(value, baseUrl)}` : '',
  );

  return environment;
}

/**
 * What Intl is asked for, by format. `full`, `long`, `medium` and `short` are
 * Intl's own date styles, so a theme picks how much it wants said and the
 * locale decides how to say it; `readable` is `long` under the name it had
 * before there were styles.
 */
const INTL_FORMATS: Readonly<Record<string, Intl.DateTimeFormatOptions>> = {
  full: { dateStyle: 'full' },
  long: { dateStyle: 'long' },
  medium: { dateStyle: 'medium' },
  short: { dateStyle: 'short' },
  readable: { dateStyle: 'long' },
  month: { year: 'numeric', month: 'long' },
  year: { year: 'numeric' },
};

/** One formatter per locale, zone and format, since a page prints dozens. */
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `date` filter. An unparseable value renders as the empty string, and so
 * does a zone Intl does not know.
 *
 * `iso` is the instant, always in UTC, because that is what a `<time
 * datetime>` and a feed want and it must not move when a setting does. `html`
 * is the ISO calendar day in `timezone`, for the same attribute. The rest are
 * that calendar day written in `locale` by Intl, which is what makes a post
 * published at half past midnight in Berlin say 1 October rather than the 30
 * September UTC was still on, and a French site say `1 octobre`.
 *
 * `month` is the month that calendar day falls in, "September 2026", which is
 * what heads a group of an archive page (TASK-85). It is a format rather than
 * something the archive works out for itself so that a theme can head a group
 * of its own the same way.
 *
 * Bare `en` is written the way `en-GB` writes it, day before month, because
 * that is what the CMS printed before it had locales and `en` names a language
 * rather than a convention. A site that wants `September 2, 2026` says
 * `en-US`.
 */
export function formatDate(
  value: unknown,
  format: string,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE,
): string {
  const date = toDate(value);
  if (date === undefined) return '';
  if (format === 'iso') return date.toISOString();
  if (format === 'html') return calendarDayIn(date, timezone) ?? '';

  const options = INTL_FORMATS[format] ?? INTL_FORMATS['long'];
  const tag = canonicalLocale(locale) ?? DEFAULT_LOCALE;
  const key = `${tag}|${timezone}|${format}`;

  let formatter = formatters.get(key);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat(tag === 'en' ? 'en-GB' : tag, {
        ...options,
        timeZone: timezone,
      });
    } catch {
      return '';
    }
    formatters.set(key, formatter);
  }

  return formatter.format(date);
}

/**
 * The `site` global of the render in hand.
 *
 * Nunjucks calls a filter with the template context as `this`, so the filter
 * can read a per-render value without the environment holding any state of its
 * own — which matters, because one environment serves every request and a zone
 * or a locale stored on it would be a race between two of them.
 */
function renderSite(context: unknown): SiteData {
  const none = {} as SiteData;
  if (typeof context !== 'object' || context === null) return none;

  const lookup = (context as { lookup?: unknown }).lookup;
  if (typeof lookup !== 'function') return none;

  const site: unknown = lookup.call(context, 'site');
  return typeof site === 'object' && site !== null ? (site as SiteData) : none;
}

/**
 * A value as an instant, or `undefined` when it is not one.
 *
 * `'now'` is the one word the filter reads rather than parses, for the thing a
 * page has that no file carries: the year in the footer's copyright line. It is
 * read at render time rather than at boot so a site left running over New Year
 * says the new one, and it goes through the same zone lens as every other date,
 * so a site in Auckland turns the year over when Auckland does. Eleventy themes
 * spell it the same way, and `docs/eleventy.config.example.js` answers to it
 * too, so one footer renders identically in both builds.
 */
function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (value === 'now') return new Date();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}
