import { escapeAttribute } from '../util/html.ts';
import { messageOf } from '../util/errors.ts';
import { IMG_TAG, parseAttributes, uploadPath } from '../content/image-tags.ts';
import { describeImage, generateImageVariants, imageMediaType } from './variants.ts';
import { VARIANT_ASSET_PREFIX } from '../content/uploads.ts';
import { versioned } from './paths.ts';
import type { DescribedImage, ImageConfig, ImageVariant } from './variants.ts';

/**
 * Responsive markup for the site's own pages.
 *
 * This runs over the HTML on its way into a theme template and nowhere else.
 * The feeds, the JSON and Markdown representations and the ActivityStreams
 * `content` keep the plain `<img>` that {@link renderMarkdown} produced: a
 * reader's client and a remote instance cannot resolve
 * a `srcset` of this site's derived files sensibly, and half of them would
 * strip the `<picture>` anyway.
 */

/** What the markup asks about an upload. See {@link describeImage}. */
export type DescribeImage = (source: string) => DescribedImage | undefined;

/**
 * The `sizes` every image is given.
 *
 * `100vw` is 11ty/image's own default and the only honest one a CMS can pick:
 * how wide a picture is drawn is a fact about the theme's stylesheet, which
 * this code has never seen. A tag that carries its own `sizes`, or a caller
 * that passes {@link ImageLoading.sizes}, overrides it, and being
 * wrong here costs bandwidth rather than correctness — the browser picks a
 * candidate that is too wide, never one that is too small.
 */
export const IMAGE_SIZES = '100vw';

/**
 * How a fragment's images are fetched.
 *
 * `lead` marks the fragment that opens the page, a single post's body or a
 * listing's first entry. Its first image is usually the page's Largest
 * Contentful Paint, so it is fetched at once and ahead of everything else
 * rather than lazily; every other image waits until it is scrolled near.
 */
export interface ImageLoading {
  lead?: boolean;
  /** The `sizes` for a fragment whose images are drawn at a known width. */
  sizes?: string;
}

/**
 * Rewrite every uploaded image in a fragment of HTML as a `<picture>`.
 *
 * An image is left exactly as it was when it points somewhere else, when it
 * points at a derived file already, or when the lookup knows nothing about it
 * — which is the case for a GIF, for an SVG, and for any upload whose variants
 * have not been derived yet. Leaving it alone is always safe: the original is
 * the source of truth and the site serves it either way.
 *
 * It is a text rewrite rather than a parse because the input is one document's
 * body, the only tags it has to understand are `<img>` ones, and a parser
 * would have to reproduce the exact HTML around them to hand it back.
 */
export function responsiveImages(
  html: string,
  describe: DescribeImage,
  loading: ImageLoading = {},
): string {
  if (!html.includes('<img')) return html;

  // Counted over every `<img>`, rewritten or not: a first image from
  // somewhere else is still the one a reader sees first.
  let seen = 0;
  return html.replace(IMG_TAG, (tag: string, attributes: string) => {
    const lead = loading.lead === true && seen++ === 0;
    const parsed = parseAttributes(attributes);

    const src = parsed.get('src');
    if (src === undefined) return tag;

    const source = uploadPath(src);
    if (source === undefined) return tag;

    const record = describe(source);
    if (record === undefined || record.variants.length === 0) return tag;

    const sizes = parsed.get('sizes') ?? loading.sizes ?? IMAGE_SIZES;
    return picture({ tag, attributes: parsed, record, lead, sizes });
  });
}

/**
 * The same rewrite, over one site's own derived images.
 *
 * An upload with no record yet is left plain and its variants are derived in
 * the background, so the page that first mentions a newly hand-dropped image
 * renders at once and the one after it is responsive. Nothing waits on an
 * encoder while a reader waits on a page.
 */
export function siteImageMarkup(
  config: ImageConfig,
  html: string,
  loading: ImageLoading = {},
): string {
  if (!config.imageOptimization) return html;

  return responsiveImages(html, (source) => siteImageRecord(config, source), loading);
}

