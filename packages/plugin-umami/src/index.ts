/**
 * `@geekity/plugin-umami`: the Umami analytics tracker on every public page,
 * through page tags (decision-59).
 */

import { definePlugin } from '@geekity/cms/plugin';

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
  },
});
