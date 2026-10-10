import { isWebUrl } from './enclosure.ts';

export const ORIGINAL_FRONT_MATTER_KEY = 'canonical_href';
export const ORIGINAL_NAME_FRONT_MATTER_KEY = 'canonical_name';

export interface OriginalPublication {
  url: string;
  name?: string | undefined;
}

export function originalOf(
  extra: Readonly<Record<string, unknown>>,
): OriginalPublication | undefined {
  const value = extra[ORIGINAL_FRONT_MATTER_KEY];
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (!isWebUrl(url)) return undefined;
  const name = extra[ORIGINAL_NAME_FRONT_MATTER_KEY];
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed === '' ? { url } : { url, name: trimmed };
}
