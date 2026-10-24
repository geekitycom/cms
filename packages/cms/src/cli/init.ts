import path from 'node:path';

import { initSite } from '../init.ts';
import type { ParsedArgs } from './args.ts';

/** `geekity init <directory>`: scaffold a new site. */
export async function initCommand({ args }: ParsedArgs): Promise<number> {
  const directory = args[0];
  if (directory === undefined) {
    throw new Error('geekity init <directory> needs the directory to create.');
  }

  const site = await initSite({ directory, cwd: process.cwd() });
  const relative = path.relative(process.cwd(), site.directory) || '.';

  process.stdout.write(
    [
      `Created ${site.directory}`,
      '',
      'Next:',
      `  cd ${relative}`,
      '  pnpm install',
      '  pnpm dev',
      '',
    ].join('\n'),
  );
  return 0;
}
