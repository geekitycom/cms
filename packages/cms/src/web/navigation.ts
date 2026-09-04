import type { Document } from '../content/document.ts';
import type { SiteData } from './context.ts';

/**
 * The front-matter key a page opts into the menu with, and the one that orders
 * it among the others.
 *
 * Neither is in `KNOWN_FRONT_MATTER_KEYS`, so the parser leaves both in
 * {@link Document.extra} and the editor reads and writes them there, exactly
 * as it does `eleventyExcludeFromCollections`. Eleventy sees them as ordinary
 * data keys, which is what lets a build render the same menu.
 */
export const NAVIGATION_KEY = 'navigation';

/** @see {@link NAVIGATION_KEY} */
export const NAVIGATION_ORDER_KEY = 'navigationOrder';

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
  /** The site data, whose `navigation` holds the explicit items. */
  site: SiteData;
  /** The public pages, of which the ones that opted in join the menu. */
  pages: readonly Document[];
  /** The path being rendered, which is what marks an item current. */
  url: string;
}

/** The menu for one request: the explicit items, then the pages that opted in. */
export function navigationMenu(options: NavigationMenuOptions): MenuItem[] {
  const here = comparablePath(options.url);
  const items = [...navigationItems(options.site), ...navigationPages(options.pages)];

  return items.map((item) => ({
    ...item,
    current: here !== undefined && comparablePath(item.url) === here,
  }));
}

/**
 * The pages that put themselves in the menu, in the order they belong in.
 *
 * They come after the items the setting names, so the menu a site typed out
 * stays as it was typed and a page opting in appends itself rather than
 * landing in the middle of it. Among themselves they go by
 * `navigationOrder` and then by title, and a page that names no order sorts
 * after every page that does: an order is a way of pulling one page to the
 * front, not something every page has to carry before any of them can.
 */
export function navigationPages(pages: readonly Document[]): NavigationItem[] {
  return pages
    .filter((document) => document.extra[NAVIGATION_KEY] === true)
    .map((document) => ({
      label: document.title,
      url: document.permalink,
      order: navigationOrder(document),
    }))
    .sort(
      (a, b) =>
        (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) ||
        a.label.localeCompare(b.label),
    )
    .map(({ label, url }) => ({ label, url }));
}

/** A page's `navigationOrder`, when it carries a usable one. */
export function navigationOrder(document: Document): number | undefined {
  const value = document.extra[NAVIGATION_ORDER_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
