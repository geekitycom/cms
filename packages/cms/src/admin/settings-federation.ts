/**
 * Federation: which relays the site subscribes to.
 *
 * There is nothing else on this page any more. decision-14 replaced the site
 * actor with one actor per user, so the handle, the type and the picture a
 * site used to federate under are a user's profile, edited on the users
 * screen; what is left here is the one setting that is an instruction as well
 * as a value — a line added is a `Follow` to send and a line removed is an
 * `Undo` — so a change to `site.relays`, from this page or anything else the
 * running site sets it through, reconciles them (the watch in
 * `cms/services.ts`).
 *
 * It is a settings page filed under Federation rather than under Settings
 * (TASK-109). The admin used to have two menu entries called Federation,
 * neither saying the other existed, and a person looking for the relays had no
 * reason to prefer one over the other. Now the section holds everything about
 * federation: Followers is what it is opened to look at, and this is what it
 * is opened to change. Nothing else moves with the label — the fields, the
 * save, the panels and the refusals are the settings-page machinery, exactly
 * as they were when the URL was `/admin/settings/federation`.
 */

import { FEDERATION_SETTINGS_PATH } from './federation.ts';
import { settingsPagePath } from './settings-page.ts';
import type { SettingsPage } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** The Federation settings page: Federation > Settings. */
export const FEDERATION_SETTINGS: SettingsPage = {
  section: 'federation',
  child: 'settings',
  // Settings under Federation, and headed Federation: the menu says which
  // section's settings these are, and the page and its flash say it too.
  label: 'Settings',
  heading: 'Federation',
  path: FEDERATION_SETTINGS_PATH,
  template: ADMIN_TEMPLATES.federationSettings,
  fields: ['relays'],

  endpoints: (app) => {
    // Where this page was until TASK-109. A bookmark points at it, and so do
    // the older editions of the README, so it moves somebody along rather than
    // telling them the screen they used is gone.
    app.get(settingsPagePath('federation'), (c) => c.redirect(FEDERATION_SETTINGS_PATH, 301));
  },
};
