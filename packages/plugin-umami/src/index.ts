/**
 * `@geekity/plugin-umami`: the Umami analytics tracker on every public page,
 * through page tags (decision-59), and dashboard widgets that read the stats
 * from Umami Cloud or a self-hosted Umami.
 */

import { definePlugin } from '@geekity/cms/plugin';

import { audienceWidget, visitorsNowWidget } from './audience.ts';
import { umamiClient } from './client.ts';
import { umamiScreen } from './screen.ts';
import { SETTINGS } from './settings.ts';
import { topPagesWidget, topReferrersWidget } from './top.ts';
import { trackerTags } from './tracker.ts';
import { trafficWidget } from './traffic.ts';
import { VERSION } from './version.ts';

export default definePlugin({
  name: '@geekity/plugin-umami',
  version: VERSION,
  label: 'Umami',
  description:
    'Adds the Umami analytics tracker to every public page and shows views, visitors, ' +
    'top pages, top referrers, countries, browsers, devices and the visitors right now ' +
    'on the dashboard, from Umami Cloud or a self-hosted Umami.',
  hostApi: 3,
  register(host) {
    const settings = host.settings(SETTINGS);
    host.pageTags(async (page) => trackerTags(await settings.current(), page));
    const client = umamiClient({
      fetch: (url, init) => host.fetch(url, init),
      settings: () => settings.current(),
    });
    host.screen(umamiScreen(() => settings.current(), client));
    host.widget(trafficWidget(client));
    host.widget(topPagesWidget(client, (paths) => host.use('@geekity/cms/posts').byPath(paths)));
    host.widget(topReferrersWidget(client, () => settings.current()));
    host.widget(audienceWidget(client, 'country'));
    host.widget(audienceWidget(client, 'browser'));
    host.widget(audienceWidget(client, 'device'));
    host.widget(visitorsNowWidget(client));
  },
});
