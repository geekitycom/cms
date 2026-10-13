import { MAINTENANCE } from './settings/maintenance.ts';
import type { SettingsRegistry, ValuesOf } from './settings/types.ts';
import type { Clock } from './util/clock.ts';

/** How long the running site trusts its last look at the settings. */
const RECHECK_MS = 1000;

export type MaintenanceState = ValuesOf<typeof MAINTENANCE>;

/** Maintenance mode (TASK-130) in force right now. */
export type MaintenanceSwitch = () => Promise<MaintenanceState>;

/**
 * The gate's view of `maintenance.*`, asked of the registry no more than once
 * a second by the site's clock: a relay burst of a few hundred deliveries
 * costs one read, and `geekity maintenance off` still takes effect within a
 * second.
 */
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
