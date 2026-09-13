import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

/** A directory under the themes directory that turned out not to be a theme. */
export interface UnreadableTheme {
  /** The directory name, as it sits on disk. */
  readonly id: string;
  /** Absolute path to it, so the screen can say where to go and look. */
  readonly dir: string;
  /** Why it is not a theme: {@link ThemeRead}'s reason. */
  readonly reason: string;
}

/** What is in a site's themes directory: the themes, and the near misses. */
export interface SiteThemes {
  /** Every directory that is a theme, by directory name. */
  readonly themes: readonly Theme[];
  /** Every directory that was meant to be one and is not. */
  readonly unreadable: readonly UnreadableTheme[];
}

/**
 * Everything in one site's themes directory.
 *
 * Both halves come back because the Appearance screen draws both: a folder
 * with a typo in its `theme.json` is listed with the reason rather than
 * silently skipped, because a theme that has quietly vanished from the list is
 * the hardest kind of mistake to find. The screen is the only caller —
 * rendering asks {@link chooseTheme} about one name instead, and never reads
 * the directory.
 *
 * Only a subdirectory is a candidate, and a hidden one is not even that: a
 * `themes/` with a `.DS_Store`, a `README.md` or a `.git` in it is a site with
 * no broken themes, not a site with three of them.
 *
 * A themes directory that is not there is an empty one. Nothing scaffolds it
 * (decision-15), so a site that has never written a theme has no directory,
 * and that is the ordinary state rather than a problem to report.
 */
export function listSiteThemes(themesDir: string): SiteThemes {
  const root = path.resolve(themesDir);

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return { themes: [], unreadable: [] };
  }

  const themes: Theme[] = [];
  const unreadable: UnreadableTheme[] = [];

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const dir = path.join(root, entry.name);
    const read = readTheme(dir);
    if (read.ok) themes.push(read.theme);
    else unreadable.push({ id: entry.name, dir, reason: read.reason });
  }

  return { themes, unreadable };
}

/**
 * The theme directories one render reads from, in order: the theme the site
 * has chosen first, the theme that ships in this package second.
 *
 * That is the whole override mechanism. A theme that ships only
 * `layouts/post.njk` replaces the post layout and keeps receiving updates to
 * every other template, and the same order decides a `/theme/` asset and a
 * mail template. The chosen directory need not exist.
 *
 * A site that has chosen nothing passes nothing, and reads the packaged theme
 * alone: an unchosen theme is never on the path, and the packaged one is never
 * on it twice (decision-15).
 */
export function themeSearchPath(chosenThemeDir?: string): string[] {
  return chosenThemeDir === undefined ? [PACKAGED_THEME_DIR] : [chosenThemeDir, PACKAGED_THEME_DIR];
}

/**
 * What a `theme` in `site.json` may be: the name of one directory inside the
 * themes directory, and nothing that would reach outside it.
 *
 * The setting is a word somebody picks off a list, so this is about a
 * hand-edited file rather than about an attacker — but the value decides a
 * directory every template is then read out of, so it is checked before it is
 * joined to a path rather than after.
 */
export function themeNameProblem(name: string): string | undefined {
  const chosen = name.trim();
  if (chosen === '') return undefined;
  if (chosen === '.' || chosen === '..' || /[/\\\0]/.test(chosen)) {
    return `"${chosen}" is not a theme name: a theme is one directory inside the themes directory.`;
  }
  return undefined;
}

/** Which theme a render reads from, and why it is that one. */
export interface ChosenTheme {
  /** The site theme in use, or `undefined` when the packaged one is. */
  readonly theme: Theme | undefined;
  /** The directories to read, in order: {@link themeSearchPath}. */
  readonly dirs: readonly string[];
  /**
   * Why the theme the site named is not the one in use, when it named one that
   * is not there or is not a theme. `undefined` both for a site running the
   * packaged theme on purpose and for one whose choice is working.
   */
  readonly problem: string | undefined;
}

