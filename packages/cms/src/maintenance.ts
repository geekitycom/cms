import { rm } from 'node:fs/promises';
import path from 'node:path';

import type { Clock } from './content/store.ts';
import { readFileIfPresentSync, writeFileAtomically } from './files/atomic.ts';

/**
 * Maintenance mode (TASK-130) is a file, `data/maintenance.json`, that the
 * running site checks for and `geekity maintenance on` and `off` write and
 * remove. A file rather than a setting so that turning it on needs neither a
 * restart nor a working admin, and under `data/` rather than `content/`
 * because it is operational state: `content/` is published and committed, and
 * a flag that travelled with it would take down every checkout of the site.
 */
export const MAINTENANCE_FILE = 'maintenance.json';

/** How long the running site trusts its last look at the file. */
const RECHECK_MS = 1000;

/** The site is down on purpose. `until` is when the operator expects it back. */
export interface MaintenanceWindow {
  until: Date | undefined;
}

export function maintenanceFile(dataDir: string): string {
  return path.join(dataDir, MAINTENANCE_FILE);
}

/** Turn maintenance on, replacing whatever window was there before. */
export async function enterMaintenance(
  dataDir: string,
  window: { until?: Date | undefined } = {},
): Promise<void> {
  const body = window.until === undefined ? {} : { until: window.until.toISOString() };
  await writeFileAtomically(maintenanceFile(dataDir), `${JSON.stringify(body, null, 2)}\n`);
}

/** Turn maintenance off. Already off is not an error. */
export async function leaveMaintenance(dataDir: string): Promise<void> {
  await rm(maintenanceFile(dataDir), { force: true });
}

/**
 * The window the file describes, or `undefined` when there is no file.
 *
 * A file that is there but unreadable as a window still means maintenance:
 * the operator put it there, and taking the site back up because of a typo in
 * a date would be the surprise.
 */
export function readMaintenance(dataDir: string): MaintenanceWindow | undefined {
  const text = readFileIfPresentSync(maintenanceFile(dataDir));
  if (text === undefined) return undefined;
  return { until: untilIn(text) };
}

function untilIn(text: string): Date | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const until = (parsed as Record<string, unknown>)['until'];
    if (typeof until !== 'string') return undefined;
    const date = new Date(until);
    return Number.isNaN(date.getTime()) ? undefined : date;
  } catch {
    return undefined;
  }
}

/** The maintenance window in force right now, or `undefined` when the site is up. */
export type MaintenanceSwitch = () => MaintenanceWindow | undefined;

/**
 * The running site's view of maintenance mode.
 *
 * `forced` is the `maintenance` setting or `GEEKITY_MAINTENANCE`, read once at
 * boot: it keeps the site in maintenance for the life of the process, and the
 * file can only add an expected return to it. Otherwise the file decides, and
 * is looked at no more than once a second by the site's clock: a relay burst
 * of a few hundred deliveries costs one read, and `geekity maintenance off`
 * still takes effect within a second.
 */
export function createMaintenanceSwitch(options: {
  dataDir: string;
  forced: boolean;
  now: Clock;
}): MaintenanceSwitch {
  const forced: MaintenanceWindow | undefined = options.forced ? { until: undefined } : undefined;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let current: MaintenanceWindow | undefined;
  return () => {
    const now = options.now().getTime();
    if (now - checkedAt >= RECHECK_MS || now < checkedAt) {
      current = readMaintenance(options.dataDir);
      checkedAt = now;
    }
    return current ?? forced;
  };
}
