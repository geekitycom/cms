import { isFontFamilyName } from '../theme/font-family.ts';
import type { ThemeFont } from '../theme/themes.ts';
import type { FontStyle } from './family.ts';
import type { FontStore } from './store.ts';

/**
 * The font roles a site can set a Google family for (decision-61): the
 * setting that holds it, the key `site.json` keeps it under, and the styles
 * the role uses, which the family must have. Body text sets regular, italic
 * and bold; headings set bold.
 */
export const FONT_ROLES = [
  {
    role: 'heading',
    setting: 'heading_font',
    fileKey: 'headingFont',
    styles: [{ weight: 700, italic: false }],
  },
  {
    role: 'body',
    setting: 'body_font',
    fileKey: 'bodyFont',
    styles: [
      { weight: 400, italic: false },
      { weight: 400, italic: true },
      { weight: 700, italic: false },
    ],
  },
] as const satisfies readonly {
  role: string;
  setting: string;
  fileKey: string;
  styles: readonly FontStyle[];
}[];

export type FontRole = (typeof FONT_ROLES)[number];

/** A font role a page sets: the theme's role, and the hosted family it is set in. */
export interface PageFont {
  readonly font: ThemeFont;
  /** The family as Google names it. */
  readonly family: string;
  /** The hosted `@font-face` stylesheet, same-origin and fingerprinted. */
  readonly href: string;
  /** What the role's custom property is set to: the family, then the theme's stack. */
  readonly value: string;
}

/** The roles the theme declares that the site can set a font for, in {@link FONT_ROLES} order. */
export function declaredFontRoles(
  declared: readonly ThemeFont[],
): { readonly font: ThemeFont; readonly role: FontRole }[] {
  return FONT_ROLES.flatMap((role) => {
    const font = declared.find((each) => each.role === role.role);
    return font === undefined ? [] : [{ font, role }];
  });
}

/**
 * The roles the theme declares that the site can set, each with the family
 * `site.json` names for it under its file key, empty when it names none.
 */
export function chosenFonts(
  site: Readonly<Record<string, unknown>>,
  declared: readonly ThemeFont[],
): { readonly font: ThemeFont; readonly role: FontRole; readonly family: string }[] {
  return declaredFontRoles(declared).map(({ font, role }) => {
    const named = site[role.fileKey];
    return { font, role, family: typeof named === 'string' ? named.trim() : '' };
  });
}

export interface PageFontsOptions {
  readonly store: FontStore;
  /** Queue a fetch of a family whose files are missing. */
  readonly refetch: (family: string, styles: readonly FontStyle[]) => Promise<unknown>;
}

/**
 * The fonts a page is set in: each role the theme declares whose family the
 * site chose and whose files are here. A family whose files are gone is left
 * out, so the page falls back to the theme's stack, and a fetch of it is
 * queued once until its files are back.
 */
export function createPageFonts(
  options: PageFontsOptions,
): (site: Readonly<Record<string, unknown>>, declared: readonly ThemeFont[]) => PageFont[] {
  const { store, refetch } = options;
  const queued = new Set<string>();

  return (site, declared) =>
    chosenFonts(site, declared).flatMap(({ font, role, family }) => {
      if (!isFontFamilyName(family)) return [];
      const key = `${family}\n${role.role}`;
      const stylesheet = store.stylesheet(family, role.styles);
      if (stylesheet === undefined) {
        if (!queued.has(key)) {
          queued.add(key);
          refetch(family, role.styles).catch((thrown: unknown) => {
            queued.delete(key);
            console.warn(`No fetch of the font ${family} was queued: ${String(thrown)}`);
          });
        }
        return [];
      }
      queued.delete(key);
      return [
        {
          font,
          family: stylesheet.family,
          href: stylesheet.href,
          value: `"${stylesheet.family}", ${font.fallback}`,
        },
      ];
    });
}
