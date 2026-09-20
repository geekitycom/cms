/**
 * Navigation: every menu this site holds, and what renders it.
 *
 * A menu is a named thing the site stores and the theme asks for (TASK-107),
 * and this is where somebody manages them. It is a top-level section after
 * Pages rather than a settings page, on purpose: a menu is content a site
 * arranges, the way its pages are, rather than a switch that changes how the
 * site behaves — and the shape of this screen comes from the active theme,
 * which is not something a page of fields can be.
 *
 * The screen is the cross product of two lists. The theme declares the areas
 * it renders, in `theme.json`, each a name and a label; the site stores menus
 * by name, in `content/_data/site.json`. An area with no stored menu is an
 * empty box to fill in, not a missing one. A stored menu no area names is
 * kept, rendered nowhere, and listed under a heading that says so — and this
 * is the only screen that can show it, because nothing on the public site ever
 * will.
 *
 * Adding a menu asks for a name, and that is the whole of adding one: a name
 * the theme declares moves the box up into place, and a name it does not is a
 * block waiting for the theme that will use it, which is what somebody writing
 * a menu before switching themes wants. Deleting is offered only for the
 * second kind, because an area the theme declares is emptied rather than
 * removed — the theme would render nothing there either way, and the box has
 * to stay for the next thing typed into it.
 */

import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import {
  menuItemLineProblem,
  menuItemsFromText,
  menuItemsText,
  menuNameProblem,
} from '../web/navigation.ts';
import type { NavigationMenus } from '../web/navigation.ts';
import { chooseTheme, PACKAGED_THEME_DIR, readTheme } from '../web/themes.ts';
import type { Theme, ThemeArea } from '../web/themes.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import { readSiteSettings, updateSiteSettings } from './settings.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/**
 * Where the Navigation screen lives.
 *
 * `/admin/navigation` itself rather than `/admin/navigation/menus`, the way
 * Tools is `/admin/tools`: a section's heading lands on its first child, and
 * this is the only one. It is also where one menu's items are saved.
 */
export const NAVIGATION_PATH = `${ADMIN_PREFIX}/navigation`;

/** Where the Add a menu form posts. */
export const ADD_MENU_PATH = `${NAVIGATION_PATH}/add`;

/** Where a Delete button posts. */
export const DELETE_MENU_PATH = `${NAVIGATION_PATH}/delete`;

/** The navigation section the screen marks as current. */
export const NAVIGATION_SECTION = 'navigation';

/** The child of that section it is. */
export const MENUS_CHILD = 'menus';

/** The fields the forms on the screen submit. */
export const NAVIGATION_FIELDS = {
  /** Which menu a save or a delete is about: its name. */
  menu: 'menu',
  /** One menu's items, one `Label | URL` per line. */
  items: 'items',
  /** The name the Add form asks for. */
  name: 'name',
} as const;

/** One menu as the screen draws it. */
export interface MenuBox {
  /** The menu's name: what `site.json` keys it by and a theme loops over. */
  name: string;
  /** What the box is headed: the theme's label for the area, or the name. */
  label: string;
  /** Its items, as the textarea shows them, one line each. */
  items: string;
  /** Whether the active theme declares an area of this name. */
  declared: boolean;
  /** Whether the site stores a menu under this name at all. */
  stored: boolean;
  /** How many items it holds, for the line under the heading. */
  count: number;
  /** What was wrong with what was just typed into it, when something was. */
  problem?: string | undefined;
}

/** The two lists the screen is, and the theme they were worked out from. */
export interface NavigationScreen {
  /** The active theme's areas, in the order it declares them. */
  areas: MenuBox[];
  /** Every stored menu no area names, by name. */
  others: MenuBox[];
  /** What the active theme is called, for the prose above both lists. */
  themeName: string;
}

/**
 * The theme whose areas this screen offers, and what it is called.
 *
 * The first theme on the render's own search path that declares any areas,
 * which for a site on the packaged theme is the packaged theme itself. That is
 * the same rule Nunjucks resolves a template by (decision-15): a site theme is
 * laid over the packaged one a file at a time and need only carry what it
 * changes, so a theme that declares no areas has not overridden the
 * declaration — and its inherited `layouts/base.njk` really is still rendering
 * `menus.primary` and `menus.footer`. A screen that showed no areas for it
 * would be offering nowhere to put the menus the site is visibly rendering.
 */
