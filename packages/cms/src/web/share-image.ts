import { readAltTexts } from '../images/alt-text.ts';
import { siteImageRecord, uploadPath } from '../images/markup.ts';
import type { ImageConfig } from '../images/paths.ts';

/**
 * The picture a link to a page is shown with when somebody posts it: the
 * `og:image` and the Twitter card's image, and everything said about it
 * (TASK-146).
 */
export interface ShareImage {
  /** Where it is, as the front matter or the site setting wrote it. */
  readonly url: string;
  /** What it shows, for `og:image:alt`. Never empty: an image is never printed without one. */
  readonly alt: string;
  /** Its size, when the variant sidecar has recorded one. */
  readonly size?: { readonly width: number; readonly height: number } | undefined;
  /** The Twitter card it fits: a large picture above the words, or a small one beside them. */
  readonly card: 'summary' | 'summary_large_image';
}

/**
 * How wide a picture has to be for a large card: the width Open Graph
 * consumers recommend, and the one Google Discover requires before it shows a
 * large preview.
 */
export const LARGE_CARD_MIN_WIDTH = 1200;

/**
 * The page's share image, or `undefined` when it has none: the entry's own
 * `image`, else the site's avatar.
 *
 * The alt text is the front matter's `imageAlt` for the entry's own picture,
 * because one picture can need describing differently in two posts; else what
 * the media library says about the upload; else the entry's title for its own
 * picture and the site's author for the avatar, which is a picture of them.
 *
 * The size is read off the variant sidecar, never off the file, so a render
 * never opens an image (decision-10). A picture with no sidecar has no size
 * and gets the small card until one has been derived.
 */
export function shareImage(input: {
  config: ImageConfig;
  /** The front matter's `image`, whatever type it turned out to be. */
  image: unknown;
  /** The front matter's `imageAlt`. */
  imageAlt: unknown;
  /** What the page is called, for an undescribed picture of its own. */
  title: string;
  /** The site's avatar, and who it is a picture of. */
  avatar: string | undefined;
  owner: string;
}): ShareImage | undefined {
  const own = nonEmpty(input.image);
  const url = own ?? nonEmpty(input.avatar);
  if (url === undefined) return undefined;

  const source = uploadPath(url);
  const described =
    source === undefined ? undefined : readAltTexts(input.config.contentDir).get(source);
  const alt =
    (own === undefined ? undefined : nonEmpty(input.imageAlt)) ??
    (described?.kind === 'described' ? nonEmpty(described.text) : undefined) ??
    (own === undefined ? input.owner : input.title);

  const record = source === undefined ? undefined : siteImageRecord(input.config, source);
  const size = record === undefined ? undefined : { width: record.width, height: record.height };
  const large =
    size !== undefined && size.width >= LARGE_CARD_MIN_WIDTH && size.width > size.height;

  return { url, alt, size, card: large ? 'summary_large_image' : 'summary' };
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
