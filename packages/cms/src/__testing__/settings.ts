import { resolveConfig } from '../config.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { createSettings } from '../site/namespace.ts';

export function settingsOver(dirs: { contentDir?: string; dataDir: string }): SettingsRegistry {
  return createSettings({ config: resolveConfig(dirs, { env: {} }), env: {} });
}
