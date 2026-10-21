import type { PluginSettingField, PluginSettingValues } from '@geekity/cms/plugin';

/** The plugin's settings form, in the order the screen draws it. */
export const SETTINGS = [
  {
    type: 'url',
    key: 'umami_url',
    label: 'Umami URL',
    hint: 'Where Umami runs: https://cloud.umami.is for Umami Cloud, or the address of your own Umami. The tracker loads script.js from here.',
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
] as const satisfies readonly PluginSettingField[];

export type UmamiSettings = PluginSettingValues<typeof SETTINGS>;