export function activeThemeAreas(options: { themesDir: string; chosen: string }): {
  areas: readonly ThemeArea[];
  themeName: string;
} {
  const chosen = chooseTheme({ themesDir: options.themesDir, name: options.chosen });
  const packaged = readTheme(PACKAGED_THEME_DIR);
  const themes: Theme[] = [
    ...(chosen.theme === undefined ? [] : [chosen.theme]),
    ...(packaged.ok ? [packaged.theme] : []),
  ];

  const declaring = themes.find((theme) => theme.areas.length > 0);
  const first = themes[0];

  return {
    areas: declaring?.areas ?? [],
    themeName: first?.name ?? 'The theme in use',
  };
}

/** What {@link navigationScreen} needs. */
export interface NavigationScreenOptions {
  /** Every menu the site stores, as `site.json` holds them. */
  menus: NavigationMenus;
  /** Where the site's themes are. */
  themesDir: string;
  /** The theme the site has chosen, empty for the packaged one. */
  chosen: string;
  /** What was typed into one box and refused, so the box shows it back. */
  typed?: { menu: string; items: string; problem: string } | undefined;
}

/**
 * The two lists the screen draws, out of the stored menus and the theme.
 *
 * The areas come first and in the theme's order, because that is the order
 * they appear on the site; the rest follow by name, which is the only order
 * they have. A menu is in exactly one of the two lists, so nothing is drawn
 * twice and nothing a site holds is left off.
 */
export function navigationScreen(options: NavigationScreenOptions): NavigationScreen {
  const { areas, themeName } = activeThemeAreas(options);
  const declared = new Set(areas.map((area) => area.name));

  const box = (name: string, label: string, declaredHere: boolean): MenuBox => {
    const stored = options.menus[name];
    const typed = options.typed?.menu === name ? options.typed : undefined;

    return {
      name,
      label,
      items: typed === undefined ? menuItemsText(stored ?? []) : typed.items,
      declared: declaredHere,
      stored: stored !== undefined,
      count: stored?.length ?? 0,
      ...(typed === undefined ? {} : { problem: typed.problem }),
    };
  };

  return {
    themeName,
    areas: areas.map((area) => box(area.name, area.label, true)),
    others: Object.keys(options.menus)
      .filter((name) => !declared.has(name))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => box(name, name, false)),
  };
}

/** What {@link mountNavigationScreen} needs from the admin around it. */
export interface MountNavigationOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/**
 * Register Navigation: the screen, the save of one menu, the add and the
 * delete.
 *
 * Three POSTs rather than one, for the reason a settings page's credential
 * form is its own: a refused add must not lose an edit somebody had typed into
 * a box further up the page, and a delete must not depend on every box on the
 * screen parsing. Each writes `content/_data/site.json` through the same
 * atomic update every settings save uses, applied to the file as re-read
 * inside the write (decision-9), so two people editing two menus at once both
 * land.
 */
