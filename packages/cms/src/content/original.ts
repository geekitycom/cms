import { isWebUrl } from './enclosure.ts';

// The keys an Eleventy site in the wild already used, so its files keep their
// values.
export const ORIGINAL_FRONT_MATTER_KEY = 'canonical_href';
export const ORIGINAL_NAME_FRONT_MATTER_KEY = 'canonical_name';

/** Where a post was first published: its URL, and the publication's name when the front matter gives one. */
export interface Original {
  url: string;
  name?: string | undefined;
}

export function originalOf(extra: Readonly<Record<string, unknown>>): Original | undefined {
  const value = extra[ORIGINAL_FRONT_MATTER_KEY];
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (!isWebUrl(url)) return undefined;
  const name = extra[ORIGINAL_NAME_FRONT_MATTER_KEY];
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed === '' ? { url } : { url, name: trimmed };
}
