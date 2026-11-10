/** Where the admin lives. Everything under it needs a session. */
export const ADMIN_PREFIX = '/admin';

/**
 * URL prefix the admin's files are served under.
 *
 * The leading underscore keeps it out of the way of the screens: `/admin/posts`
 * is a screen and `/admin/_static/admin.css` never can be.
 */
export const ADMIN_ASSET_PREFIX = `${ADMIN_PREFIX}/_static/`;

/** Where the login form lives. */
export const LOGIN_PATH = `${ADMIN_PREFIX}/login`;

/** Where the list of users lives. */
export const USERS_PATH = `${ADMIN_PREFIX}/users`;

/**
 * Where one user is edited.
 *
 * The split documents.ts already makes between a listing and `basePath/:slug`:
 * the table says who there is, and one screen per person holds
 * every field that person has, each with a label beside it. A row of
 * unlabelled boxes in a table cell could not.
 */
export function editUserPath(id: number): string {
  return `${USERS_PATH}/${String(id)}`;
}

export const WIKI_ADMIN_PATH = `${ADMIN_PREFIX}/wiki`;

export function newWikiPagePath(slug: string, title: string): string {
  return `${WIKI_ADMIN_PATH}/new?${new URLSearchParams({ slug, title }).toString()}`;
}

export const PREVIEW_PATH = `${ADMIN_PREFIX}/preview`;

/**
 * A return address that stays in the admin, or `undefined`.
 *
 * Only a path under `/admin` that starts with a single slash, in printable
 * ASCII with no backslash, which a browser could read as a different host, and
 * no space or control character, which a header would refuse. The address
 * handed back is the one the parser read, so what is checked is what is sent.
 */
export function returnPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\/(?!\/)[!-[\]-~]*$/.test(value)) return undefined;
  const url = URL.parse(value, PLACEHOLDER_ORIGIN);
  if (url === null || url.origin !== PLACEHOLDER_ORIGIN) return undefined;
  const { pathname, search, hash } = url;
  if (pathname !== ADMIN_PREFIX && !pathname.startsWith(`${ADMIN_PREFIX}/`)) return undefined;
  return `${pathname}${search}${hash}`;
}

const PLACEHOLDER_ORIGIN = 'http://admin.invalid';
