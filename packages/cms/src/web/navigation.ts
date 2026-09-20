import type { SiteData } from './context.ts';

/**
 * The menu a theme renders when nothing says which one it means: the menu that
 * was the whole of `navigation` before menus had names (TASK-107).
 */
export const DEFAULT_MENU_NAME = 'primary';

/**
 * The flags one menu item may carry, as `site.json` spells them and as the
 * settings screen writes them at the end of a line.
 *
 * A flag is a word rather than a value, and the list is here rather than
 * spread through the parsers so that a second one — `nofollow`, say, or a flag
 * that opens a link in its own tab — is one entry and its handling in the
 * theme, not a new shape for an item.
 */
export const MENU_ITEM_FLAGS = ['me'] as const;

/** One of {@link MENU_ITEM_FLAGS}. */
export type MenuItemFlag = (typeof MENU_ITEM_FLAGS)[number];

/** One entry of a menu, as `site.json` and the settings screen spell it. */
export interface NavigationItem {
  /** The words on the link. */
  label: string;
  /** Where it goes: a site-root path, or an absolute URL for somewhere else. */
  url: string;
  /**
   * Whether the link carries `rel="me"`, which is how Mastodon and the rest of
   * the IndieWeb verify that the site and the profile it links are the same
   * person.
   *
   * Present only when it is set. An unmarked item is spelled exactly as every
   * item was before flags existed, so a `site.json` holding a plain
   * `{ label, url }` is a complete item rather than one missing a key, and a
   * flag added later never has to be written across a file to mean nothing.
   */
  me?: true;
}

/** Every menu one site stores, by name. */
export type NavigationMenus = Record<string, NavigationItem[]>;

/** One entry of the menu a theme renders. */
export interface MenuItem extends NavigationItem {
  /** Whether this is the page being looked at, for `aria-current`. */
  current: boolean;
}

/** Every menu a theme renders, by name, marked for the page being rendered. */
export type MenuList = Record<string, MenuItem[]>;

/** What {@link navigationMenu} builds a menu out of. */
export interface NavigationMenuOptions {
  /** The site data, whose `menus` hold every menu it has. */
  site: SiteData;
  /** The path being rendered, which is what marks an item current. */
  url: string;
  /** Which menu. {@link DEFAULT_MENU_NAME} when nothing says. */
  name?: string | undefined;
}

/**
 * One named menu for one request: the items the site stores under that name,
 * with the one the request is on marked.
 *
 * The setting is the only source of a menu (TASK-106). A page cannot put
 * itself in one, so there is one screen to edit a menu on, one order — the
 * order the lines were typed in — and no way for one link to appear twice. A
 * page that should be linked is linked by typing a line for it, including the
 * page a site serves as its front page: that one is typed `Home | /`, the URL
 * a reader lands on, rather than the permalink that redirects there.
 *
 * A name the site has stored nothing under is an empty menu rather than an
 * error: a theme declaring an area the site has not filled in yet renders
 * nothing there, which is what an unfilled area should look like.
 */
export function navigationMenu(options: NavigationMenuOptions): MenuItem[] {
  return markCurrent(navigationItems(options.site, options.name), options.url);
}

/** What {@link navigationMenus} builds every menu out of. */
export interface NavigationMenusOptions {
  /** The site data, whose `menus` hold every menu it has. */
  site: SiteData;
  /** The path being rendered, which is what marks an item current. */
  url: string;
}

/**
 * Every menu one site stores, by name, marked for this request: what the
 * template context carries as `menus`.
 *
 * Every stored menu is here, not only the ones the theme in use declares an
 * area for. The declaration in `theme.json` is what the Navigation screen
 * reads to say where a menu can go (TASK-108); it is not a filter on the
 * render, because a theme that renders a menu it forgot to declare should look
 * wrong on the screen that lists areas rather than silently render nothing.
 * A menu no template loops over is simply rendered nowhere, and kept.
 */
export function navigationMenus(options: NavigationMenusOptions): MenuList {
  const menus: MenuList = {};
  for (const [name, items] of Object.entries(siteMenus(options.site))) {
    menus[name] = markCurrent(items, options.url);
  }
  return menus;
}

/**
 * The items of one named menu, ignoring anything that is not one.
 *
 * Tolerant on the way out, the way `taxonomyBasesOrDefault` is: the settings
 * screen refuses a malformed item, so anything unreadable here came from a
 * hand-edited `site.json`, and a menu that quietly loses a line is a better
 * answer than a site that will not render.
 */
export function navigationItems(
  site: SiteData,
  name: string = DEFAULT_MENU_NAME,
): NavigationItem[] {
  return navigationItemsOf(menusOf(site['menus'])[name]);
}

/**
 * Every menu the site data stores, by name.
 *
 * The one place `site.menus` is read on the render side, the way
 * {@link navigationItems} was the one place `site.navigation` was read before
 * menus had names. The old key is not read at all: a site.json still carrying
 * `navigation` has a key nothing looks at, which is what a rename means.
 */
export function siteMenus(site: SiteData): NavigationMenus {
  return menusOf(site['menus']);
}

/**
 * A `menus` value as the menus it names, ignoring anything that is not one.
 *
 * One spelling for the site data a render reads and the `menus` the settings
 * screen writes, so a menu means the same thing to the theme and to the form
 * that edits it. Anything but a plain object — a list, a string, nothing at
 * all — is a site with no menus; a name holding something that is not a list
 * is a menu with nothing in it, because the name is still a menu this site
 * holds and the Navigation screen has to be able to show it.
 */
export function menusOf(value: unknown): NavigationMenus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const menus: NavigationMenus = {};
  for (const [name, items] of Object.entries(value as Record<string, unknown>)) {
    if (name === '') continue;
    menus[name] = navigationItemsOf(items);
  }
  return menus;
}

/**
 * One menu's stored value as the items it names, ignoring anything that is not
 * one.
 *
 * A flag is read only when it is spelled exactly `true`: `"yes"`, `1` and
 * `false` all leave the item unmarked, so a flag is either set or it is not
 * and a theme writes `{% if item.me %}` without wondering what else the file
 * might have put there.
 */
export function navigationItemsOf(value: unknown): NavigationItem[] {
  if (!Array.isArray(value)) return [];

  const items: NavigationItem[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { label, url, me } = entry as Record<string, unknown>;
    if (typeof label !== 'string' || label === '') continue;
    if (typeof url !== 'string' || url === '') continue;
    items.push({ label, url, ...(me === true ? { me: true } : {}) });
  }
  return items;
}

/** One menu's items, with the one the request is on marked. */
function markCurrent(items: readonly NavigationItem[], url: string): MenuItem[] {
  const here = comparablePath(url);

  return items.map((item) => ({
    ...item,
    current: here !== undefined && comparablePath(item.url) === here,
  }));
}

/**
 * A menu URL as the string two of them are compared by: its path without the
 * trailing slash that is canonical here, or `undefined` when it is not a path
 * on this site at all.
 *
 * An item pointing somewhere else is never the page being looked at, even when
 * its URL happens to name this origin: it is a link off the site as far as the
 * menu is concerned, and the request path it would be compared against is
 * never absolute.
 */
function comparablePath(url: string): string | undefined {
  if (!url.startsWith('/')) return undefined;
  const path = url.split(/[?#]/)[0] ?? url;
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
