import type { Clock } from './util/clock.ts';
import { appendDevModeEntry, DEV_MODE } from './settings/dev-mode.ts';
import type { OutboundEffect } from './settings/dev-mode.ts';
import type { SettingsRegistry } from './settings/types.ts';

// A held effect is dropped, never queued, so going live replays nothing.
export async function holdOutbound(
  settings: SettingsRegistry,
  config: { readonly dataDir: string; readonly now: Clock },
  effect: OutboundEffect,
): Promise<boolean> {
  if (!(await settings.get(DEV_MODE.on))) return false;
  appendDevModeEntry(config.dataDir, {
    type: 'held',
    at: config.now().toISOString(),
    kind: effect.kind,
    what: effect.what,
    to: [...effect.to],
  });
  return true;
}
