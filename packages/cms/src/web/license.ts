/**
 * What readers may do with a site's posts (TASK-206): the license a page is
 * under, read once from `site.json` and the page's front matter, and printed
 * by the footer, the JSON-LD and the feeds from that one answer.
 *
 * A license value, in `site.json` or in front matter, is one of three things:
 *
 * - a Creative Commons key from {@link CREATIVE_COMMONS_LICENSES}, such as
 *   `cc-by-sa`, in any case;
 * - an `http` or `https` URL, named by the `licenseName` beside it, else by
 *   its deed when it is a Creative Commons URL, else by the URL itself;
 * - `none`, or nothing, which is all rights reserved and prints nothing.
 *
 * Anything else is no value at all: a post's typo falls back to the site's
 * license rather than dropping it.
 */

/** A license as everything that prints one reads it. */
export interface ContentLicense {
  /** What a reader sees: `CC BY 4.0`, or a custom license's own name. */
  readonly name: string;
  /** The deed or terms, absolute. */
  readonly url: string;
}

/**
 * The Creative Commons licenses, at their current versions: 4.0 for the six
 * licenses and 1.0 for the CC0 public domain dedication. The keys are what
 * `site.json` and front matter write; `title` is the long name the settings
 * screen offers beside the short one.
 */
export const CREATIVE_COMMONS_LICENSES = {
  'cc-by': {
    name: 'CC BY 4.0',
    title: 'Attribution',
    url: 'https://creativecommons.org/licenses/by/4.0/',
  },
  'cc-by-sa': {
    name: 'CC BY-SA 4.0',
    title: 'Attribution-ShareAlike',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  'cc-by-nc': {
    name: 'CC BY-NC 4.0',
    title: 'Attribution-NonCommercial',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
  'cc-by-nc-sa': {
    name: 'CC BY-NC-SA 4.0',
    title: 'Attribution-NonCommercial-ShareAlike',
    url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  },
  'cc-by-nd': {
    name: 'CC BY-ND 4.0',
    title: 'Attribution-NoDerivatives',
    url: 'https://creativecommons.org/licenses/by-nd/4.0/',
  },
  'cc-by-nc-nd': {
    name: 'CC BY-NC-ND 4.0',
    title: 'Attribution-NonCommercial-NoDerivatives',
    url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  },
  cc0: {
    name: 'CC0 1.0',
    title: 'Public domain dedication',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
} as const satisfies Record<string, ContentLicense & { readonly title: string }>;

/** One of the {@link CREATIVE_COMMONS_LICENSES} keys. */
export type CreativeCommonsKey = keyof typeof CREATIVE_COMMONS_LICENSES;

/** The value that says, outright, that there is no license. */
export const NO_LICENSE = 'none';

/** Where a license is said: `site.json`, or a page's front matter. */
export interface LicenseSource {
  readonly license?: unknown;
  readonly licenseName?: unknown;
}

/** Whether a value is one of the Creative Commons keys. */
export function isCreativeCommonsKey(value: string): value is CreativeCommonsKey {
  return Object.hasOwn(CREATIVE_COMMONS_LICENSES, value);
}

/** Whether a value is an absolute `http` or `https` URL. */
export function isLicenseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The license a page is under, or `undefined` for none: the page's own when
 * its front matter says one (or says `none`), else the site's.
 */
export function resolveLicense(
  site: LicenseSource,
  page: LicenseSource = {},
): ContentLicense | undefined {
  const own = parseLicense(page);
  if (own !== 'unsaid') return own;
  const sites = parseLicense(site);
  return sites === 'unsaid' ? undefined : sites;
}

/** What one source says: a license, `undefined` for none, or nothing usable. */
function parseLicense(source: LicenseSource): ContentLicense | undefined | 'unsaid' {
  if (typeof source.license !== 'string') return 'unsaid';
  const value = source.license.trim();
  if (value === '') return 'unsaid';

  const key = value.toLowerCase();
  if (key === NO_LICENSE) return undefined;
  if (isCreativeCommonsKey(key)) {
    const { name, url } = CREATIVE_COMMONS_LICENSES[key];
    return { name, url };
  }
  if (!isLicenseUrl(value)) return 'unsaid';

  const name = typeof source.licenseName === 'string' ? source.licenseName.trim() : '';
  const deed = Object.values(CREATIVE_COMMONS_LICENSES).find((known) => known.url === value);
  return { name: name || deed?.name || value, url: value };
}
