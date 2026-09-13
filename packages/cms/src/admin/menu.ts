/**
 * The admin's left-hand menu: which sections there are, what is under each of
 * them, and which one a screen is standing in.
 *
 * The shape is WordPress classic. A section is a heading with one or more
 * children; clicking the heading opens the section and lands on its first
 * child; the open section shows its children and the one you are on is marked.
 * Every section has at least one child even when it has exactly one screen,
 * because that is what makes the rule uniform — a second child can appear
 * later without the menu changing shape, and no screen has to know whether it
 * is the only one of its kind.
 *
 * The registry below is the whole menu. A screen names its section and its
 * child, {@link adminMenu} turns that pair into the rendered list, and a pair
 * the registry does not hold is refused rather than quietly rendered as a
 * menu with nothing marked.
 */

import { COMMENTS_PATH } from './comments.ts';
import { newEditorPath, PAGE_KIND, POST_KIND } from './documents.ts';
import { FEDERATION_PATH } from './federation.ts';
import { MEDIA_PATH } from './media.ts';
import { MESSAGES_PATH } from './messages.ts';
import { SETTINGS_PATH } from './settings.ts';
import { ADMIN_PREFIX } from './session.ts';
import { CATEGORY_KIND, TAG_KIND } from './taxonomy.ts';
import { ADD_USER_PATH, USERS_PATH } from './users.ts';

/** One screen under a section, as the menu lists it. */
export interface AdminMenuChild {
  /** The name a screen passes as `child` to mark itself current. */
  child: string;
  /** What the link says. */
  label: string;
  /** Where it goes. */
  url: string;
}

/** One top-level entry in the admin's left-hand navigation. */
export interface AdminSection {
  /** The name a screen passes as `section` to open it. */
  section: string;
  /** What the heading says. */
  label: string;
  /** Where the heading goes: its first child, always. */
  url: string;
  /** The screens under it, in the order they are shown. Never empty. */
  children: readonly AdminMenuChild[];
}

/** A section as a screen renders it: the same entry, plus where you are. */
export interface AdminMenuSection extends AdminSection {
  /** Whether this is the section being looked at, so its children show. */
  open: boolean;
  /** Its children, each saying whether it is the screen being looked at. */
  children: readonly AdminMenuCurrentChild[];
}

/** A child as a screen renders it. */
export interface AdminMenuCurrentChild extends AdminMenuChild {
  /** Whether this is the screen being looked at, for `aria-current`. */
  current: boolean;
}

/** Where a screen says it is standing. */
export interface AdminScreenLocation {
  /** The section it is under. */
  section?: string | undefined;
  /** The child of that section it is. */
  child?: string | undefined;
}

/** A screen naming a section or a child the registry does not hold. */
export class UnknownAdminScreenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownAdminScreenError';
  }
}

/**
 * The sections of the admin, in the order doc-5 lists them.
 *
 * Adding a screen to the menu is one entry in one of these `children` lists
 * and the same `child` name on whatever the screen passes to `render`.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  section('dashboard', 'Dashboard', [{ child: 'home', label: 'Home', url: ADMIN_PREFIX }]),
  section('posts', 'Posts', [
    { child: 'all', label: 'All posts', url: POST_KIND.basePath },
    { child: 'new', label: 'Add new', url: newEditorPath(POST_KIND) },
    // The terms live here rather than at the top level because that is what
    // they are about: a tag with no post on it is nothing.
    { child: 'categories', label: 'Categories', url: CATEGORY_KIND.basePath },
    { child: 'tags', label: 'Tags', url: TAG_KIND.basePath },
  ]),
  section('pages', 'Pages', [
    { child: 'all', label: 'All pages', url: PAGE_KIND.basePath },
    { child: 'new', label: 'Add new', url: newEditorPath(PAGE_KIND) },
  ]),
  section('media', 'Media', [{ child: 'library', label: 'Library', url: MEDIA_PATH }]),
  section('comments', 'Comments', [{ child: 'all', label: 'All comments', url: COMMENTS_PATH }]),
  section('messages', 'Messages', [{ child: 'all', label: 'All messages', url: MESSAGES_PATH }]),
  section('users', 'Users', [
    { child: 'all', label: 'All users', url: USERS_PATH },
    { child: 'new', label: 'Add new', url: ADD_USER_PATH },
  ]),
  // One child until TASK-73 splits the settings screen into its pages.
  section('settings', 'Settings', [{ child: 'general', label: 'General', url: SETTINGS_PATH }]),
  section('federation', 'Federation', [
    { child: 'followers', label: 'Followers', url: FEDERATION_PATH },
  ]),
];

/**
 * The whole menu, with the section a screen named open and the child it named
 * marked current.
 *
 * A screen outside the shell — the login form, the two halves of forgetting a
 * password — names neither, and gets a menu with nothing open, which is what
 * the templates that never render it expect. Anything else has to name both:
 * a section with no child is a screen that only knows half of where it is, and
 * would render a menu that expands around nothing.
 */
export function adminMenu(location: AdminScreenLocation = {}): AdminMenuSection[] {
  const { section: name, child } = location;

  if (name !== undefined) {
    const found = ADMIN_SECTIONS.find((entry) => entry.section === name);
    if (found === undefined) {
      throw new UnknownAdminScreenError(`The admin menu has no section called ${quoted(name)}.`);
    }
    if (child === undefined) {
      throw new UnknownAdminScreenError(
        `A screen under ${quoted(name)} named no child. Every admin screen is a child of its section.`,
      );
    }
    if (!found.children.some((entry) => entry.child === child)) {
      throw new UnknownAdminScreenError(
        `The admin menu's ${quoted(name)} section has no child called ${quoted(child)}.`,
      );
    }
  }

  return ADMIN_SECTIONS.map((entry) => ({
    ...entry,
    open: entry.section === name,
    children: entry.children.map((item) => ({
      ...item,
      current: entry.section === name && item.child === child,
    })),
  }));
}

/** One section, landing on the first of its children. */
function section(name: string, label: string, children: AdminMenuChild[]): AdminSection {
  const [first] = children;
  // Not reachable from the registry above, which names children for every
  // section; it is here so the type of `url` is a string rather than a maybe.
  if (first === undefined) throw new Error(`The ${label} admin section has no children.`);
  return { section: name, label, url: first.url, children };
}

/** A name as it reads in a message. */
function quoted(value: string): string {
  return JSON.stringify(value);
}
