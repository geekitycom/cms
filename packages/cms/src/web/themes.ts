import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where a theme is, and what makes a directory one.
 *
 * This module is the only place that knows the packaged theme's path and the
 * order the directories are searched in. The template environment, the
 * `/theme/` asset finder, the mail environment and the per-render probe for
 * the optional front-page and posts-page layouts all ask here, so there is one
 * answer to "which theme is this render reading from" rather than four copies
 * of the same two-element array (decision-15).
 *
 * The admin is deliberately not a theme. Its templates and its static files
 * live at `admin/` with a loader of their own and are never on this path, so a
 * site theme cannot shadow the login form or the CSRF field inside it
 * (decision-4).
 */

/**
 * The theme that ships inside the package, resolved from this module rather
 * than from the working directory, so it is found whether the CMS is running
 * from `src/` under tsx or from `dist/` as an installed dependency.
 */
export const PACKAGED_THEME_DIR: string = fileURLToPath(
  new URL('../../themes/default/', import.meta.url),
);

/** The file a directory declares itself a theme with. */
export const THEME_MANIFEST_FILE = 'theme.json';

/**
 * The only kind of theme there is.
 *
 * The field exists so a second kind — the admin, if it is ever made
 * overridable — can slot in without the manifest format changing, and so a
 * manifest that names a kind this CMS does not have is refused rather than
 * loaded as a site theme by accident.
 */
export const SITE_THEME_KIND = 'site';

/** What kinds of theme a manifest may declare. One, today. */
export type ThemeKind = typeof SITE_THEME_KIND;

/** One theme directory, read and validated. */
export interface Theme {
  /** The directory name, which is the theme's id and what a site.json names. */
  readonly id: string;
  /** Absolute path to the directory the manifest was read from. */
  readonly dir: string;
  /** The display name, for the admin's list. */
  readonly name: string;
  /** What the theme themes. Always {@link SITE_THEME_KIND} today. */
  readonly kind: ThemeKind;
  /** One line about the theme, when the manifest wrote one. */
  readonly description?: string | undefined;
}

/** A theme, or the reason the directory is not one. */
export type ThemeRead =
  { readonly ok: true; readonly theme: Theme } | { readonly ok: false; readonly reason: string };

/**
 * Read one directory as a theme.
 *
 * Every way of not being a theme comes back the same way — `ok: false` and a
 * sentence saying why — because every caller has the same job with it: a
 * listing greys the directory out, a chosen theme that stopped being one falls
 * back to the packaged default with the reason logged, and the admin refuses
 * to save it. None of them wants an exception, and a directory that is simply
 * not a theme is not exceptional: a site's `themes/` will have a `.DS_Store`
 * in it soon enough.
 */
export function readTheme(dir: string): ThemeRead {
  const directory = path.resolve(dir);
  const manifestFile = path.join(directory, THEME_MANIFEST_FILE);

  let source: string;
  try {
    source = readFileSync(manifestFile, 'utf8');
  } catch {
    return { ok: false, reason: `There is no ${THEME_MANIFEST_FILE} in ${directory}.` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${manifestFile} is not valid JSON: ${detail}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: `${manifestFile} is not a JSON object.` };
  }

  const manifest = parsed as Record<string, unknown>;

  const name = manifest['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, reason: `${manifestFile} has no name.` };
  }

  const kind = manifest['kind'];
  if (kind !== SITE_THEME_KIND) {
    const named = typeof kind === 'string' ? `"${kind}"` : 'nothing';
    return {
      ok: false,
      reason: `${manifestFile} declares kind ${named}, and the only theme kind is "${SITE_THEME_KIND}".`,
    };
  }

  const description = manifest['description'];

  return {
    ok: true,
    theme: {
      id: path.basename(directory),
      dir: directory,
      name: name.trim(),
      kind: SITE_THEME_KIND,
      ...(typeof description === 'string' && description.trim() !== ''
        ? { description: description.trim() }
        : {}),
    },
  };
}

/**
 * The theme directories one render reads from, in order: the site's own theme
 * first, the theme that ships in this package second.
 *
 * That is the whole override mechanism. A site that ships only
 * `layouts/post.njk` replaces the post layout and keeps receiving updates to
 * every other template, and the same order decides a `/theme/` asset and a
 * mail template. The site directory need not exist.
 */
export function themeSearchPath(siteThemeDir: string): string[] {
  return [siteThemeDir, PACKAGED_THEME_DIR];
}

/**
 * The first theme on the path that ships one file, by absolute path, or
 * `undefined` when none of them does.
 *
 * Nunjucks resolves its own templates through the same order, so this is for
 * the two questions asked outside a render: whether a theme has written the
 * optional front-page or posts-page layout, and which halves of a mail message
 * exist. A path that climbs out of a theme directory finds nothing, so a
 * caller passing a name through from a request cannot reach the file system
 * around it.
 */
export function findThemeFile(themeDirs: readonly string[], relative: string): string | undefined {
  if (relative === '' || relative.includes('\0')) return undefined;
  const segments = relative.split('/').filter((segment) => segment !== '');

  for (const directory of themeDirs) {
    const root = path.resolve(directory);
    const file = path.resolve(root, ...segments);
    if (file !== root && !file.startsWith(root + path.sep)) continue;
    if (existsSync(file)) return file;
  }

  return undefined;
}
