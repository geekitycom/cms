import { loadResolvedConfig } from '../config-loader.ts';
import { DEV_MODE, DEV_MODE_LATCHED } from '../settings/dev-mode.ts';
import { createSettings } from '../site/namespace.ts';
import type { ParsedArgs } from './args.ts';
import { setOrThrow } from './settings.ts';

export async function devModeCommand({ args, configPath }: ParsedArgs): Promise<number> {
  const action = args[0];
  const config = await loadResolvedConfig(configPath);
  const settings = createSettings({ config });

  if (action === 'on') {
    await setOrThrow(settings, 'dev_mode', { on: true });
    process.stdout.write(
      'Dev mode is on: nothing the site does is sent until `geekity dev-mode off`.\n',
    );
    return 0;
  }

  if (action === 'off') {
    if (config.devMode) {
      throw new Error(`${DEV_MODE_LATCHED} Remove it, then run geekity dev-mode off again.`);
    }
    const wasOn = await settings.get(DEV_MODE.on);
    await setOrThrow(settings, 'dev_mode', { on: false });
    process.stdout.write(
      wasOn
        ? 'Dev mode is off: the site is live. Nothing held while it was on will be sent.\n'
        : 'Dev mode was already off: the site is live.\n',
    );
    return 0;
  }

  if (action === 'status') {
    process.stdout.write(
      (await settings.get(DEV_MODE.on)) ? 'Dev mode is on.\n' : 'Dev mode is off.\n',
    );
    return 0;
  }

  throw new Error('geekity dev-mode needs on, off or status.');
}
