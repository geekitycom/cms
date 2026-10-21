import type {
  PluginPageTag,
  PluginPageTagAttributes,
  PluginPageTags,
  PluginPageTagsContext,
} from '@geekity/cms/plugin';

import type { UmamiSettings } from './settings.ts';

export function trackerTags(settings: UmamiSettings, page: PluginPageTagsContext): PluginPageTags {
  const websiteId = settings.website_id.trim();
  if (settings.umami_url === '' || websiteId === '') return {};
  if (page.devMode || (page.signedIn && !settings.count_signed_in)) return {};
  const domains = settings.domains
    .split(',')
    .map((domain) => domain.trim())
    .filter((domain) => domain !== '')
    .join(',');
  const attributes: PluginPageTagAttributes = {
    defer: true,
    'data-website-id': websiteId,
    'data-domains': domains === '' ? false : domains,
    'data-do-not-track': settings.do_not_track && 'true',
    'data-exclude-search': settings.exclude_search && 'true',
    'data-exclude-hash': settings.exclude_hash && 'true',
  };
  const script: PluginPageTag = {
    tag: 'script',
    src: `${settings.umami_url.replace(/\/+$/, '')}/script.js`,
    attributes,
  };
  return { headEnd: [script] };
}
