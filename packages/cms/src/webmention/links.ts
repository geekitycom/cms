import { absoluteUrl } from '../web/negotiate.ts';
import {
  decodedPath,
  findPathRedirect,
  findQueryRedirect,
  redirectLocation,
  sortedQuery,
} from '../web/redirects.ts';
import type { RedirectTable } from '../web/redirects.ts';
import { elementsIn, parseHtml } from './html.ts';

/**
 * Which pages a post talks about.
 *
 * A webmention is "I wrote about you", so what goes out is decided by what the
 * post links to. Only the links pointing somewhere else count: telling this
 * site about its own pages would be a loop, and the conversation under a post
 * is not the place for it.
 */

/**
 * Every external page a rendered body links to, in the order it links to them
 * and each named once.
 *
 * A fragment is dropped. `#section` says where on a page to look and the page
 * is what the webmention is about, so two links into one article are one
 * target rather than two — and the `target` a receiver verifies is a page.
 */
export function externalLinks(html: string, baseUrl: string): string[] {
  const found = new Set<string>();

  for (const element of elementsIn(parseHtml(html))) {
    if (element.name !== 'a') continue;

    const target = externalTarget(element.attributes['href'], baseUrl);
    if (target !== undefined) found.add(target);
  }

  return [...found];
}

/**
 * One link to a page of this site, as the index keeps it: the path, spelled
 * as {@link siteLinkKey} spells a permalink, and the query sorted as a
 * redirect source's is, or `''`. The query is kept because the site answers
 * `/?p=7` with a redirect rather than with `/` (TASK-330).
 */
export interface SiteLink {
  readonly path: string;
  readonly query: string;
}

/**
 * Every page of this site a rendered body links to, each named once
 * (TASK-322).
 *
 * These are the links {@link externalLinks} leaves out: nothing is sent for
 * them, and the index keeps them as the linked page's backlinks instead. A
 * root-relative link is read under the directory the site is served from, as
 * the feeds read it; any other relative link is read against the page it is
 * on, which is where a browser follows it from.
 */
export function ownSiteLinks(html: string, pageUrl: string, baseUrl: string): SiteLink[] {
  const found = new Map<string, SiteLink>();

  for (const element of elementsIn(parseHtml(html))) {
    if (element.name !== 'a') continue;

    const href = element.attributes['href'];
    const rooted = href?.startsWith('/') === true && !href.startsWith('//');
    const target = linkTarget(rooted ? absoluteUrl(href, baseUrl) : href, pageUrl);
    const sitePath = target === undefined ? undefined : sitePathOf(target, baseUrl);
    if (target === undefined || sitePath === undefined) continue;

    const link = { path: siteLinkKey(sitePath), query: sortedQuery(new URL(target).search) };
    found.set(spelling(link), link);
  }

  return [...found.values()];
}

/**
 * A site path as a link to it is matched: without its trailing slash, since
 * the site answers both spellings with the same page.
 */
export function siteLinkKey(sitePath: string): string {
  return sitePath.length > 1 && sitePath.endsWith('/') ? sitePath.slice(0, -1) : sitePath;
}

/** A link as one string: its path, and its query when it has one. */
export function spelling(link: SiteLink): string {
  return link.query === '' ? link.path : `${link.path}?${link.query}`;
}

/**
 * The links that land on one document, as the site resolves a request for
 * them (TASK-330).
 */
export interface LinksInto {
  /** Paths a link lands here through, whatever query it carries. */
  readonly paths: string[];
  /** Links that land here only with exactly this query. */
  readonly queries: SiteLink[];
  /**
   * Links to one of {@link paths} that a query redirect sends somewhere else:
   * `/?p=7` names `/` but is not answered by the homepage.
   */
  readonly intercepted: string[];
}

/**
 * Every link that lands on a document, given the paths it is answered at.
 *
 * Walked backwards from those paths through the declared redirects pointing
 * at them, and each candidate is followed forwards the way a request is: a
 * query redirect first, then whatever the site serves at the path (`answers`),
 * then a declared path redirect. So a source that a live document shadows,
 * or that leads on somewhere else, is left out, and the answer follows the
 * redirect files as they are now.
 */
export function linksInto(
  table: RedirectTable,
  answeredAt: readonly string[],
  answers: (sitePath: string) => boolean,
): LinksInto {
  const ends = new Set(answeredAt);
  const paths = new Set(answeredAt);
  const queries = new Map<string, SiteLink>();
  const { pointingAt, queriesAt } = inverseOf(table);

  const queue = [...answeredAt];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const source of pointingAt.get(next) ?? []) {
      const spelled = spelling(source);
      if (paths.has(spelled) || queries.has(spelled)) continue;
      const end = landing(table, source, answers);
      if (end === undefined || !ends.has(end)) continue;
      if (source.query === '') paths.add(spelled);
      else queries.set(spelled, source);
      queue.push(spelled);
    }
  }

  const intercepted = [...paths].flatMap((sitePath) =>
    (queriesAt.get(sitePath) ?? []).filter((spelled) => !queries.has(spelled)),
  );
  return { paths: [...paths], queries: [...queries.values()], intercepted };
}

