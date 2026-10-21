/**
 * `@geekity/plugin-umami`: the Umami analytics tracker on every public page,
 * through page tags (decision-59), and a client for the Umami API that reads
 * the stats from Umami Cloud or a self-hosted Umami.
 */

import { definePlugin } from '@geekity/cms/plugin';

import { umamiClient } from './client.ts';
import { umamiScreen } from './screen.ts';
import { SETTINGS } from './settings.ts';
import { trackerTags } from './tracker.ts';
import { VERSION } from './version.ts';

export default definePlugin({
  name: '@geekity/plugin-umami',
  version: VERSION,
  label: 'Umami',
  description:
    'Adds the Umami analytics tracker to every public page, from Umami Cloud or a ' +
    'self-hosted Umami.',
  hostApi: 3,
  register(host) {
    const settings = host.settings(SETTINGS);
    host.pageTags(async (page) => trackerTags(await settings.current(), page));
    const client = umamiClient({
      fetch: (url, init) => host.fetch(url, init),
      settings: () => settings.current(),
    });
    host.screen(umamiScreen(() => settings.current(), client));
  },
});
