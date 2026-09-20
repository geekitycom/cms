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

/**
 * What a menu name may be spelled with.
 *
 * A menu name is the word a theme writes after the dot in
 * `{% for item in menus.footer %}`, and the key `site.json` stores that menu
 * under. So it is an identifier before it is a slug: in a template
 * `menus.top-bar` is `menus.top` minus `bar`, which renders nothing, raises
 * nothing and leaves somebody looking at an empty page wondering which half is
 * broken. A hyphen is refused here so that cannot happen.
 *
 * Lower case is the other half of the rule, and it is what refuses the
 * spellings that would be confused with each other: `footer` and `Footer`
 * would be two menus on the Navigation screen, one of them rendered nowhere,
 * and no way to see the difference between them at a glance.
 */
export const MENU_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** The longest a menu name may be. Long enough for a phrase, short enough to read. */
export const MENU_NAME_MAX_LENGTH = 32;

/**
 * What is wrong with a proposed menu name, or `undefined` when nothing is.
 *
 * The rule governs a name somebody types on the Navigation screen (TASK-108).
 * A name a `theme.json` declares is a menu name by declaration and is shown as
 * the theme spells it: the theme decides where its own menus go, and a screen
 * that hid a declared area because it disliked the spelling would leave
 * somebody unable to fill in a menu their site renders.
 */
export function menuNameProblem(name: string): string | undefined {
  const proposed = name.trim();

  if (proposed === '') return 'A menu needs a name: it is what a theme asks for the menu by.';
  if (proposed.length > MENU_NAME_MAX_LENGTH) {
    return `A menu name is at most ${String(MENU_NAME_MAX_LENGTH)} characters, and "${proposed}" is longer.`;
  }
  if (proposed !== proposed.toLowerCase()) {
    return `A menu name is lower case, so "${proposed}" would be a second menu beside "${proposed.toLowerCase()}" that nothing could tell apart. Try "${proposed.toLowerCase()}".`;
  }
  if (!MENU_NAME_PATTERN.test(proposed)) {
    return (
      `"${proposed}" is not a menu name. A name is lower-case letters, digits and ` +
      `underscores and has to start with a letter, because a theme writes it after ` +
      `the dot — menus.footer — where a dash would be a minus sign.`
    );
  }

  return undefined;
}

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

/**
 * The non-empty lines of a menu box, trimmed.
 *
 * A blank line is not an error, exactly as it is not in the relay list: a
 * pasted menu leaves them, and a blank line asks for nothing.
 */
function menuLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * One `Label | URL` line as a menu item, or `undefined` when it is not one.
 *
 * The URL is either a site-root path or an absolute http(s) URL: a bare
 * `about/` would be resolved against whatever page it was printed on, which is
 * never what a menu means.
 *
 * A line may end in the flags the item carries, one per bar — `Mastodon |
 * https://example.social/@me | me` — and those are taken off the end first,
 * from the right, and only while the last part is the name of a flag this CMS
 * actually has ({@link MENU_ITEM_FLAGS}). That is what lets a URL still hold a
 * bar, a query string say: a trailing `| elsewhere` is not a flag, so it stays
 * part of the URL, where {@link isLinkUrl} refuses it for the space in front
 * of the bar, rather than being quietly read as a flag nobody asked for.
 *
 * What is left splits at its first bar, so a label still cannot hold one.
 */
export function menuItemOf(line: string): NavigationItem | undefined {
  const flags = new Set<string>();

  let rest = line;
  for (;;) {
    const bar = rest.lastIndexOf('|');
    if (bar === -1) break;
    const flag = rest
      .slice(bar + 1)
      .trim()
      .toLowerCase();
    if (!(MENU_ITEM_FLAGS as readonly string[]).includes(flag)) break;
    flags.add(flag);
    rest = rest.slice(0, bar);
  }

  const bar = rest.indexOf('|');
  if (bar === -1) return undefined;

  const label = rest.slice(0, bar).trim();
  const url = rest.slice(bar + 1).trim();
  if (label === '' || !isLinkUrl(url)) return undefined;

  return { label, url, ...(flags.has('me') ? { me: true } : {}) };
}

/**
 * A menu box as the ordered items it names, dropping the lines that are not
 * items.
 *
 * Call {@link menuItemLineProblem} first where a person is waiting to be told:
 * this is the tolerant read, which is what the old settings table's rows and a
 * validated box both go through. `site.json` is read by {@link menusOf}
 * instead, because the file holds objects rather than lines.
 */
export function menuItemsFromText(value: string): NavigationItem[] {
  const items: NavigationItem[] = [];
  for (const line of menuLines(value)) {
    const item = menuItemOf(line);
    if (item !== undefined) items.push(item);
  }
  return items;
}

/** The items as a box shows them: one line each, in order. */
export function menuItemsText(items: readonly NavigationItem[]): string {
  return items
    .map((item) => `${item.label} | ${item.url}${item.me === true ? ' | me' : ''}`)
    .join('\n');
}

/**
 * What is wrong with a typed menu, or `undefined` when nothing is.
 *
 * One message naming the first bad line rather than a count of how many there
 * are: a box is fixed a line at a time, and the line to fix is the useful
 * half of the sentence.
 */
export function menuItemLineProblem(value: string): string | undefined {
  const bad = menuLines(value).find((line) => menuItemOf(line) === undefined);
  return bad === undefined
    ? undefined
    : `A menu item is "Label | URL", one per line, where the URL is ` +
        `${LINK_URL_RULE}, and ends "| me" for a link that should carry ` +
        `rel="me". "${bad}" is not one.`;
}

/**
 * What a URL typed into a link box may be, in the words both boxes explain it
 * in: the menu on the Navigation screen and the Links on a user's profile.
 *
 * One sentence fragment rather than two, so the rule {@link isLinkUrl} applies
 * is worded the same wherever somebody is told about it (TASK-112). Somebody
 * who learns one box should not be taught the wrong thing about the other.
 */
export const LINK_URL_RULE =
  'a path like /about/ or an absolute http:// or https:// URL, with no spaces in it';

/**
 * Whether a typed URL is one a link box accepts: a site-root path, or an
 * absolute http(s) URL, and no whitespace either way.
 *
 * A bare `about/` would be resolved against whatever page it was printed on,
 * which is never what a link box means, and a `javascript:` or `data:` URL is
 * not somewhere a reader goes.
 *
 * The whitespace half is not decoration. `new URL` does not throw on
 * `https://shll.me/@a | me`: it reads the space and the bar as path
 * characters and percent-encodes them, so a check that only asked the parser
 * took a label, a URL and a trailing word as one URL and stored it — which is
 * how a reader of shll.me ended up at `/author/a%20%7C%20me/` (TASK-112). A
 * URL somebody types has no spaces in it; a space means they typed two things.
 *
 * Deliberately a test rather than a normaliser: a link keeps the URL as it was
 * typed, so `https://example.social/@me` is what the link says and what the
 * box shows it back as.
 */
export function isLinkUrl(url: string): boolean {
  if (url === '' || /\s/.test(url)) return false;
  if (url.startsWith('/')) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
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
