import { readdir, rm, stat } from 'node:fs/promises';

import { isNotFound } from '../util/files.ts';
import { EXPORTS, dataFolder, dataPath } from './data-files.ts';

const EXPORT_LIFETIME_MS = 24 * 60 * 60 * 1000;

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
    return await readdir(dataFolder(dataDir, EXPORTS));
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function archives(dataDir: string): Promise<ExportArchive[]> {
  return (await namesIn(dataDir))
    .flatMap((name) => archiveOf(dataDir, name) ?? [])
    .sort((a, b) => b.writtenAt.getTime() - a.writtenAt.getTime());
}

function expired(archive: ExportArchive, now: Date): boolean {
  return archive.expiresAt.getTime() <= now.getTime();
}

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
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function keepOnlyExport(dataDir: string, keep: string): Promise<void> {
  for (const name of await namesIn(dataDir)) {
    if (name !== keep) await rm(dataPath(dataDir, EXPORTS, name), { recursive: true, force: true });
  }
}
