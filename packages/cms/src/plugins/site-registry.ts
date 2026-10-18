import type { ResolvedConfig } from '../config.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { SITE } from '../site/namespace.ts';
import { createPluginRegistry } from './registry.ts';
import type { InstalledPlugin, PluginRegistry } from './registry.ts';

/** Every plugin the site config installs, and those from the plugins folder, registered. */
export function sitePluginRegistry(
  config: ResolvedConfig,
  folderPlugins: readonly InstalledPlugin[],
  settings: SettingsRegistry,
): PluginRegistry {
  return createPluginRegistry(
    [
      ...config.plugins.map((plugin, index) => ({
        plugin,
        source: `the site config, plugins[${String(index)}]`,
      })),
      ...folderPlugins,
    ],
    {
      dataDir: config.dataDir,
      contentDir: config.contentDir,
      settings,
      allowPrivateAddress: config.federation.allowPrivateAddress ?? false,
      lookup: config.hostLookup,
      siteInfo: async () => ({
        baseUrl: config.baseUrl,
        title: await settings.get(SITE.title),
      }),
    },
  );
}