/**
 * The theme one site has chosen, resolved against its themes directory.
 *
 * A choice that cannot be honoured is the packaged theme and a sentence saying
 * why, never an exception: a theme deleted from disk, or a `theme.json` broken
 * by a hand edit, has to leave the site up and answering — the alternative is
 * a site that 500s on every page because of a directory rename.
 */
export function chooseTheme(options: { themesDir: string; name: string }): ChosenTheme {
  const name = options.name.trim();
  if (name === '') return { theme: undefined, dirs: themeSearchPath(), problem: undefined };

  const badName = themeNameProblem(name);
  if (badName !== undefined) {
    return { theme: undefined, dirs: themeSearchPath(), problem: badName };
  }

  const read = readTheme(path.join(options.themesDir, name));
  if (!read.ok) {
    return {
      theme: undefined,
      dirs: themeSearchPath(),
      problem: `The theme "${name}" is not there: ${read.reason}`,
    };
  }

  return { theme: read.theme, dirs: themeSearchPath(read.theme.dir), problem: undefined };
}

/** Where {@link createThemeSource} says what it could not do. */
export interface ThemeLogger {
  warn(message: string): void;
}

/** The theme in use right now, asked afresh whenever anything renders. */
export interface ThemeSource {
  /**
   * The theme this render reads from.
   *
   * Cheap enough to call per render: it costs one read of the site's choice —
   * which is itself cached against the `stat` of `site.json` — and one `stat`
   * of the chosen theme's manifest.
   */
  current(): ChosenTheme;
}

/**
 * The one thing that knows which theme a site is rendering through.
 *
 * It is a source rather than a value because the choice is a setting in
 * `content/_data/site.json` (decision-9, decision-15): the Appearance screen
 * writes that file, a hand edit writes the same file, and both have to reach
 * the next request without a restart. So every consumer — the template
 * environment, the `/theme/` assets, the mail templates — asks here per render
 * instead of being handed a directory at boot.
 *
 * The result is cached against the choice and the `stat` of the chosen theme's
 * manifest, so an unchanged site pays one `stat` per render and a theme
 * edited, replaced or deleted under the running process is noticed on the next
 * one. A choice that cannot be honoured is logged once, when the answer
 * changes, rather than on every render: a site whose theme has been deleted
 * should say so in the log and then serve pages, not fill the log with the
 * same line.
 */
export function createThemeSource(options: {
  /** Where the site's themes are: {@link ResolvedConfig.themesDir}. */
  themesDir: string;
  /** The site's choice, read per call. The empty string is the packaged theme. */
  chosen: () => string;
  /** Where a choice that could not be honoured is reported. Defaults to `console`. */
  logger?: ThemeLogger | undefined;
}): ThemeSource {
  const logger = options.logger ?? console;

  let cached: ChosenTheme | undefined;
  let cachedKey: string | undefined;
  let reported: string | undefined;

  /**
   * What would make the answer different: the name chosen, and the state of
   * that theme's manifest. The modification time alone is not enough, for the
   * reason it is not in {@link createSiteDataSource}: a filesystem rounds it,
   * and a theme replaced wholesale changes the inode rather than the time.
   */
  function key(name: string): string {
    if (name === '') return '';
    try {
      const stats = statSync(path.join(options.themesDir, name, THEME_MANIFEST_FILE));
      return `${name}:${String(stats.mtimeMs)}:${String(stats.size)}:${String(stats.ino)}`;
    } catch {
      return `${name}:missing`;
    }
  }

  return {
    current() {
      const name = options.chosen().trim();
      const current = key(name);
      if (cached !== undefined && current === cachedKey) return cached;

      cachedKey = current;
      cached = chooseTheme({ themesDir: options.themesDir, name });

      if (cached.problem !== undefined && cached.problem !== reported) {
        logger.warn(`${cached.problem} The packaged theme is being used instead.`);
      }
      reported = cached.problem;

      return cached;
    },
  };
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
