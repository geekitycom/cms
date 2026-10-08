/**
 * `@geekity/plugin-wordpress` (decision-33): what a site that moved from the
 * WordPress ActivityPub plugin needs until its followers' servers have caught
 * up. Its old inbox and collection paths, the record of when each was last
 * asked for, and `geekity import wordpress-actor`.
 *
 * Stored actor and object ids, WebFinger aliases, the feed and archive layout
 * and oEmbed are the site's own and stay in `@geekity/cms` (decision-14).
 */

import { definePlugin } from '@geekity/cms/plugin';

import { importCommand } from './command.ts';
import { wordPressFederation } from './federation.ts';
import { wordPressRecords } from './records.ts';
import { wordPressScreen } from './screen.ts';
import { VERSION } from './version.ts';

export { ExistingKeyPairError, importWordPressActor, UnusableKeyPemError } from './import.ts';
export type {
  FollowersImportReport,
  ImportedKey,
  ImportWordPressActorOptions,
  ImportWordPressActorReport,
  UnreachableFollower,
} from './import.ts';
export {
  ACTORS_FILE,
  ConflictingWordPressIdError,
  REQUESTS_FILE,
  WORDPRESS_ACTIVITYPUB_BASE,
  wordPressRecords,
  wordPressRequestTarget,
} from './records.ts';
export type {
  WordPressRecords,
  WordPressRequests,
  WordPressRequestTarget,
  WordPressRoute,
} from './records.ts';

export default definePlugin({
  name: '@geekity/plugin-wordpress',
  version: VERSION,
  label: 'WordPress',
  description:
    'Answers the inbox and collection paths the WordPress ActivityPub plugin published, ' +
    'for a site that moved here from it, until every follower has refetched the actor.',
  hostApi: 1,
  register(host) {
    const records = wordPressRecords(host.data);
    host.federation(wordPressFederation(records));
    host.screen(wordPressScreen(records));
    host.command(importCommand(records));
  },
});
