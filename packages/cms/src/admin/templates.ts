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
 * The DaisyUI admin under construction (decision-30), with the same
 * `layouts/`, `components/`, `pages/` and `static/` as {@link PACKAGED_ADMIN_DIR}
 * and holding only what has been converted so far. `GEEKITY_ADMIN=daisyui`
 * lays it over the old admin; the flip renames it to `admin/`.
 */
export const DAISYUI_ADMIN_DIR: string = fileURLToPath(new URL('../../daisyui/', import.meta.url));

/**
 * The admin roots `GEEKITY_ADMIN` asks for, first match wins: the old admin
 * alone when it is unset or empty, and `daisyui/` ahead of it when it is
 * `daisyui`, so a converted file is served from there and an unconverted one
 * still from `admin/`.
 *
 * A value it does not know is refused, so a misspelt switch fails at boot
 * instead of quietly serving the admin somebody meant to leave behind.
 */
export function adminDirectories(env: Record<string, string | undefined>): readonly string[] {
  const value = env['GEEKITY_ADMIN'] ?? '';
  if (value === '') return [PACKAGED_ADMIN_DIR];
  if (value === 'daisyui') return [DAISYUI_ADMIN_DIR, PACKAGED_ADMIN_DIR];
  throw new Error(
    `GEEKITY_ADMIN is ${JSON.stringify(value)}; set it to "daisyui" for the DaisyUI admin, or leave it unset`,
  );
}

/**
 * The admin roots this process serves from, read once at load. Every reader of
 * an admin file goes through it: the template loader, the static files, and
 * the tests that read templates by path.
 */
export const ADMIN_DIRS: readonly string[] = adminDirectories(process.env);

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
  syndication: 'pages/documents/syndication.njk',
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
  settingsPrivacy: 'pages/settings/privacy.njk',
  toolsContentIndex: 'pages/tools/content-index.njk',
  toolsPersonalData: 'pages/tools/personal-data.njk',
  usersList: 'pages/users/list.njk',
  usersNew: 'pages/users/new.njk',
  usersEdit: 'pages/users/edit.njk',
  connectedApps: 'pages/users/apps.njk',
  appActivity: 'pages/users/activity.njk',
  appActivityEntry: 'pages/users/activity-entry.njk',
  federation: 'pages/federation/followers.njk',
  federationSettings: 'pages/federation/settings.njk',
  indieauthConsent: 'pages/indieauth/consent.njk',
  indieauthRefused: 'pages/indieauth/refused.njk',
  serverError: 'pages/error.njk',
  publicAdminBar: 'components/public-admin-bar.njk',
} as const;

/** How to build an {@link createAdminTemplateEnvironment}. */
export interface CreateAdminTemplateEnvironmentOptions {
  /**
   * Recompile a template on every render instead of caching it, so editing an
   * admin template in development shows up without a restart. On while the
   * content watcher is on, which is the same switch as "this is a dev server".
   */
  noCache?: boolean | undefined;
  /** The admin roots to load from, first match wins. {@link ADMIN_DIRS} when absent. */
  roots?: readonly string[] | undefined;
}

/**
 * The `modifier` filter, `{{ COLORS | modifier(color) }}`: the class `classes`
 * maps `value` to with a space before it, so `class="btn{{ … }}"` reads right,
 * or nothing when `value` is absent or maps to `''`. Any other value throws,
 * naming the keys.
 */
function modifierClass(classes: unknown, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const known = typeof classes === 'object' && classes !== null ? classes : {};
  const found: unknown =
    typeof value === 'string' && Object.hasOwn(known, value)
      ? (known as Record<string, unknown>)[value]
      : undefined;
  if (typeof found !== 'string') {
    throw new Error(`${JSON.stringify(value)} is not one of ${Object.keys(known).join(', ')}`);
  }
  return found === '' ? '' : ` ${found}`;
}

/** A Nunjucks environment over `options.roots`, {@link ADMIN_DIRS} by default, and nothing else. */
export function createAdminTemplateEnvironment(
  options: CreateAdminTemplateEnvironmentOptions = {},
): Environment {
  const loader = new FileSystemLoader([...(options.roots ?? ADMIN_DIRS)], {
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
  environment.addFilter('modifier', modifierClass);

  return environment;
}
