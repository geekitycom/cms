import { absoluteUrl } from './negotiate.ts';

/** Every start tag, with quoted attribute values allowed to hold a `>`. */
const START_TAG = /<[a-zA-Z](?:"[^"]*"|'[^']*'|[^"'>])*>/g;

/**
 * One attribute of a tag. Matched left to right over the whole tag, so text
 * inside another attribute's quoted value is consumed as that value and never
 * read as an attribute of its own.
 */
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The start of each candidate in a `srcset`, and the URL that opens it. */
const SRCSET_URL = /(^|,)(\s*)([^\s,]+)/g;

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Some rendered HTML with every relative `src`, `href` and `srcset` URL made
 * absolute, for a feed that is read away from the page.
 *
 * A root-relative URL goes on the site's base URL, as every other URL a feed
 * prints does; any other relative reference resolves against `page`, the
 * address it would have resolved against on the site. A URL with a scheme and
 * a fragment-only link stay as they were: the first is already absolute, and
 * the second (a footnote's, say) points within the item a reader is showing.
 *
 * Like `responsiveImages` in `images/markup.ts` it rewrites the text in place
 * rather than parsing, so every byte it does not rewrite is the byte the
 * renderer wrote. A value is resolved without decoding its entities, which is
 * safe because URL resolution carries the `&amp;` in a query through as is.
 */
export function absoluteHtmlUrls(html: string, page: string, baseUrl: string): string {
  const resolve = (url: string): string => {
    if (url === '' || url.startsWith('#') || SCHEME.test(url)) return url;
    if (url.startsWith('/') && !url.startsWith('//')) return absoluteUrl(url, baseUrl);
    return URL.parse(url, page)?.toString() ?? url;
  };

  return html.replace(START_TAG, (tag) =>
    tag.replace(
      ATTRIBUTE,
      (
        attribute: string,
        name: string,
        double: string | undefined,
        single: string | undefined,
        bare: string | undefined,
      ) => {
        const value = double ?? single ?? bare;
        const kind = name.toLowerCase();
        if (value === undefined || !(kind === 'src' || kind === 'href' || kind === 'srcset')) {
          return attribute;
        }
        const resolved =
          kind === 'srcset'
            ? value.replace(
                SRCSET_URL,
                (_: string, comma: string, space: string, url: string) =>
                  comma + space + resolve(url),
              )
            : resolve(value);
        if (resolved === value) return attribute;
        const quote = single === undefined ? '"' : "'";
        return `${name}=${quote}${resolved}${quote}`;
      },
    ),
  );
}
