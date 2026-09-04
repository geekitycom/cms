import { UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import {
  describeImage,
  generateImageVariants,
  imageMediaType,
  VARIANT_ASSET_PREFIX,
} from './variants.ts';
import type { ImageConfig, ImageRecord, ImageVariant } from './variants.ts';

/**
 * Responsive markup for the site's own pages.
 *
 * This runs over the HTML on its way into a theme template and nowhere else.
 * The feeds, the JSON and Markdown representations and the ActivityStreams
 * `content` keep the plain `<img>` that {@link renderMarkdown} produced, as
 * decision-10 requires: a reader's client and a remote instance cannot resolve
 * a `srcset` of this site's derived files sensibly, and half of them would
 * strip the `<picture>` anyway.
 */

/** What the markup asks about an upload. See {@link describeImage}. */
export type DescribeImage = (source: string) => ImageRecord | undefined;

/**
 * The `sizes` every image is given.
 *
 * `100vw` is 11ty/image's own default and the only honest one a CMS can pick:
 * how wide a picture is drawn is a fact about the theme's stylesheet, which
 * this code has never seen. A theme that knows better overrides it, and being
 * wrong here costs bandwidth rather than correctness — the browser picks a
 * candidate that is too wide, never one that is too small.
 */
export const IMAGE_SIZES = '100vw';

/** Every `<img>` tag, with its attribute text. Void elements have no closing half. */
const IMG_TAG = /<img\s([^>]*?)\/?>/gi;

/** One attribute of a tag: its name, and its value however it was quoted. */
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

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
export function responsiveImages(html: string, describe: DescribeImage): string {
  if (!html.includes('<img')) return html;

  return html.replace(IMG_TAG, (tag: string, attributes: string) => {
    const parsed = parseAttributes(attributes);

    const src = parsed.get('src');
    if (src === undefined) return tag;

    const source = uploadPath(src);
    if (source === undefined) return tag;

    const record = describe(source);
    if (record === undefined || record.variants.length === 0) return tag;

    return picture({ tag, attributes: parsed, record });
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
export function siteImageMarkup(config: ImageConfig, html: string): string {
  if (!config.imageOptimization) return html;

  return responsiveImages(html, (source) => {
    const record = describeImage(config, source);
    if (record === undefined) {
      void generateImageVariants(config, source).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Could not derive image variants for ${source}: ${message}`);
      });
    }
    return record;
  });
}

/** One `<picture>`: a `<source>` per derived format, then the original's `<img>`. */
function picture(input: {
  tag: string;
  attributes: Map<string, string>;
  record: ImageRecord;
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
      `<source type="${type}" srcset="${srcset(record.source, variants)}" sizes="${IMAGE_SIZES}">`,
    );
  }

  const fallback = byFormat.get(record.format) ?? [];
  return `<picture>${sources.join('')}${image(input.tag, input.attributes, record, fallback)}</picture>`;
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
  tag: string,
  attributes: Map<string, string>,
  record: ImageRecord,
  fallback: ImageVariant[],
): string {
  const additions: string[] = [];

  if (fallback.length > 0) additions.push(`srcset="${srcset(record.source, fallback)}"`);
  additions.push(`sizes="${IMAGE_SIZES}"`);
  additions.push(`width="${String(record.width)}"`);
  additions.push(`height="${String(record.height)}"`);
  additions.push('loading="lazy"');

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
function srcset(source: string, variants: ImageVariant[]): string {
  return [...variants]
    .sort((a, b) => a.width - b.width)
    .map((variant) => `${variantHref(source, variant)} ${String(variant.width)}w`)
    .join(', ');
}

/** The URL of one derived file, with every path segment encoded as a URL wants. */
function variantHref(source: string, variant: ImageVariant): string {
  const segments = [...source.split('/'), variant.file].map((segment) =>
    encodeURIComponent(segment),
  );
  return `${VARIANT_ASSET_PREFIX}${segments.join('/')}`;
}

/**
 * The upload a `src` points at, relative to `content/uploads/`, or
 * `undefined` when it points somewhere else.
 *
 * A derived file is somewhere else on purpose: the rewrite must not be able to
 * feed on its own output, whether that is a page rendered twice or an author
 * who pasted a variant URL by hand.
 */
function uploadPath(src: string): string | undefined {
  if (src.startsWith(VARIANT_ASSET_PREFIX)) return undefined;
  if (!src.startsWith(UPLOAD_ASSET_PREFIX)) return undefined;

  const relative = src.slice(UPLOAD_ASSET_PREFIX.length);
  if (relative === '' || relative.includes('..')) return undefined;

  // A URL is what is in the attribute and a path is what is on disk, so the
  // percent-encoding markdown-it applied has to come off before the lookup.
  try {
    return relative.split('/').map(decodeURIComponent).join('/');
  } catch {
    return undefined;
  }
}

/** A tag's attributes by lower-cased name, with entities left as written. */
function parseAttributes(attributes: string): Map<string, string> {
  const parsed = new Map<string, string>();

  for (const match of attributes.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? '').toLowerCase();
    if (name === '' || parsed.has(name)) continue;
    parsed.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }

  return parsed;
}

/** The five entities markdown-it writes into an attribute, back as characters. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
