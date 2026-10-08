/**
 * Federation: which relays the site subscribes to.
 *
 * There is nothing else on this page any more. decision-14 replaced the site
 * actor with one actor per user, so the handle, the type and the picture a
 * site used to federate under are a user's profile, edited on the users
 * screen; what is left here is the one setting that is an instruction as well
 * as a value — a line added is a `Follow` to send and a line removed is an
 * `Undo` — so a save of this page reconciles them.
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

import type { RelaySyncReport } from '../federation/relays.ts';
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

  saved: (c) => {
    // The reconciliation reads the settings that were just written, so it has
    // to come after the save rather than be derived from the form.
    return toldRelays(c.var.relays.sync());
  },

  endpoints: (app) => {
    // Where this page was until TASK-109. A bookmark points at it, and so do
    // the older editions of the README, so it moves somebody along rather than
    // telling them the screen they used is gone.
    app.get(settingsPagePath('federation'), (c) => c.redirect(FEDERATION_SETTINGS_PATH, 301));
  },
};

/**
 * The sentence a flash adds about the relays a save subscribed to or left.
 *
 * A relay does not answer at once — FEP-ae0c allows a human to approve the
 * subscription days later — so the message says a follow was sent rather than
 * that the site is now on the relay, and points at the screen that will say.
 */
function toldRelays(report: RelaySyncReport): string {
  const parts: string[] = [];
  if (report.followed.length > 0) {
    parts.push(
      report.followed.length === 1
        ? 'A follow has been sent to one new relay'
        : `Follows have been sent to ${String(report.followed.length)} new relays`,
    );
  }
  if (report.unfollowed.length > 0) {
    parts.push(
      report.unfollowed.length === 1
        ? 'one relay has been unfollowed'
        : `${String(report.unfollowed.length)} relays have been unfollowed`,
    );
  }
  if (parts.length === 0) return '';

  const sentence = parts.join(', and ');
  return ` ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}; the Followers screen says where each stands.`;
}
