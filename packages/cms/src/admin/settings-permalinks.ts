/**
 * Permalinks: the URLs the archives live at, and the ones they used to.
 *
 * WordPress's own name for the page that decides URL shape. The two bases are
 * a pair — they may not be the same, and neither may take a path the site
 * already answers on — so they are validated together and shown together.
 *
 * The recorded archive renames are here as well, read-only: they are a record
 * of what happened rather than a preference, written by the taxonomy screens
 * as a term is renamed or merged, and this is the page whose fields decide
 * which URLs they are about.
 */

import { TAXONOMY_LABELS } from '../web/taxonomy.ts';
import { settingsPagePath } from './settings-page.ts';
import type { SettingsPage } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** The Permalinks settings page. */
export const PERMALINKS_SETTINGS: SettingsPage = {
  child: 'permalinks',
  label: 'Permalinks',
  path: settingsPagePath('permalinks'),
  template: ADMIN_TEMPLATES.settingsPermalinks,
  fields: ['tagBase', 'categoryBase'],

  panels: (_c, settings) => ({
    taxonomyRedirects: settings.taxonomyRedirects.map((entry) => ({
      ...entry,
      // What the taxonomy is called in a sentence, so the list reads as the
      // taxonomy screens name it rather than as the file spells it.
      label: TAXONOMY_LABELS[entry.taxonomy],
    })),
  }),
};
