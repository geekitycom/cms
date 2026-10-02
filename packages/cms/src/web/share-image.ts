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

export interface ShareImageFallback {
  readonly url: string | undefined;
  readonly describedAs: string;
}

/**
 * The page's share image, or `undefined` when it has none.
 *
 * The alt text is the front matter's `imageAlt` for the entry's own picture,
 * because one picture can need describing differently in two posts; else what
 * the media library says about the upload.
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
  fallbacks: readonly ShareImageFallback[];
}): ShareImage | undefined {
  const own = nonEmpty(input.image);
  const chosen =
    own === undefined
      ? input.fallbacks.find((fallback) => nonEmpty(fallback.url) !== undefined)
      : { url: own, describedAs: input.title };
  const url = nonEmpty(chosen?.url);
  if (chosen === undefined || url === undefined) return undefined;

  const source = uploadPath(url);
  const described =
    source === undefined ? undefined : readAltTexts(input.config.contentDir).get(source);
  const alt =
    (own === undefined ? undefined : nonEmpty(input.imageAlt)) ??
    (described?.kind === 'described' ? nonEmpty(described.text) : undefined) ??
    chosen.describedAs;

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
