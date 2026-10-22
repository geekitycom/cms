import { MAINTENANCE } from './settings/maintenance.ts';
import type { SettingsRegistry, ValuesOf } from './settings/types.ts';
import type { Clock } from './util/clock.ts';

export const RECHECK_MS = 1000;

export type MaintenanceState = ValuesOf<typeof MAINTENANCE>;

export type MaintenanceSwitch = () => Promise<MaintenanceState>;

export function createMaintenanceSwitch(options: {
  settings: SettingsRegistry;
  now: Clock;
}): MaintenanceSwitch {
  let checkedAt = Number.NEGATIVE_INFINITY;
  let current: Promise<MaintenanceState> | undefined;
  return () => {
    const now = options.now().getTime();
    if (current === undefined || now - checkedAt >= RECHECK_MS || now < checkedAt) {
      current = options.settings.values(MAINTENANCE);
      checkedAt = now;
    }
    return current;
  };
}
