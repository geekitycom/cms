import { absoluteUrl } from './url.ts';
import { rewriteAttributes } from './html-attributes.ts';

const SRCSET_URL = /(^|,)(\s*)([^\s,]+)/g;

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function absoluteHtmlUrls(html: string, page: string, baseUrl: string): string {
  return rewriteAttributes(html, (name, value) => {
    if (name === 'src' || name === 'href') return absoluteFeedUrl(value, page, baseUrl);
    if (name === 'srcset') {
      return value.replace(
        SRCSET_URL,
        (_: string, comma: string, space: string, url: string) =>
          comma + space + absoluteFeedUrl(url, page, baseUrl),
      );
    }
    return undefined;
  });
}

/** A relative URL made absolute on the site's base URL; a fragment or a URL with a scheme is kept. */
export function absoluteFeedUrl(url: string, page: string, baseUrl: string): string {
  if (url === '' || url.startsWith('#') || SCHEME.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return absoluteUrl(url, baseUrl);
  return URL.parse(url, page)?.toString() ?? url;
}
