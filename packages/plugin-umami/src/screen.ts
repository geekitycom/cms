import type { PluginScreen, PluginScreenCard } from '@geekity/cms/plugin';

import { connectionFrom, listed, UmamiError } from './client.ts';
import type { UmamiClient } from './client.ts';
import type { UmamiSettings } from './settings.ts';

/**
 * The plugin's screen: where the dashboard reads the stats from, never the
 * credentials themselves, and Check connection, which asks Umami for the
 * configured website.
 */
export function umamiScreen(
  settings: () => Promise<UmamiSettings>,
  client: UmamiClient,
): PluginScreen {
  return {
    title: 'Umami',
    async render() {
      return [statisticsCard(await settings())];
    },
    actions: [
      {
        id: 'check-connection',
        label: 'Check connection',
        async run() {
          try {
            const website = await client.website();
            const connection = connectionFrom(await settings());
            const host = 'missing' in connection ? 'Umami' : connection.host;
            const named =
              website.domain === '' ? website.name : `${website.name} (${website.domain})`;
            return { ok: true, message: `Umami answered at ${host}. It has the website ${named}.` };
          } catch (error) {
            if (error instanceof UmamiError) return { ok: false, message: error.message };
            throw error;
          }
        },
      },
    ],
  };
}

function statisticsCard(values: UmamiSettings): PluginScreenCard {
  const connection = connectionFrom(values);
  const check =
    'Check connection asks Umami for the website and says whether it answered and found it.';
  if ('missing' in connection) {
    return {
      title: 'Statistics',
      blocks: [
        {
          paragraph: [
            `The dashboard shows no Umami stats yet. Set ${listed(connection.missing)} first.`,
          ],
        },
        { paragraph: [check] },
      ],
    };
  }
  const { credentials } = connection;
  return {
    title: 'Statistics',
    blocks: [
      {
        paragraph: [
          'The dashboard reads the stats for the website ',
          { code: connection.websiteId },
          ' from ',
          { code: connection.base },
          ...(credentials.kind === 'key'
            ? [' with the API key.']
            : [' as the user ', { code: credentials.username }, '.']),
        ],
      },
      { paragraph: [check] },
    ],
  };
}
