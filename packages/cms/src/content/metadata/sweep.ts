import { readdir, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { stripMetadata, strippable, UnreadableMetadataError } from './index.ts';

export type SweptFile =
  | { path: string; outcome: 'stripped'; removed: readonly string[] }
  | { path: string; outcome: 'clean' }
  | { path: string; outcome: 'unreadable'; problem: string };

export interface SweepOptions {
  /** Checked before each file; the sweep throws once it is aborted. */
  readonly signal?: AbortSignal;
  progress?(done: number, total: number): Promise<void>;
}

/**
 * Strip every upload that carries metadata. Safe to run again, or after a run
 * cut off part way: a clean file is left alone, and a file is replaced by
 * rename, so it is either the original or the stripped bytes. A file
 * deleted while the sweep runs is left out.
 */
export async function stripStoredUploads(
  directory: string,
  options: SweepOptions = {},
): Promise<SweptFile[]> {
  const files = (await listFiles(directory)).filter((relative) =>
    strippable(path.extname(relative)),
  );
  const results: SweptFile[] = [];

  for (const [index, relative] of files.entries()) {
    options.signal?.throwIfAborted();
    const swept = await sweepFile(directory, relative);
    if (swept !== undefined) results.push(swept);
    await options.progress?.(index + 1, files.length);
  }

  return results;
}

async function sweepFile(directory: string, relative: string): Promise<SweptFile | undefined> {
  const file = path.join(directory, ...relative.split('/'));
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }

  let result;
  try {
    result = stripMetadata(path.extname(relative), bytes);
  } catch (error) {
    if (!(error instanceof UnreadableMetadataError)) throw error;
    return { path: relative, outcome: 'unreadable', problem: error.message };
  }

  if (result.bytes === bytes) return { path: relative, outcome: 'clean' };

  await replaceKeepingTimes(file, result.bytes);
  return { path: relative, outcome: 'stripped', removed: result.removed };
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
