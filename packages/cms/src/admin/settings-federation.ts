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
import {
  readWordPressRequests,
  WORDPRESS_ACTIVITYPUB_BASE,
  WORDPRESS_SHARED_INBOX_PATH,
} from '../federation/wordpress.ts';
import type { WordPressRequests, WordPressRoute } from '../federation/wordpress.ts';
import { listUsers } from './accounts.ts';
import type { User } from './accounts.ts';
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
  fields: ['relays', 'wordpressActivityPub'],

  panels: (c) => ({
    wordpressRoutes: wordPressRoutes(
      listUsers(c.var.config.dataDir),
      readWordPressRequests(c.var.config.dataDir),
    ),
  }),

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

/** The order the paths are listed in, which is the order the plugin's actor names them. */
const WORDPRESS_ROUTE_ORDER: readonly WordPressRoute[] = [
  'actor',
  'inbox',
  'outbox',
  'followers',
  'following',
];

/** One compatibility path, as the panel beside the switch shows it. */
export interface WordPressRouteRow {
  /** The path itself, which is what a peer still holds. */
  readonly path: string;
  /** Whose it is, or the empty string for the instance-wide inbox. */
  readonly username: string;
  /** When it was last asked for, or `null` for never. */
  readonly lastRequestedAt: string | null;
}

/**
 * Every path the compatibility switch answers, and when each was last asked
 * for.
 *
 * The whole point of the panel: the switch can come off once no follower's
 * server is delivering to the old URLs any more, and that is a question only
 * the record of what was asked for can answer. So a route nobody has ever
 * asked for is listed too, saying never — an empty table would read as "no
 * such path" rather than as "nobody is using it".
 *
 * A user with no WordPress number is not here at all: the plugin never
 * published a path for them, so there is nothing for a peer to be holding.
 */
export function wordPressRoutes(
  users: readonly User[],
  requests: WordPressRequests,
): WordPressRouteRow[] {
  const rows: WordPressRouteRow[] = [];

  for (const user of users) {
    if (user.wordpressActorId === undefined) continue;
    const asked = requests.users[user.username] ?? {};
    const actor = `${WORDPRESS_ACTIVITYPUB_BASE}/actors/${String(user.wordpressActorId)}`;

    for (const route of WORDPRESS_ROUTE_ORDER) {
      rows.push({
        path: route === 'actor' ? actor : `${actor}/${route}`,
        username: user.username,
        lastRequestedAt: asked[route] ?? null,
      });
    }
  }

  // The shared inbox last, and only when somebody could be delivered through
  // it: it belongs to the site rather than to a person, and a site with nobody
  // to deliver to has no use for it.
  if (rows.length > 0) {
    rows.push({
      path: WORDPRESS_SHARED_INBOX_PATH,
      username: '',
      lastRequestedAt: requests.sharedInbox ?? null,
    });
  }

  return rows;
}
