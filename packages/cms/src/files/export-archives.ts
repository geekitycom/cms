import { readdir, rm, stat } from 'node:fs/promises';

import { EXPORTS, dataPath } from './data-files.ts';

/**
 * The archives the admin's export job leaves in `data/exports/` for a
 * download (decision-55, section 4). Each holds actor keys, password hashes
 * and personal data, so only the newest is kept and it goes 24 hours after it
 * was written. Its age comes from the time in its name, which the site's
 * clock wrote.
 */

export const EXPORT_LIFETIME_MS = 24 * 60 * 60 * 1000;

const ARCHIVE = /^geekity-.+-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.tar\.gz$/;

export interface ExportArchive {
  readonly name: string;
  readonly path: string;
  readonly writtenAt: Date;
  readonly expiresAt: Date;
}

function archiveOf(dataDir: string, name: string): ExportArchive | undefined {
  const match = ARCHIVE.exec(name);
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const writtenAt = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return {
    name,
    path: dataPath(dataDir, EXPORTS, name),
    writtenAt,
    expiresAt: new Date(writtenAt.getTime() + EXPORT_LIFETIME_MS),
  };
}

async function namesIn(dataDir: string): Promise<string[]> {
  try {
    return await readdir(dataPath(dataDir, EXPORTS));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Every archive in the folder, newest first. */
async function archives(dataDir: string): Promise<ExportArchive[]> {
  return (await namesIn(dataDir))
    .flatMap((name) => archiveOf(dataDir, name) ?? [])
    .sort((a, b) => b.writtenAt.getTime() - a.writtenAt.getTime());
}

function expired(archive: ExportArchive, now: Date): boolean {
  return archive.expiresAt.getTime() <= now.getTime();
}

/** Delete the archives 24 hours old or older, and say how many went. */
export async function expireExports(dataDir: string, now: Date): Promise<number> {
  let deleted = 0;
  for (const archive of await archives(dataDir)) {
    if (expired(archive, now)) {
      await rm(archive.path, { force: true });
      deleted += 1;
    }
  }
  return deleted;
}

/** The archive a download serves: the newest, unless it has expired. Expired ones are deleted. */
export async function currentExport(
  dataDir: string,
  now: Date,
): Promise<(ExportArchive & { readonly size: number }) | undefined> {
  await expireExports(dataDir, now);
  const [newest] = await archives(dataDir);
  if (newest === undefined) return undefined;
  try {
    return { ...newest, size: (await stat(newest.path)).size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Delete what an export a crash cut off left: everything that is not an
 * archive. Only one export job runs at a time, so no other writer's temporary
 * file is here.
 */
export async function clearUnfinishedExports(dataDir: string): Promise<void> {
  for (const name of await namesIn(dataDir)) {
    if (!ARCHIVE.test(name))
      await rm(dataPath(dataDir, EXPORTS, name), { recursive: true, force: true });
  }
}

/** Empty the folder but for the archive just written. */
export async function keepOnlyExport(dataDir: string, keep: string): Promise<void> {
  for (const name of await namesIn(dataDir)) {
    if (name !== keep) await rm(dataPath(dataDir, EXPORTS, name), { recursive: true, force: true });
  }
}
