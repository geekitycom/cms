import { readdir, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { stripMetadata, strippable, UnreadableMetadataError } from './index.ts';

export type SweptFile =
  | { path: string; outcome: 'stripped'; removed: readonly string[] }
  | { path: string; outcome: 'clean' }
  | { path: string; outcome: 'unreadable'; problem: string };

export async function stripStoredUploads(directory: string): Promise<SweptFile[]> {
  const files = await listFiles(directory);
  const results: SweptFile[] = [];

  for (const relative of files) {
    if (!strippable(path.extname(relative))) continue;
    const file = path.join(directory, ...relative.split('/'));
    const bytes = new Uint8Array(await readFile(file));

    let result;
    try {
      result = stripMetadata(path.extname(relative), bytes);
    } catch (error) {
      if (!(error instanceof UnreadableMetadataError)) throw error;
      results.push({ path: relative, outcome: 'unreadable', problem: error.message });
      continue;
    }

    if (result.bytes === bytes) {
      results.push({ path: relative, outcome: 'clean' });
      continue;
    }

    await replaceKeepingTimes(file, result.bytes);
    results.push({ path: relative, outcome: 'stripped', removed: result.removed });
  }

  return results;
}

async function listFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .map((relative) => relative.split(path.sep).join('/'))
    .sort();
}

async function replaceKeepingTimes(file: string, bytes: Uint8Array): Promise<void> {
  const { atime, mtime } = await stat(file);
  const temporary = `${file}.geekity-strip`;
  await writeFile(temporary, bytes);
  await utimes(temporary, atime, mtime);
  await rename(temporary, file);
}
