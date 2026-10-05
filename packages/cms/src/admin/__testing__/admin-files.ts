import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { ADMIN_DIRS, PACKAGED_ADMIN_DIR } from '../templates.ts';

/**
 * The admin's files as the running admin finds them, through the same
 * `GEEKITY_ADMIN` switch (decision-30), so a test that reads a template or a
 * stylesheet by path reads the one the server would serve.
 */

/** The path of `relative` in the first of {@link ADMIN_DIRS} that has it. */
export function adminFile(relative: string): string {
  const found = ADMIN_DIRS.map((dir) => path.join(dir, relative)).find((file) => existsSync(file));
  return found ?? path.join(PACKAGED_ADMIN_DIR, relative);
}

/**
 * Every `.njk` under `directory` in any of {@link ADMIN_DIRS}, relative to the
 * admin root and each named once, sorted.
 */
export async function adminTemplates(directory: string): Promise<string[]> {
  const found = new Set<string>();
  for (const root of ADMIN_DIRS) {
    const base = path.join(root, directory);
    if (!existsSync(base)) continue;
    for (const entry of await readdir(base, { recursive: true })) {
      if (entry.endsWith('.njk')) found.add(`${directory}/${entry}`);
    }
  }
  return [...found].sort();
}
