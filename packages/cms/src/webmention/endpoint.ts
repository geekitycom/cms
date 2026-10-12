/**
 * The one public endpoint webmentions add.
 *
 * A single path under `/_geekity/`, like the comment form's, so it is out of
 * the way of every permalink a site might ever mint and the route table does
 * not grow with the site. It is what the `Link` header and the `<link>` in
 * every post's head point at, and it takes nothing but a form with a `source`
 * and a `target` in it.
 */

/** Where a webmention is sent. */
export const WEBMENTION_PATH = '/_geekity/webmention';

/** The fields a webmention carries, which the spec fixes. */
export const WEBMENTION_FIELDS = { source: 'source', target: 'target' } as const;

/**
 * The endpoint a page should advertise, or `undefined` when the site is not
 * taking webmentions.
 *
 * Read off the site data the renderer already has rather than the settings, so
 * a template asks one question and gets the same answer the endpoint gives.
 * A file that does not mention the setting is a site that takes them: that is
 * the default, and an older `site.json` should not quietly stop.
 */
export function webmentionEndpointFor(site: Record<string, unknown>): string | undefined {
  return site['webmentionsReceive'] === false ? undefined : WEBMENTION_PATH;
}
