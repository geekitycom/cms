/**
 * Federation: who the site is on the fediverse, and who boosts it.
 *
 * The handle and the type are the actor's identity (doc-4), so a save of this
 * page tells the followers. The relay list is the only setting that is an
 * instruction as well as a value — a line added is a `Follow` to send and a
 * line removed is an `Undo` — so a save of this page reconciles them too.
 */

import type { RelaySyncReport } from '../federation/relays.ts';
import { settingsPagePath, toldFollowers } from './settings-page.ts';
import type { SettingsPage } from './settings-page.ts';
import { ACTOR_TYPES, profileChanged } from './settings.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** The Federation settings page. */
export const FEDERATION_SETTINGS: SettingsPage = {
  child: 'federation',
  label: 'Federation',
  path: settingsPagePath('federation'),
  template: ADMIN_TEMPLATES.settingsFederation,
  fields: ['actorHandle', 'actorType', 'relays'],

  panels: () => ({ actorTypes: ACTOR_TYPES }),

  saved: async (c, before, after) => {
    // The handle and the type are the actor's profile, and a follower's copy of
    // it is only as fresh as the last thing it was told.
    const told = profileChanged(before, after) ? await c.var.delivery.updateActor() : undefined;

    // The reconciliation reads the settings that were just written, so it has
    // to come after the save rather than be derived from the form.
    const relays = c.var.relays.sync();

    return `${toldFollowers(told)}${toldRelays(relays)}`;
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
  return ` ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}; the Federation screen says where each stands.`;
}
