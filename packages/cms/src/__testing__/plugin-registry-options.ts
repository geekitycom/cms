import path from 'node:path';

import { resolveConfig } from '../config.ts';
import type { PluginRegistryOptions } from '../plugins/registry.ts';
import { createSettings } from '../site/namespace.ts';

/** What a plugin registry under test reads, over a settings registry of its own. */
export function pluginRegistryOptions(
  dataDir: string,
  env: Readonly<Record<string, string>> = {},
): PluginRegistryOptions {
  const contentDir = path.join(dataDir, 'content');
  return {
    dataDir,
    contentDir,
    settings: createSettings({
      config: resolveConfig({ contentDir, dataDir }, { env, cwd: dataDir }),
      env,
    }),
    siteInfo: () => Promise.resolve({ baseUrl: 'https://example.test/', title: 'Example' }),
    allowPrivateAddress: false,
    lookup: () => Promise.reject(new Error('a test resolves no names')),
  };
}