export function mountNavigationScreen(
  app: Hono<GeekityEnv>,
  options: MountNavigationOptions,
): void {
  const { render } = options;

  app.get(NAVIGATION_PATH, (c) => render(c, ADMIN_TEMPLATES.navigation, screen(c)));

  // Saving one menu's items. The name comes from a hidden field rather than
  // the URL because that is what the form around the box already carries, and
  // a name that is not on the screen is refused rather than created: adding a
  // menu is the Add form's job, and a save that quietly invented one would
  // make a typo into a menu nothing renders.
  app.post(NAVIGATION_PATH, async (c) => {
    const body = await c.req.parseBody();
    const name = field(body[NAVIGATION_FIELDS.menu]).trim();
    const items = field(body[NAVIGATION_FIELDS.items]);

    const settings = readSiteSettings(c.var.config.contentDir);
    const shown = navigationScreen({
      menus: settings.menus,
      themesDir: c.var.config.themesDir,
      chosen: settings.theme,
    });

    const box = [...shown.areas, ...shown.others].find((entry) => entry.name === name);
    if (box === undefined) {
      flash(c, 'error', `Nothing was saved. This site has no menu called “${name}”.`);
      return c.redirect(NAVIGATION_PATH, 303);
    }

    // The box comes back holding exactly what was typed into it, so a line to
    // fix is still there to fix and nothing else on the screen has moved.
    const problem = menuItemLineProblem(items);
    if (problem !== undefined) {
      c.status(400);
      return render(c, ADMIN_TEMPLATES.navigation, {
        ...screen(c, { menu: name, items, problem }),
        hasProblems: true,
      });
    }

    const parsed = menuItemsFromText(items);
    await updateSiteSettings({
      contentDir: c.var.config.contentDir,
      change: (current) => ({ ...current, menus: { ...current.menus, [name]: parsed } }),
    });

    flash(c, 'notice', `${box.label} saved: ${count(parsed.length, 'item')}.`);
    return c.redirect(NAVIGATION_PATH, 303);
  });

  // Adding a menu is adding a name. It starts empty, and it starts stored, so
  // a menu written for a theme the site has not switched to yet is a menu the
  // file really holds rather than a box that forgets itself.
  app.post(ADD_MENU_PATH, async (c) => {
    const body = await c.req.parseBody();
    const name = field(body[NAVIGATION_FIELDS.name]).trim();

    const settings = readSiteSettings(c.var.config.contentDir);
    const problem = addMenuProblem(name, settings.menus);

    if (problem !== undefined) {
      c.status(400);
      return render(c, ADMIN_TEMPLATES.navigation, {
        ...screen(c),
        newName: name,
        nameProblem: problem,
        hasProblems: true,
      });
    }

    // An empty menu under that name, and only if the file still has none: the
    // re-read inside the write is the same guard the check above is, against
    // the same name added twice in the moment between them.
    await updateSiteSettings({
      contentDir: c.var.config.contentDir,
      change: (current) => ({
        ...current,
        menus: { ...current.menus, [name]: current.menus[name] ?? [] },
      }),
    });

    const { areas } = activeThemeAreas({
      themesDir: c.var.config.themesDir,
      chosen: settings.theme,
    });
    const declared = areas.some((area) => area.name === name);

    flash(
      c,
      'notice',
      declared
        ? `The “${name}” menu is ready to fill in, and this theme renders it.`
        : `The “${name}” menu is ready to fill in. This theme renders nothing under that name, so it is kept and rendered nowhere until a theme asks for it.`,
    );
    return c.redirect(NAVIGATION_PATH, 303);
  });

  // Deleting is the only way a menu is removed, and it is offered only for a
  // menu the theme renders nowhere. An area the theme declares is emptied
  // instead: deleting it would take away the box that is the only place its
  // links can be typed, and the theme would go on asking for the name.
  app.post(DELETE_MENU_PATH, async (c) => {
    const body = await c.req.parseBody();
    const name = field(body[NAVIGATION_FIELDS.menu]).trim();

    const settings = readSiteSettings(c.var.config.contentDir);
    const shown = navigationScreen({
      menus: settings.menus,
      themesDir: c.var.config.themesDir,
      chosen: settings.theme,
    });

    if (shown.areas.some((area) => area.name === name)) {
      flash(
        c,
        'error',
        `Nothing was deleted. This theme renders “${name}”, so it is emptied rather than removed: clear its box and save.`,
      );
      return c.redirect(NAVIGATION_PATH, 303);
    }
    if (!shown.others.some((other) => other.name === name)) {
      flash(c, 'error', `Nothing was deleted. This site has no menu called “${name}”.`);
      return c.redirect(NAVIGATION_PATH, 303);
    }

    await updateSiteSettings({
      contentDir: c.var.config.contentDir,
      change: (current) => {
        const menus = { ...current.menus };
        delete menus[name];
        return { ...current, menus };
      },
    });

    flash(c, 'notice', `The “${name}” menu is gone.`);
    return c.redirect(NAVIGATION_PATH, 303);
  });

  /** Everything the template renders. */
  function screen(
    c: Context<GeekityEnv>,
    typed?: { menu: string; items: string; problem: string },
  ): Record<string, unknown> {
    const settings = readSiteSettings(c.var.config.contentDir);
    const shown = navigationScreen({
      menus: settings.menus,
      themesDir: c.var.config.themesDir,
      chosen: settings.theme,
      typed,
    });

    return {
      section: NAVIGATION_SECTION,
      child: MENUS_CHILD,
      heading: 'Navigation',
      navigationUrl: NAVIGATION_PATH,
      addUrl: ADD_MENU_PATH,
      deleteUrl: DELETE_MENU_PATH,
      fields: NAVIGATION_FIELDS,
      areas: shown.areas,
      others: shown.others,
      themeName: shown.themeName,
      newName: '',
      nameProblem: '',
      hasProblems: false,
    };
  }
}

/**
 * What is wrong with a name the Add form submitted, or `undefined` when
 * nothing is.
 *
 * The spelling rule comes from {@link menuNameProblem}, which is where it is
 * written down; the only thing this adds is that the site does not already
 * hold one. Adding a name it does hold is refused rather than shrugged at,
 * because the box for that menu is already on the screen and an Add that
 * silently did nothing would read as one that had failed.
 */
export function addMenuProblem(name: string, menus: NavigationMenus): string | undefined {
  const problem = menuNameProblem(name);
  if (problem !== undefined) return problem;
  if (menus[name] !== undefined) {
    return `This site already has a menu called “${name}”. Its box is on this page.`;
  }
  return undefined;
}

/** "1 item", "2 items". */
function count(howMany: number, singular: string): string {
  return `${String(howMany)} ${howMany === 1 ? singular : `${singular}s`}`;
}

/** One submitted field as a string. */
function field(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
