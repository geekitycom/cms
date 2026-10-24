import type { ResolvedConfig } from '../config.ts';
import { importPluginFolders, scanPluginFolders } from '../plugins/folder.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import { sitePluginRegistry } from '../plugins/site-registry.ts';
import type { SettingsRegistry } from '../settings/types.ts';

export async function loadSitePlugins(
  config: ResolvedConfig,
  settings: SettingsRegistry,
): Promise<PluginRegistry> {
  const folderPlugins = await importPluginFolders(scanPluginFolders(config.pluginsDir));
  return sitePluginRegistry(config, folderPlugins, settings);
}