/** More hops than any chain the redirect files can declare without a loop. */
const MAX_HOPS = 20;

/**
 * The path a link ends on once every redirect it meets has been followed, or
 * `undefined` for one that leaves the site.
 */
function landing(
  table: RedirectTable,
  link: SiteLink,
  answers: (sitePath: string) => boolean,
): string | undefined {
  let current: SiteLink | undefined = link;
  for (let hop = 0; hop < MAX_HOPS && current !== undefined; hop += 1) {
    const search = current.query === '' ? '' : `?${current.query}`;
    const byQuery =
      findQueryRedirect(table, current.path, search) ??
      findQueryRedirect(table, `${current.path}/`, search);
    if (byQuery !== undefined) {
      current = siteLinkOf(byQuery.location);
      continue;
    }
    if (answers(current.path)) return current.path;
    const byPath = findPathRedirect(table, current.path);
    if (byPath === undefined) return current.path;
    current = siteLinkOf(redirectLocation(byPath, search));
  }
  return undefined;
}

interface Inverse {
  /** Each redirect source, by the path and the spelling its target names. */
  readonly pointingAt: ReadonlyMap<string, readonly SiteLink[]>;
  /** Each query source's spelling, by its path. */
  readonly queriesAt: ReadonlyMap<string, readonly string[]>;
}

const inverses = new WeakMap<RedirectTable, Inverse>();

/** The table turned around, once per parse of the redirect files. */
function inverseOf(table: RedirectTable): Inverse {
  const cached = inverses.get(table);
  if (cached !== undefined) return cached;

  const pointingAt = new Map<string, SiteLink[]>();
  const queriesAt = new Map<string, string[]>();
  const add = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [value]);
    else list.push(value);
  };
  const sources = [
    ...[...table.paths].map(([key, redirect]) => ({
      source: { path: siteLinkKey(key), query: '' },
      redirect,
    })),
    ...[...table.queries].map(([key, redirect]) => {
      // A sorted query is URL-encoded, so the last `?` is where it starts.
      const at = key.lastIndexOf('?');
      return {
        source: { path: siteLinkKey(key.slice(0, at)), query: key.slice(at + 1) },
        redirect,
      };
    }),
  ];
  for (const { source, redirect } of sources) {
    if (source.query !== '') add(queriesAt, source.path, spelling(source));
    const target = siteLinkOf(redirect.location);
    if (target === undefined) continue;
    add(pointingAt, target.path, source);
    if (target.query !== '') add(pointingAt, spelling(target), source);
  }

  const inverse = { pointingAt, queriesAt };
  inverses.set(table, inverse);
  return inverse;
}

/** A redirect's `Location` as the link it names, or `undefined` off the site. */
function siteLinkOf(location: string): SiteLink | undefined {
  if (!location.startsWith('/') || location.startsWith('//')) return undefined;
  const url = new URL(location, 'http://site.invalid');
  return { path: siteLinkKey(decodedPath(url.pathname)), query: sortedQuery(url.search) };
}

/**
 * The path under the site's base an absolute URL names, decoded as a
 * permalink is, or `undefined` for a URL that is not on the site.
 */
function sitePathOf(target: string, baseUrl: string): string | undefined {
  const url = new URL(target);
  const base = new URL(baseUrl);
  if (url.origin !== base.origin) return undefined;

  const directory = base.pathname.replace(/\/$/, '');
  if (url.pathname !== directory && !url.pathname.startsWith(`${directory}/`)) return undefined;

  return decodedPath(url.pathname.slice(directory.length) || '/');
}

/**
 * One URL as the external page it names, or `undefined` when it names none
 * this sends a webmention to: not a page, or one of this site's own.
 */
export function externalTarget(href: string | undefined, baseUrl: string): string | undefined {
  const target = linkTarget(href, baseUrl);
  if (target === undefined) return undefined;
  const site = originOf(baseUrl);
  return site !== undefined && originOf(target) === site ? undefined : target;
}

/**
 * One `href` as the page it names, or `undefined` when it names none this can
 * send a webmention to.
 *
 * Relative links are resolved against the site, which is where a rendered body
 * lives; anything that is not http or https is not a page with an endpoint.
 */
function linkTarget(href: string | undefined, baseUrl: string): string | undefined {
  if (href === undefined || href.trim() === '') return undefined;

  let url: URL;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  url.hash = '';
  return url.href;
}

/** One URL's origin, or `undefined` when it is not a URL at all. */
function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
