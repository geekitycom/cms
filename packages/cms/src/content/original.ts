import { isWebUrl } from './enclosure.ts';

// The key an Eleventy site in the wild already used, so its files keep their
// values.
export const ORIGINAL_FRONT_MATTER_KEY = 'canonical_href';

export function originalUrlOf(extra: Readonly<Record<string, unknown>>): string | undefined {
  const value = extra[ORIGINAL_FRONT_MATTER_KEY];
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  return isWebUrl(url) ? url : undefined;
}
