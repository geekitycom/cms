import type { PluginScreen, PluginScreenCell } from '@geekity/cms/plugin';

import {
  WORDPRESS_ACTIVITYPUB_BASE,
  WORDPRESS_ROUTES,
  WORDPRESS_SHARED_INBOX_PATH,
} from './records.ts';
import type { WordPressRecords } from './records.ts';

/**
 * The plugin's screen under Plugins: every path it answers, and when each was
 * last asked for.
 *
 * The whole point of the screen. The plugin can be disabled once no
 * follower's server is delivering to the old URLs any more, and only the
 * record of what was asked for can say so. A route nobody has ever asked for
 * is listed too, saying never: an empty table would read as "no such path"
 * rather than as "nobody is using it".
 */
export function wordPressScreen(records: WordPressRecords): PluginScreen {
  return {
    title: 'WordPress',
    render({ site }) {
      const requests = records.requests();
      const known = new Set(site.users().map((user) => user.username));
      const rows: PluginScreenCell[][] = [];

      for (const [username, number] of records.actors()) {
        if (!known.has(username)) continue;
        const asked = requests.users[username] ?? {};
        const actor = `${WORDPRESS_ACTIVITYPUB_BASE}/actors/${String(number)}`;
        for (const route of WORDPRESS_ROUTES) {
          rows.push([
            { code: route === 'actor' ? actor : `${actor}/${route}` },
            username,
            { time: asked[route] ?? null },
          ]);
        }
      }

      if (rows.length === 0) {
        return [
          {
            title: 'WordPress paths',
            blocks: [
              {
                paragraph: [
                  'No user carries a WordPress actor id, so these paths would serve nothing. ',
                  { code: 'geekity import wordpress-actor' },
                  ' sets one.',
                ],
              },
            ],
          },
        ];
      }

      rows.push([
        { code: WORDPRESS_SHARED_INBOX_PATH },
        'every user',
        { time: requests.sharedInbox ?? null },
      ]);

      return [
        {
          title: 'WordPress paths',
          blocks: [
            {
              table: {
                caption: 'WordPress paths',
                columns: ['Path', 'For', 'Last asked for'],
                rows,
              },
            },
            {
              paragraph: [
                "Once every one of these has been quiet for long enough that every follower's " +
                  'server has refetched the actor, disable this plugin: these paths are a cache ' +
                  "other servers hold, not this site's identity, and the site carries them only " +
                  'until the caches have moved on.',
              ],
            },
          ],
        },
      ];
    },
  };
}
