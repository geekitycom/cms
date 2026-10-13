import { resolveConfig } from '../config.ts';
import { createSettingsRegistry } from '../settings/registry.ts';
import type { SettingsRegistry } from '../settings/types.ts';

export function settingsOver(dirs: { contentDir?: string; dataDir: string }): SettingsRegistry {
  return createSettingsRegistry({ config: resolveConfig(dirs, { env: {} }), env: {} });
}
