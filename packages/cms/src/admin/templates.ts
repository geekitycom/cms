import { fileURLToPath } from 'node:url';

import { Environment, FileSystemLoader } from 'nunjucks';

import { formatDate } from '../web/templates.ts';

/**
 * The admin's templates, resolved from this module rather than the working
 * directory so they are found whether the CMS runs from `src/` under tsx or
 * from `dist/` as an installed dependency.
 *
 * They are a set of their own, not part of the theme search path: the theme a
 * site wears may override any public template, and must not be able to shadow
 * the login form or the CSRF field inside it (decision-4, decision-15).
 *
 * Under it are three siblings, and a template is in exactly one of them:
 *
 * - `pages/` — the screens, one folder per section of the admin menu, plus
 *   `account/` for the four screens shown when nobody is signed in yet.
 * - `layouts/` — the chrome a page extends: the document, the signed-in shell,
 *   and the shared settings page.
 * - `components/` — what a page imports or includes: the field macros and the
 *   flash.
 */
export const PACKAGED_ADMIN_DIR: string = fileURLToPath(new URL('../../admin/', import.meta.url));

/**
 * Templates {@link mountAdmin} asks for by name.
 *
 * The path of each is where the menu says it is, with one exception:
 * `pages/documents/` holds the four entries Posts, Pages, Categories and Tags
 * are made of, because a post and a page differ by a `kind` rather than by a
 * screen. `pages/documents/list.njk` says why at more length.
 */
export const ADMIN_TEMPLATES = {
  login: 'pages/account/login.njk',
  setup: 'pages/account/setup.njk',
  forgot: 'pages/account/forgot.njk',
  reset: 'pages/account/reset.njk',
  dashboard: 'pages/dashboard/home.njk',
  placeholder: 'pages/placeholder.njk',
  documentList: 'pages/documents/list.njk',
  documentEditor: 'pages/documents/editor.njk',
  documentConflict: 'pages/documents/conflict.njk',
  taxonomy: 'pages/documents/taxonomy.njk',
  navigation: 'pages/navigation/menus.njk',
  media: 'pages/media/library.njk',
  themes: 'pages/appearance/themes.njk',
  comments: 'pages/comments/all.njk',
  messages: 'pages/messages/all.njk',
  settingsGeneral: 'pages/settings/general.njk',
  settingsReading: 'pages/settings/reading.njk',
  settingsPermalinks: 'pages/settings/permalinks.njk',
  settingsDiscussion: 'pages/settings/discussion.njk',
  settingsEmail: 'pages/settings/email.njk',
  toolsContentIndex: 'pages/tools/content-index.njk',
  usersList: 'pages/users/list.njk',
  usersNew: 'pages/users/new.njk',
  usersEdit: 'pages/users/edit.njk',
  federation: 'pages/federation/followers.njk',
  federationSettings: 'pages/federation/settings.njk',
} as const;

/** How to build an {@link createAdminTemplateEnvironment}. */
export interface CreateAdminTemplateEnvironmentOptions {
  /**
   * Recompile a template on every render instead of caching it, so editing an
   * admin template in development shows up without a restart. On while the
   * content watcher is on, which is the same switch as "this is a dev server".
   */
  noCache?: boolean | undefined;
}

/** A Nunjucks environment over {@link PACKAGED_ADMIN_DIR} and nothing else. */
export function createAdminTemplateEnvironment(
  options: CreateAdminTemplateEnvironmentOptions = {},
): Environment {
  const loader = new FileSystemLoader([PACKAGED_ADMIN_DIR], {
    noCache: options.noCache === true,
  });

  const environment = new Environment(loader, {
    autoescape: true,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true,
  });

  // The same `date` filter the theme has, and formatted the same way, so a
  // date reads identically on the public site and in the admin listing.
  environment.addFilter('date', (value: unknown, format: unknown = 'readable') =>
    formatDate(value, typeof format === 'string' ? format : 'readable'),
  );

  return environment;
}
