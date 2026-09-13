import { Environment, FileSystemLoader } from 'nunjucks';

import { calendarDayIn, DEFAULT_TIMEZONE } from '../content/time.ts';
import { themeSearchPath } from './themes.ts';

/** Where a {@link createTemplateEnvironment} looks, and how it caches. */
export interface CreateTemplateEnvironmentOptions {
  /** The site's own theme directory. Searched first. It need not exist. */
  themeDir: string;
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
 * That is the whole override mechanism: a site that ships only
 * `theme/layouts/post.njk` replaces the post layout and keeps receiving
 * updates to every other template.
 */
export function createTemplateEnvironment(options: CreateTemplateEnvironmentOptions): Environment {
  const loader = new FileSystemLoader(themeSearchPath(options.themeDir), {
    noCache: options.noCache === true,
  });

  const environment = new Environment(loader, {
    autoescape: options.autoescape ?? true,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true,
  });

  return addFilters(environment, options.baseUrl);
}

/** How `date` renders a value. */
export type DateFormat = 'readable' | 'iso' | 'html' | 'year';

/**
 * The filter set, which is part of the semver contract because site templates
 * are written against it.
 *
 * Per decision-11 a date in a file is a UTC instant and the site's `timezone`
 * setting is the lens it is read through, so `readable`, `html` and `year` are
 * rendered in the site's zone and `iso` stays the instant. The zone comes from
 * the `site` global of the render in hand — Nunjucks calls a filter with the
 * template context as `this`, so nothing has to be threaded through every
 * template — which is what lets the setting change what every page shows
 * without a file changing. An Eleventy build of the same content applies the
 * same lens with Luxon and `zone` read from `site.json`.
 */
function addFilters(environment: Environment, baseUrl: string): Environment {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');

  environment.addFilter(
    'date',
    function (this: unknown, value: unknown, format: unknown = 'readable', timezone?: unknown) {
      return formatDate(
        value,
        typeof format === 'string' ? format : 'readable',
        typeof timezone === 'string' && timezone !== '' ? timezone : siteTimezone(this),
      );
    },
  );

  // Eleventy's `url` filter: make a site-root path absolute against the base
  // path, so a site served from a subdirectory links correctly.
  const withBasePath = (value: unknown): string => {
    const pathname = typeof value === 'string' ? value : '';
    return pathname.startsWith('/') ? `${basePath}${pathname}` : pathname;
  };

  environment.addFilter('url', withBasePath);

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

  return environment;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * `date` filter. An unparseable value renders as the empty string.
 *
 * `iso` is the instant, always in UTC, because that is what a `<time
 * datetime>` and a feed want and it must not move when a setting does. The
 * other three are the calendar the reader in `timezone` is on, which is what
 * makes a post published at half past midnight in Berlin say 1 October rather
 * than the 30 September UTC was still on.
 */
export function formatDate(
  value: unknown,
  format: string,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const date = toDate(value);
  if (date === undefined) return '';
  if (format === 'iso') return date.toISOString();

  const day = calendarDayIn(date, timezone);
  if (day === undefined) return '';

  const [year = '', month = '', dayOfMonth = ''] = day.split('-');

  switch (format) {
    case 'html':
      return day;
    case 'year':
      return year;
    case 'readable':
    default:
      return `${String(Number(dayOfMonth))} ${MONTHS[Number(month) - 1] ?? ''} ${year}`;
  }
}

/**
 * The zone the render in hand is in: the `timezone` of its `site` global.
 *
 * Nunjucks calls a filter with the template context as `this`, so the filter
 * can read a per-render value without the environment holding any state of its
 * own — which matters, because one environment serves every request and a zone
 * stored on it would be a race between two of them.
 */
function siteTimezone(context: unknown): string {
  if (typeof context !== 'object' || context === null) return DEFAULT_TIMEZONE;

  const lookup = (context as { lookup?: unknown }).lookup;
  if (typeof lookup !== 'function') return DEFAULT_TIMEZONE;

  const site: unknown = lookup.call(context, 'site');
  if (typeof site !== 'object' || site === null) return DEFAULT_TIMEZONE;

  const timezone = (site as Record<string, unknown>)['timezone'];
  return typeof timezone === 'string' && timezone !== '' ? timezone : DEFAULT_TIMEZONE;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}
