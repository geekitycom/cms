import { statSync } from 'node:fs';
import { stat } from 'node:fs/promises';

/** Whether a filesystem error means nothing is at the path, rather than that it could not be read. */
export function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

/** Whether anything is at the path. An error other than "not there" is thrown. */
export async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/** Whether the path is a file. An error other than "not there" is thrown. */
export async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/** {@link isFile} for a caller that cannot wait, such as a settings validator. */
export function isFileSync(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
