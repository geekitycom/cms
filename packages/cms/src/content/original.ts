/**
 * Where a post was first published, when that is somewhere else (TASK-293): a
 * Substack essay republished here names the essay's URL.
 *
 * ```yaml
 * canonical_href: https://example.substack.com/p/an-essay
 * ```
 *
 * The key is the one an Eleventy site in the wild already used, so its files
 * keep their values. It stays in {@link Document.extra}; {@link originalUrlOf}
 * is the one reading of it.
 */
import { isWebUrl } from './enclosure.ts';

export const ORIGINAL_FRONT_MATTER_KEY = 'canonical_href';

/** The original's URL, when the front matter names an absolute http or https one. */
export function originalUrlOf(extra: Readonly<Record<string, unknown>>): string | undefined {
  const value = extra[ORIGINAL_FRONT_MATTER_KEY];
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  return isWebUrl(url) ? url : undefined;
}