/**
 * What is known about one of the site's uploads, deriving its variants in the
 * background when nothing is yet, so the next render knows.
 */
export function siteImageRecord(config: ImageConfig, source: string): DescribedImage | undefined {
  const record = describeImage(config, source);
  if (record === undefined && config.imageOptimization) {
    void generateImageVariants(config, source).catch((error: unknown) => {
      const message = messageOf(error);
      console.warn(`Could not derive image variants for ${source}: ${message}`);
    });
  }
  return record;
}

/** One `<picture>`: a `<source>` per derived format, then the original's `<img>`. */
function picture(input: {
  tag: string;
  attributes: Map<string, string>;
  record: DescribedImage;
  lead: boolean;
  sizes: string;
}): string {
  const { record } = input;

  const byFormat = new Map<string, ImageVariant[]>();
  for (const variant of record.variants) {
    byFormat.set(variant.format, [...(byFormat.get(variant.format) ?? []), variant]);
  }

  const sources: string[] = [];
  for (const [format, variants] of byFormat) {
    // The original's own format is the `<img>`, not a `<source>`: a browser
    // that skipped every source has to land on something.
    if (format === record.format) continue;
    const type = imageMediaType(format);
    if (type === undefined) continue;
    sources.push(
      `<source type="${type}" srcset="${srcset(record, variants)}" sizes="${escapeAttribute(input.sizes)}">`,
    );
  }

  const fallback = byFormat.get(record.format) ?? [];
  return `<picture>${sources.join('')}${image(input, fallback)}</picture>`;
}

/**
 * The `<img>` at the bottom of the `<picture>`: the author's tag, with what
 * the record knows added to it.
 *
 * The author's own attributes are kept verbatim and win over every one of
 * these — a `width` written by hand is a decision, and a CMS that overruled it
 * would be a CMS that could not be argued with.
 */
function image(
  input: {
    tag: string;
    attributes: Map<string, string>;
    record: DescribedImage;
    lead: boolean;
    sizes: string;
  },
  fallback: ImageVariant[],
): string {
  const { tag, attributes, record, lead } = input;
  const additions: string[] = [];

  if (fallback.length > 0) additions.push(`srcset="${srcset(record, fallback)}"`);
  additions.push(`sizes="${escapeAttribute(input.sizes)}"`);
  additions.push(`width="${String(record.width)}"`);
  additions.push(`height="${String(record.height)}"`);
  additions.push(lead ? 'fetchpriority="high"' : 'loading="lazy"');
  additions.push('decoding="async"');

  const wanted = additions.filter((addition) => {
    const name = addition.slice(0, addition.indexOf('='));
    return !attributes.has(name);
  });
  if (wanted.length === 0) return tag;

  // The author's tag with the additions inserted before its close, so nothing
  // about how it was written — the quoting, the order, a stray attribute the
  // CMS has never heard of — is reconstructed and possibly got wrong.
  const close = tag.endsWith('/>') ? -2 : -1;
  return `${tag.slice(0, close).trimEnd()} ${wanted.join(' ')}>`;
}

/** A `srcset`: every variant of one format, narrowest first, with its width descriptor. */
function srcset(record: DescribedImage, variants: ImageVariant[]): string {
  return [...variants]
    .sort((a, b) => a.width - b.width)
    .map((variant) => `${variantHref(record, variant)} ${String(variant.width)}w`)
    .join(', ');
}

/**
 * The URL of one derived file, with every path segment encoded as a URL wants
 * and the original's version on the end.
 */
function variantHref(record: DescribedImage, variant: ImageVariant): string {
  const segments = [...record.source.split('/'), variant.file].map((segment) =>
    encodeURIComponent(segment),
  );
  return versioned(`${VARIANT_ASSET_PREFIX}${segments.join('/')}`, record.version);
}
