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
  const site = originOf(baseUrl);
  const found = new Set<string>();

  for (const element of elementsIn(parseHtml(html))) {
    if (element.name !== 'a') continue;

    const target = linkTarget(element.attributes['href'], baseUrl);
    if (target === undefined) continue;
    if (site !== undefined && originOf(target) === site) continue;
    found.add(target);
  }

  return [...found];
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
