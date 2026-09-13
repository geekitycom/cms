/**
 * Appearance > Themes: what the site is wearing, what else is on disk, and the
 * one button that changes it (decision-15).
 *
 * The theme is a setting in `content/_data/site.json` like every other, and it
 * is deliberately on no settings page. A settings page is a form of fields
 * somebody types into; this is a list of what a directory holds, and what you
 * do to a row is press it. So the screen is mounted the way the media library
 * is — its own module, its own template, one POST behind the same CSRF guard —
 * and it reaches the setting through the same `updateSiteSettings` and the
 * same field check the settings pages use, so the two doors cannot come to
 * disagree about what a valid theme is.
 *
 * The listing is a walk of the themes directory on every request, for the
 * reason the media screen walks `content/uploads/`: the directory is the truth
 * (decision-9). A theme copied in over ssh or pulled down by git is on the
 * screen the next time it is asked for, with no restart and nothing to index.
 */

import path from 'node:path';

import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import { listSiteThemes, PACKAGED_THEME_DIR, readTheme } from '../web/themes.ts';
import type { Theme } from '../web/themes.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import {
  formFromSettings,
  readSiteSettings,
  SETTINGS_FIELDS,
  settingsProblems,
  updateSiteSettings,
} from './settings.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** Where the themes screen lives, and where its one form posts. */
export const THEMES_PATH = `${ADMIN_PREFIX}/appearance/themes`;

/** The navigation section the screen marks as current. */
export const APPEARANCE_SECTION = 'appearance';

/** The child of that section the screen is. */
export const THEMES_CHILD = 'themes';

/**
 * The one field the form submits: the same name the setting has everywhere
 * else, so the value a card carries is the value that lands in `site.json`.
 */
export const THEME_FIELD = SETTINGS_FIELDS.theme;

/** One theme as a card on the screen. */
export interface ThemeCard {
  /** The directory name, which is what a `site.json` names it by. */
  id: string;
  /** The display name out of the manifest. */
  name: string;
  /** What the manifest says it is, when it says anything. */
  description?: string | undefined;
  /**
   * What the Activate button submits: the folder name, or the empty string for
   * the theme the package ships, which is how a site says "no theme of mine"
   * and is why the setting is absent rather than `""` when that is the answer.
   */
  value: string;
  /** Whether this is the theme the site is rendering through right now. */
  active: boolean;
  /** Whether it is the one inside the package rather than one of the site's. */
  packaged: boolean;
}

/**
 * The cards for one site, packaged theme first.
 *
 * First because it is the floor every other theme is laid over (decision-15):
 * a site theme ships what it changes and inherits the rest, so the packaged
 * one is not a peer in the list but the thing underneath all of them. The
 * site's own follow in directory order, which is the order they are named in.
 */
export function themeCards(options: { themes: readonly Theme[]; chosen: string }): ThemeCard[] {
  const chosen = options.chosen.trim();
  const packaged = readTheme(PACKAGED_THEME_DIR);

  const cards: ThemeCard[] = [];

  // Unreadable only if the package itself is broken, which is not a state a
  // screen can do anything about; the site's own themes are still listed.
  if (packaged.ok) {
    cards.push(card(packaged.theme, { value: '', active: chosen === '', packaged: true }));
  }

  for (const theme of options.themes) {
    cards.push(card(theme, { value: theme.id, active: chosen === theme.id, packaged: false }));
  }

  return cards;
}

/** One theme as the screen shows it. */
function card(
  theme: Theme,
  rest: { value: string; active: boolean; packaged: boolean },
): ThemeCard {
  return {
    id: theme.id,
    name: theme.name,
    ...(theme.description === undefined ? {} : { description: theme.description }),
    ...rest,
  };
}

/** What {@link mountAppearanceScreen} needs from the admin around it. */
export interface MountAppearanceOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/**
 * Register Appearance > Themes: the list, and the button that changes which
 * one the site is wearing.
 *
 * Activating is one write of `content/_data/site.json` and nothing else. There
 * is no cache to bust and nothing to tell: the `ThemeSource` asks the file
 * what the site has chosen on the next render, so the next request out of the
 * public site is already wearing it (decision-15).
 */
export function mountAppearanceScreen(
  app: Hono<GeekityEnv>,
  options: MountAppearanceOptions,
): void {
  const { render } = options;

  app.get(THEMES_PATH, (c) => render(c, ADMIN_TEMPLATES.themes, screen(c)));

  app.post(THEMES_PATH, async (c) => {
    const body = await c.req.parseBody();
    const submitted = (typeof body[THEME_FIELD] === 'string' ? body[THEME_FIELD] : '').trim();

    // The same check the settings pages run over this field, given the same
    // themes directory, so a name forged into this form is refused by the rule
    // a typed one would have been refused by: a folder that is not a theme, a
    // theme that has been deleted, and a name that is a path are all one "no".
    const form = {
      ...formFromSettings(readSiteSettings(c.var.config.contentDir)),
      theme: submitted,
    };
    const problem = settingsProblems(form, ['theme'], { themesDir: c.var.config.themesDir }).theme;

    if (problem !== undefined) {
      // The reason leads with the theme's name and does not always end in a
      // full stop — a JSON parser's complaint does not — so the sentence about
      // what happened goes first and the reason follows it.
      flash(c, 'error', `Nothing was changed. ${problem}`);
      return c.redirect(THEMES_PATH, 303);
    }

    // Applied to the settings re-read inside the write, like every settings
    // save: this screen changes one key, and a save of something else made
    // while the list was open must not be undone by it (decision-9).
    await updateSiteSettings({
      contentDir: c.var.config.contentDir,
      change: (current) => ({ ...current, theme: submitted }),
    });

    flash(c, 'notice', `${named(c, submitted)} is now this site’s theme.`);
    return c.redirect(THEMES_PATH, 303);
  });

  /** Everything the themes template renders. */
  function screen(c: Context<GeekityEnv>): Record<string, unknown> {
    const themesDir = c.var.config.themesDir;
    const chosen = readSiteSettings(c.var.config.contentDir).theme;
    const found = listSiteThemes(themesDir);

    return {
      section: APPEARANCE_SECTION,
      child: THEMES_CHILD,
      heading: 'Themes',
      themesUrl: THEMES_PATH,
      fields: { theme: THEME_FIELD },
      themes: themeCards({ themes: found.themes, chosen }),
      // Listed rather than skipped, so a typo in a `theme.json` is something
      // you can see from the screen that would otherwise have shown the theme.
      unreadable: found.unreadable,
      themesDir,
    };
  }

  /** A theme by its display name, for the flash. */
  function named(c: Context<GeekityEnv>, value: string): string {
    if (value === '') {
      const packaged = readTheme(PACKAGED_THEME_DIR);
      return packaged.ok ? packaged.theme.name : 'The packaged theme';
    }
    const read = readTheme(path.join(c.var.config.themesDir, value));
    return read.ok ? read.theme.name : value;
  }
}
