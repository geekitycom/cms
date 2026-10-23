import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../web/env.ts';
import { trimmedField } from '../util/forms.ts';
import { chooseTheme, COLOR_MODES, findThemeFile, themeScheme } from '../theme/themes.ts';
import type { ColorMode, ThemeFont, ThemeScheme } from '../theme/themes.ts';
import { declaredFontRoles } from '../fonts/index.ts';
import type { FontRole } from '../fonts/index.ts';
import { schemeTokens } from '../theme/scheme-tokens.ts';
import type { CssFontStack } from '../theme/font-family.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { APPEARANCE_SECTION } from './appearance.ts';

export const LOOK_PATH = `${ADMIN_PREFIX}/appearance/look`;

export const LOOK_COLOURS_PATH = `${LOOK_PATH}/colours`;

export const LOOK_FONTS_PATH = `${LOOK_PATH}/fonts`;

export const LOOK_CHILD = 'look';

const CUSTOM_FAMILY_OPTION = 'custom';

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

const CURATED: Readonly<Record<FontRole['role'], readonly string[]>> = {
  body: BODY_FAMILIES,
  heading: [...BODY_FAMILIES, 'Fraunces', 'Playfair Display'],
};

interface FontChoice {
  readonly picked: string;
  readonly custom: string;
}

interface FontControl {
  role: string;
  label: string;
  fields: { select: string; custom: string };
  options: { value: string; label: string; selected: boolean }[];
  custom: string;
  customChosen: boolean;
  fallback: CssFontStack;
  sample: { family: string; href: string } | undefined;
  problem: string | undefined;
}

function familyOf(choice: FontChoice): string {
  return choice.picked === CUSTOM_FAMILY_OPTION ? choice.custom.trim() : choice.picked;
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
    picked: saved === '' || curated.includes(saved) ? saved : CUSTOM_FAMILY_OPTION,
    custom: saved === '' || curated.includes(saved) ? '' : saved,
  };
  return {
    role: role.role,
    label: font.label,
    fields: { select: role.setting, custom: `${role.setting}_custom` },
    options: [
      { value: '', label: 'The theme’s own' },
      ...curated.map((family) => ({ value: family, label: family })),
      { value: CUSTOM_FAMILY_OPTION, label: 'Custom…' },
    ].map((option) => ({ ...option, selected: option.value === choice.picked })),
    custom: choice.custom,
    customChosen: choice.picked === CUSTOM_FAMILY_OPTION,
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
