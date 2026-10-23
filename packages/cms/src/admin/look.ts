/**
 * Appearance > Look: how the theme in use is coloured and set (decision-61).
 *
 * The screen is a column of sections, each a card with a form of its own that
 * posts to a path of its own and saves only its own settings. Colours is the
 * first: the active theme's colour schemes as radio cards drawn in each
 * scheme's own tokens, and the mode. Fonts is the second: a Google family for
 * each font role the theme declares, downloaded before it is saved.
 */

import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../web/env.ts';
import { trimmedField } from '../util/forms.ts';
import { chooseTheme, COLOR_MODES, findThemeFile, themeScheme } from '../theme/themes.ts';
import type { ColorMode, ThemeFont, ThemeScheme } from '../theme/themes.ts';
import { declaredFontRoles } from '../fonts/index.ts';
import type { FontRole } from '../fonts/index.ts';
import { schemeTokens } from '../theme/scheme-tokens.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { APPEARANCE_SECTION } from './appearance.ts';

export const LOOK_PATH = `${ADMIN_PREFIX}/appearance/look`;

/** Where the Colours section posts. */
export const LOOK_COLOURS_PATH = `${LOOK_PATH}/colours`;

/** Where the Fonts section posts. */
export const LOOK_FONTS_PATH = `${LOOK_PATH}/fonts`;

export const LOOK_CHILD = 'look';

/** What a font select posts for "type a family in". */
const CUSTOM = 'custom';

/** The body families offered by name: legible at length, with italic and bold. */
const BODY_FAMILIES = [
  'Atkinson Hyperlegible',
  'Source Serif 4',
  'Literata',
  'Merriweather',
  'Lora',
  'Source Sans 3',
  'IBM Plex Serif',
  'IBM Plex Sans',
];

/** Headings take every body family, and two display faces besides. */
const CURATED: Readonly<Record<FontRole['role'], readonly string[]>> = {
  body: BODY_FAMILIES,
  heading: [...BODY_FAMILIES, 'Fraunces', 'Playfair Display'],
};

/** A family as a role's form posts it: the select, and the box Custom uses. */
interface FontChoice {
  readonly picked: string;
  readonly custom: string;
}

/** One role's controls on the Fonts card. */
interface FontControl {
  role: string;
  label: string;
  fields: { select: string; custom: string };
  options: { value: string; label: string; selected: boolean }[];
  custom: string;
  customChosen: boolean;
  fallback: string;
  /** The saved family, as the sample line is set in it, when its files are here. */
  sample: { family: string; href: string } | undefined;
  problem: string | undefined;
}

/** The family a role's form names: the select's, or the box's under Custom. */
function familyOf(choice: FontChoice): string {
  return choice.picked === CUSTOM ? choice.custom.trim() : choice.picked;
}

function fontControl(
  font: ThemeFont,
  role: FontRole,
  saved: string,
  submitted: FontChoice | undefined,
  sample: FontControl['sample'],
  problem: string | undefined,
): FontControl {
  const curated = CURATED[role.role];
  const choice: FontChoice = submitted ?? {
    picked: saved === '' || curated.includes(saved) ? saved : CUSTOM,
    custom: saved === '' || curated.includes(saved) ? '' : saved,
  };
  return {
    role: role.role,
    label: font.label,
    fields: { select: role.setting, custom: `${role.setting}_custom` },
    options: [
      { value: '', label: 'The theme’s own' },
      ...curated.map((family) => ({ value: family, label: family })),
      { value: CUSTOM, label: 'Custom…' },
    ].map((option) => ({ ...option, selected: option.value === choice.picked })),
    custom: choice.custom,
    customChosen: choice.picked === CUSTOM,
    fallback: font.fallback,
    sample,
    problem,
  };
}

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

  // Each family is downloaded before anything is written, so a family Google
  // lacks, or one without the styles its role sets, is refused beside its
  // field and the site keeps the fonts it had (decision-61).
  app.post(LOOK_FONTS_PATH, async (c) => {
    const body = await c.req.parseBody();
    const roles = declaredFontRoles(activeTheme(c).fonts);
    const submitted = new Map<string, FontChoice>();
    const changes = new Map<string, string>();
    const fontProblems: Record<string, string> = {};

    for (const { role } of roles) {
      const choice = {
        picked: trimmedField(body, role.setting),
        custom: trimmedField(body, `${role.setting}_custom`),
      };
      submitted.set(role.role, choice);
      const family = familyOf(choice);
      if (family === '') {
        changes.set(role.setting, '');
        continue;
      }
      const fetched = await c.var.fonts.ensure(family, role.styles, c.req.raw.signal);
      if (fetched.ok) changes.set(role.setting, fetched.stylesheet.family);
      else fontProblems[role.role] = fetched.refusal.message;
    }

    if (Object.keys(fontProblems).length === 0) {
      const saved = await c.var.settings.set('site', changes, 'admin');
      if (saved.ok) {
        flash(c, 'notice', 'The fonts are saved.');
        return c.redirect(LOOK_PATH, 303);
      }
      for (const { role } of roles) {
        const problem = saved.problems[role.setting];
        if (problem !== undefined) fontProblems[role.role] = problem;
      }
    }

    c.status(400);
    return render(c, ADMIN_TEMPLATES.look, screen(c, undefined, { submitted, fontProblems }));
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
    fontsSubmitted?: {
      submitted: ReadonlyMap<string, FontChoice>;
      fontProblems: Readonly<Record<string, string>>;
    },
  ): Record<string, unknown> {
    const site = c.var.siteAtRequestStart;
    const chosen = activeTheme(c);
    const fonts = declaredFontRoles(chosen.fonts).map(({ font, role }) => {
      const family = site[role.setting];
      const hosted = family === '' ? undefined : c.var.fonts.stylesheet(family, role.styles);
      return fontControl(
        font,
        role,
        family,
        fontsSubmitted?.submitted.get(role.role),
        hosted,
        fontsSubmitted?.fontProblems[role.role],
      );
    });
    return {
      section: APPEARANCE_SECTION,
      child: LOOK_CHILD,
      heading: 'Look',
      coloursUrl: LOOK_COLOURS_PATH,
      fontsUrl: LOOK_FONTS_PATH,
      fonts,
      fontProblems: fontsSubmitted?.fontProblems,
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
