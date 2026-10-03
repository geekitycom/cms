import { readdir, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { stripMetadata, strippable, UnreadableMetadataError } from './index.ts';

/** What happened to one file under the uploads directory. */
export type SweptFile =
  | { path: string; outcome: 'stripped'; removed: readonly string[] }
  | { path: string; outcome: 'clean' }
  | { path: string; outcome: 'unreadable'; problem: string };

/**
 * Strip every file under `directory` that a stripper exists for, rewriting
 * only the ones that change.
 *
 * Running it twice is the same as running it once: a stripped file comes back
 * from its stripper unchanged and is not written again. A rewrite goes to a
 * temporary name and is renamed over the original, so a crash leaves the old
 * file or the new one, never half of each, and the modification time is put
 * back because the media library sorts by it. A file whose structure cannot
 * be walked is reported and left as it was.
 *
 * Paths in the result are relative to `directory`, with forward slashes.
 */
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

    const { atime, mtime } = await stat(file);
    const temporary = `${file}.geekity-strip`;
    await writeFile(temporary, result.bytes);
    await utimes(temporary, atime, mtime);
    await rename(temporary, file);
    results.push({ path: relative, outcome: 'stripped', removed: result.removed });
  }

  return results;
}

/** Every file under `directory`, relative and sorted; none when it is not there. */
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
