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
