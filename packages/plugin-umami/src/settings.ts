import type { PluginSettingField, PluginSettingValues } from '@geekity/cms/plugin';

export const SETTINGS = [
  {
    type: 'url',
    key: 'umami_url',
    label: 'Umami URL',
    hint: 'Where Umami runs: https://cloud.umami.is for Umami Cloud, or the address of your own Umami. The tracker loads script.js from here.',
    default: 'https://cloud.umami.is',
  },
  {
    type: 'text',
    key: 'website_id',
    label: 'Website ID',
    hint: 'The ID Umami shows under Settings > Websites for this site.',
  },
  {
    type: 'text',
    key: 'domains',
    label: 'Domains',
    hint: 'Count visits only on these host names, separated by commas, such as example.com,www.example.com. Empty counts every host.',
  },
  {
    type: 'checkbox',
    key: 'do_not_track',
    label: 'Respect Do Not Track',
    hint: 'Count no visit from a browser that sends Do Not Track.',
  },
  {
    type: 'checkbox',
    key: 'exclude_search',
    label: 'Leave out the query string',
    hint: 'Record each page without the part of its URL after ?.',
  },
  {
    type: 'checkbox',
    key: 'exclude_hash',
    label: 'Leave out the fragment',
    hint: 'Record each page without the part of its URL after #.',
  },
  {
    type: 'checkbox',
    key: 'count_signed_in',
    label: 'Count signed-in visits',
    hint: 'Off by default, so your own visits to the site are not counted.',
  },
  {
    type: 'select',
    key: 'api_mode',
    label: 'Umami for the stats',
    options: [
      { value: 'cloud', label: 'Umami Cloud, with an API key' },
      { value: 'self-hosted', label: 'Self-hosted Umami, with a username and password' },
    ],
    default: 'cloud',
    hint: 'How the dashboard reads the stats from Umami. The tracker works either way.',
  },
  {
    type: 'secret',
    key: 'api_key',
    label: 'API key',
    hint: 'For Umami Cloud: an API key made in Umami Cloud.',
  },
  {
    type: 'text',
    key: 'username',
    label: 'Username',
    hint: 'For a self-hosted Umami: a user who can view this website.',
  },
  {
    type: 'secret',
    key: 'password',
    label: 'Password',
    hint: 'For a self-hosted Umami: the password of that user.',
  },
  {
    type: 'url',
    key: 'api_url',
    label: 'API URL',
    hint: 'Where the Umami API answers, if not the usual place: https://api.umami.is/v1 for Umami Cloud, or the Umami URL followed by /api for a self-hosted Umami.',
  },
] as const satisfies readonly PluginSettingField[];

export type UmamiSettings = PluginSettingValues<typeof SETTINGS>;
