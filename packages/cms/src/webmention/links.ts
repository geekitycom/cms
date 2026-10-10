import { absoluteUrl } from '../web/negotiate.ts';
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
 * Every page of this site a rendered body links to, as the path a permalink
 * is spelled with under {@link siteLinkKey}, each named once (TASK-322).
 *
 * These are the links {@link externalLinks} leaves out: nothing is sent for
 * them, and the index keeps them as the linked page's backlinks instead. A
 * root-relative link is read under the directory the site is served from, as
 * the feeds read it; any other relative link is read against the page it is
 * on, which is where a browser follows it from.
 */
export function ownSiteLinks(html: string, pageUrl: string, baseUrl: string): string[] {
  const found = new Set<string>();

  for (const element of elementsIn(parseHtml(html))) {
    if (element.name !== 'a') continue;

    const href = element.attributes['href'];
    const rooted = href?.startsWith('/') === true && !href.startsWith('//');
    const target = linkTarget(rooted ? absoluteUrl(href, baseUrl) : href, pageUrl);
    const sitePath = target === undefined ? undefined : sitePathOf(target, baseUrl);
    if (sitePath !== undefined) found.add(siteLinkKey(sitePath));
  }

  return [...found];
}

/**
 * A site path as a link to it is matched: without its trailing slash, since
 * the site answers both spellings with the same page.
 */
export function siteLinkKey(sitePath: string): string {
  return sitePath.length > 1 && sitePath.endsWith('/') ? sitePath.slice(0, -1) : sitePath;
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

  const pathname = url.pathname.slice(directory.length) || '/';
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
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
