import { fileURLToPath } from 'node:url';

import { Environment, FileSystemLoader } from 'nunjucks';

/**
 * The theme that ships inside the package, resolved from this module rather
 * than from the working directory, so it is found whether the CMS is running
 * from `src/` under tsx or from `dist/` as an installed dependency.
 */
export const PACKAGED_THEME_DIR: string = fileURLToPath(
  new URL('../../themes/default/', import.meta.url),
);

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
}

/**
 * A Nunjucks environment whose loader searches the site theme first and the
 * packaged default theme second, one file at a time.
 *
 * That is the whole override mechanism: a site that ships only
 * `theme/layouts/post.njk` replaces the post layout and keeps receiving
 * updates to every other template.
 */
export function createTemplateEnvironment(options: CreateTemplateEnvironmentOptions): Environment {
  const loader = new FileSystemLoader([options.themeDir, PACKAGED_THEME_DIR], {
    noCache: options.noCache === true,
  });

  const environment = new Environment(loader, {
    autoescape: true,
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
 * Dates are formatted in UTC. A date in the front matter keeps its offset in
 * the file and in the JSON representation; what a theme prints is the same
 * instant expressed as UTC, which is what an Eleventy site using Luxon with
 * `zone: 'utc'` prints too.
 */
function addFilters(environment: Environment, baseUrl: string): Environment {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');

  environment.addFilter('date', (value: unknown, format: unknown = 'readable') =>
    formatDate(value, typeof format === 'string' ? format : 'readable'),
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

/** `date` filter. An unparseable value renders as the empty string. */
export function formatDate(value: unknown, format: string): string {
  const date = toDate(value);
  if (date === undefined) return '';

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  switch (format) {
    case 'iso':
      return date.toISOString();
    case 'html':
      return `${year}-${month}-${day}`;
    case 'year':
      return year;
    case 'readable':
    default:
      return `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''} ${year}`;
  }
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}
