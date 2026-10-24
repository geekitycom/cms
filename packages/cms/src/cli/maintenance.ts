import { loadResolvedConfig } from '../config-loader.ts';
import { dataPath } from '../files/data-files.ts';
import { MAINTENANCE, MAINTENANCE_FILE } from '../settings/maintenance.ts';
import { overridden } from '../settings/registry.ts';
import { createSettings } from '../site/namespace.ts';
import { text } from './args.ts';
import type { ParsedArgs } from './args.ts';
import { setOrThrow } from './settings.ts';

export async function maintenanceCommand({ args, configPath, flags }: ParsedArgs): Promise<number> {
  const action = args[0];
  const config = await loadResolvedConfig(configPath);
  const settings = createSettings({ config });

  if (action === 'on') {
    const until = untilFlag(text(flags, 'until'));
    await setOrThrow(settings, 'maintenance', { on: true, until: until?.toISOString() ?? '' });
    const file = dataPath(config.dataDir, MAINTENANCE_FILE);
    process.stdout.write(`Maintenance mode is on (${file}).${untilLine(until)}\n`);
    return 0;
  }

  if (action === 'off') {
    if (overridden((await settings.resolve(MAINTENANCE.on)).source)) {
      throw new Error(`Maintenance mode is still on.${forcedLine(true)}`);
    }
    await setOrThrow(settings, 'maintenance', { on: false });
    process.stdout.write('Maintenance mode is off.\n');
    return 0;
  }

  if (action === 'status') {
    const on = await settings.resolve(MAINTENANCE.on);
    if (!on.value) {
      process.stdout.write('Maintenance mode is off.\n');
    } else {
      const until = await settings.get(MAINTENANCE.until);
      process.stdout.write(
        `Maintenance mode is on.${untilLine(until === '' ? undefined : new Date(until))}${forcedLine(overridden(on.source))}\n`,
      );
    }
    return 0;
  }

  throw new Error('geekity maintenance needs on, off or status.');
}

function untilFlag(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const until = new Date(value);
  if (Number.isNaN(until.getTime())) {
    throw new Error(
      `--until needs a time such as 2026-09-28T14:00:00Z, received ${JSON.stringify(value)}.`,
    );
  }
  return until;
}

function untilLine(until: Date | undefined): string {
  return until === undefined ? '' : ` Expected back by ${until.toUTCString()}.`;
}

function forcedLine(forced: boolean): string {
  return forced
    ? ' GEEKITY_MAINTENANCE or the maintenance setting keeps it on until the site restarts without it.'
    : '';
}
