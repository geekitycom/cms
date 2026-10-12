/**
 * The front-matter key that names the language a post or a page is written
 * in, when it is not the site's (TASK-154). The name HTML gives the attribute,
 * so an Eleventy build reads the same key as page data.
 */
export const LANG_FRONT_MATTER_KEY = 'lang';

/**
 * What a language tag may look like: BCP 47's shape rather than its registry —
 * a two or three letter primary subtag followed by dash-separated subtags of
 * letters and digits.
 *
 * Checking the shape and not the registry is deliberate. The value ends up in
 * `<html lang>`, an RSS `<language>` and an Atom `xml:lang`, where a
 * well-formed tag a reader has never heard of is harmless and a malformed one
 * is not; refusing a valid tag because this CMS shipped before it was
 * registered would be worse than accepting one nobody uses.
 */
export const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,4}$/;
