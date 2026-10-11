import { statSync } from 'node:fs';
import { stat } from 'node:fs/promises';

export function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

export async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export function isFileSync(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
