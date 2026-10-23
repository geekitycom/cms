/**
 * Appearance > Look: how the theme in use is coloured (decision-61).
 *
 * The screen is a column of sections, each a card with a form of its own that
 * posts to a path of its own and saves only its own settings. Colours is the
 * first: the active theme's colour schemes as radio cards drawn in each
 * scheme's own tokens, and the mode.
 */

import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../web/env.ts';
import { trimmedField } from '../util/forms.ts';
import { chooseTheme, COLOR_MODES, findThemeFile, themeScheme } from '../theme/themes.ts';
import type { ColorMode, ThemeScheme } from '../theme/themes.ts';
import { schemeTokens } from '../theme/scheme-tokens.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { APPEARANCE_SECTION } from './appearance.ts';

export const LOOK_PATH = `${ADMIN_PREFIX}/appearance/look`;

/** Where the Colours section posts. */
export const LOOK_COLOURS_PATH = `${LOOK_PATH}/colours`;

export const LOOK_CHILD = 'look';

const SCHEME_FIELD = 'color_scheme';
const MODE_FIELD = 'color_mode';

const MODE_LABELS: Readonly<Record<ColorMode, string>> = {
  system: 'Follow the system',
  light: 'Always light',
  dark: 'Always dark',
};

/** The four colours a swatch draws. */
interface Swatch {
  page: string;
  text: string;
  accent: string;
  secondary: string;
}

interface SchemeCard {
  name: string;
  label: string;
  chosen: boolean;
  light: Swatch | undefined;
  dark: Swatch | undefined;
}

interface ModeChoice {
  value: ColorMode;
  label: string;
  chosen: boolean;
}

function swatch(tokens: ReadonlyMap<string, string>): Swatch | undefined {
  const page = tokens.get('body');
  const text = tokens.get('text');
  const accent = tokens.get('primary');
  const secondary = tokens.get('secondary');
  if (page === undefined || text === undefined || accent === undefined || secondary === undefined)
    return undefined;
  return { page, text, accent, secondary };
}

function schemeCards(
  schemes: readonly ThemeScheme[],
  stylesheet: string | undefined,
  chosen: string,
): SchemeCard[] {
  const effective = themeScheme(schemes, chosen)?.name;
  return schemes.map((scheme) => {
    const tokens = stylesheet === undefined ? undefined : schemeTokens(stylesheet, scheme.name);
    return {
      name: scheme.name,
      label: scheme.label,
      chosen: scheme.name === effective,
      light: tokens === undefined ? undefined : swatch(tokens.light),
      dark: tokens === undefined ? undefined : swatch(tokens.dark),
    };
  });
}

function modeChoices(chosen: string): ModeChoice[] {
  const effective = COLOR_MODES.find((mode) => mode === chosen) ?? 'system';
  return COLOR_MODES.map((mode) => ({
    value: mode,
    label: MODE_LABELS[mode],
    chosen: mode === effective,
  }));
}

export interface MountLookOptions {
  render: AdminRender;
}

export function mountLookScreen(app: Hono<GeekityEnv>, options: MountLookOptions): void {
  const { render } = options;

  app.get(LOOK_PATH, (c) => render(c, ADMIN_TEMPLATES.look, screen(c)));

  app.post(LOOK_COLOURS_PATH, async (c) => {
    const body = await c.req.parseBody();
    const hasSchemes = activeTheme(c).schemes.length > 0;
    const scheme = trimmedField(body, SCHEME_FIELD);
    const mode = trimmedField(body, MODE_FIELD);

    const changes = new Map<string, string>([[MODE_FIELD, mode]]);
    if (hasSchemes) changes.set(SCHEME_FIELD, scheme);

    const saved = await c.var.settings.set('site', changes, 'admin');
    if (!saved.ok) {
      c.status(400);
      return render(c, ADMIN_TEMPLATES.look, {
        ...screen(c, { scheme, mode }),
        problems: Object.values(saved.problems),
      });
    }

    flash(c, 'notice', 'The colours are saved.');
    return c.redirect(LOOK_PATH, 303);
  });

  function activeTheme(c: Context<GeekityEnv>): ReturnType<typeof chooseTheme> {
    return chooseTheme({
      themesDir: c.var.config.themesDir,
      name: c.var.siteAtRequestStart.theme,
    });
  }

  /** Everything the Look template renders, with what was submitted when a save was refused. */
  function screen(
    c: Context<GeekityEnv>,
    submitted?: { scheme: string; mode: string },
  ): Record<string, unknown> {
    const site = c.var.siteAtRequestStart;
    const chosen = activeTheme(c);
    return {
      section: APPEARANCE_SECTION,
      child: LOOK_CHILD,
      heading: 'Look',
      coloursUrl: LOOK_COLOURS_PATH,
      fields: { scheme: SCHEME_FIELD, mode: MODE_FIELD },
      schemes: schemeCards(
        chosen.schemes,
        findThemeFile(chosen.dirs, 'static/style.css'),
        submitted?.scheme ?? site.color_scheme,
      ),
      savedScheme: themeScheme(chosen.schemes, site.color_scheme)?.name,
      modes: modeChoices(submitted?.mode ?? site.color_mode),
    };
  }
}
