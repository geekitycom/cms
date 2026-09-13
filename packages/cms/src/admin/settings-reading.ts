/**
 * Reading: what a visitor is shown, and who is told when it changes.
 *
 * WordPress's Reading page is what the homepage displays and how many posts a
 * listing holds; this one adds the site menu, which is the other thing that
 * decides what somebody arriving can reach, and the notify server, which is
 * how a subscriber hears that a feed moved on without waiting for their next
 * poll.
 */

import type { Context } from 'hono';

import { isPublicDocument } from '../web/documents.ts';
import type { GeekityEnv } from '../env.ts';
import { settingsPagePath } from './settings-page.ts';
import type { SettingsPage } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** One page the homepage or the posts page may be. */
export interface PageChoice {
  /** What the setting stores. */
  slug: string;
  /** What the option reads. */
  title: string;
}

/** The published pages, by title, as the two picks offer them. */
export function pageChoices(c: Context<GeekityEnv>): PageChoice[] {
  const now = c.var.store.now();

  return c.var.store
    .listAll({ type: 'page', draft: false, trashed: false, scheduled: false })
    .filter((document) => isPublicDocument(document, now))
    .map((document) => ({ slug: document.slug, title: document.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The Reading settings page.
 *
 * The two picks are a select each rather than a text field, so what a site can
 * choose is what it actually has. A pick whose page has since been drafted,
 * trashed or deleted is not on the list any more: the setting keeps the slug —
 * putting the page back puts the front page back — and the page says which one
 * has gone, because a select that had quietly reset itself to "Your latest
 * posts" would be the screen lying about what is stored.
 */
export const READING_SETTINGS: SettingsPage = {
  child: 'reading',
  label: 'Reading',
  path: settingsPagePath('reading'),
  template: ADMIN_TEMPLATES.settingsReading,
  fields: ['homepage', 'postsPage', 'postsPerPage', 'navigation', 'notifyServer'],

  panels: (c, settings) => {
    const choices = pageChoices(c);
    const missing = (slug: string): boolean =>
      slug !== '' && !choices.some((choice) => choice.slug === slug);

    return {
      pageChoices: choices,
      homepageMissing: missing(settings.homepage),
      postsPageMissing: missing(settings.postsPage),
    };
  },
};
