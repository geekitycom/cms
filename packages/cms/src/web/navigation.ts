import type { SiteData } from './context.ts';

/** One entry of the site menu, as the setting and `site.json` spell it. */
export interface NavigationItem {
  /** The words on the link. */
  label: string;
  /** Where it goes: a site-root path, or an absolute URL for somewhere else. */
  url: string;
}

/** One entry of the menu a theme renders. */
export interface MenuItem extends NavigationItem {
  /** Whether this is the page being looked at, for `aria-current`. */
  current: boolean;
}

/** What {@link navigationMenu} builds a menu out of. */
export interface NavigationMenuOptions {
  /** The site data, whose `navigation` holds the whole menu. */
  site: SiteData;
  /** The path being rendered, which is what marks an item current. */
  url: string;
}

/**
 * The menu for one request: the items the setting names, with the one the
 * request is on marked.
 *
 * The setting is the only source of the menu (TASK-106). A page cannot put
 * itself in it, so there is one screen to edit the menu on, one order — the
 * order the lines were typed in — and no way for one link to appear twice. A
 * page that should be linked is linked by typing a line for it, including the
 * page a site serves as its front page: that one is typed `Home | /`, the URL
 * a reader lands on, rather than the permalink that redirects there.
 */
export function navigationMenu(options: NavigationMenuOptions): MenuItem[] {
  const here = comparablePath(options.url);

  return navigationItems(options.site).map((item) => ({
    ...item,
    current: here !== undefined && comparablePath(item.url) === here,
  }));
}

/**
 * The items the site data names, ignoring anything that is not one.
 *
 * Tolerant on the way out, the way `taxonomyBasesOrDefault` is: the settings
 * screen refuses a malformed item, so anything unreadable here came from a
 * hand-edited `site.json`, and a menu that quietly loses a line is a better
 * answer than a site that will not render.
 */
export function navigationItems(site: SiteData): NavigationItem[] {
  return navigationItemsOf(site['navigation']);
}

/**
 * A `navigation` value as the items it names, ignoring anything that is not
 * one.
 *
 * One spelling for the site data a render reads and the `navigation` the
 * settings screen writes, so a menu means the same thing to the theme and to
 * the form that edits it.
 */
export function navigationItemsOf(value: unknown): NavigationItem[] {
  if (!Array.isArray(value)) return [];

  const items: NavigationItem[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { label, url } = entry as Record<string, unknown>;
    if (typeof label !== 'string' || label === '') continue;
    if (typeof url !== 'string' || url === '') continue;
    items.push({ label, url });
  }
  return items;
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
