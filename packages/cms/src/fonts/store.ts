import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { writeFileAtomically } from '../files/atomic.ts';
import { FONTS, dataFolder, dataPath } from '../files/data-files.ts';
import { findAsset } from '../files/static-files.ts';
import type { StaticAsset } from '../files/static-files.ts';
import { assetVersion } from '../theme/assets.ts';
import type { HostLookup } from '../util/public-address.ts';
import { fetchPublic } from '../webmention/fetch-public.ts';
import { isFontFamilyName } from '../theme/font-family.ts';
import { faceRule, isFontFileUrl, parseGoogleCss } from './css.ts';
import type { GoogleFace } from './css.ts';
import {
  CSS2_ORIGIN,
  canonicalStyles,
  css2Url,
  fontFamilySlug,
  isFontStyle,
  styleKey,
  styleLabel,
} from './family.ts';
import type { FontStyle } from './family.ts';

export const FONT_PATH_PREFIX = '/_geekity/fonts/';

/**
 * The CSS2 API answers each browser with what it can use. A current desktop
 * Chrome is answered with WOFF2 files split into unicode-range subsets.
 */
export const FONT_FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** How long one request to Google is given, body included. */
export const FONT_FETCH_TIMEOUT_MS = 15_000;

const CSS_MAX_BYTES = 1_000_000;
const FILE_MAX_BYTES = 5_000_000;
const FAMILY_MAX_BYTES = 64_000_000;
const MAX_FILES = 1_000;
const PARALLEL_DOWNLOADS = 6;

const FILE_NAME = /^[0-9a-f]{12}\.woff2$/;
const STYLESHEET_NAME = /^\d{3}i?(?:-\d{3}i?)*\.css$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Why a family was not fetched. `message` is a sentence for the person who chose it. */
export type FontRefusal =
  | { readonly kind: 'invalid-name'; readonly family: string; readonly message: string }
  | { readonly kind: 'unknown-family'; readonly family: string; readonly message: string }
  | {
      readonly kind: 'missing-styles';
      readonly family: string;
      readonly styles: readonly FontStyle[];
      readonly message: string;
    }
  | { readonly kind: 'unavailable'; readonly family: string; readonly message: string };

export interface FontStylesheet {
  /** Same-origin, with `?v=` the hash of its bytes, so it can be cached for a year. */
  readonly href: string;
  readonly family: string;
}

export type FontFetch =
  | {
      readonly ok: true;
      readonly stylesheet: FontStylesheet;
      /** Whether Google was asked: false when every file was already here. */
      readonly fetched: boolean;
    }
  | { readonly ok: false; readonly refusal: FontRefusal };

export interface CreateFontStoreOptions {
  readonly dataDir: string;
  readonly hostLookup: HostLookup;
}

export interface FontStore {
  /**
   * Make sure the family is here in these styles: nothing to do when its
   * stylesheet and every file it names are on disk, else fetch it. A family
   * or style Google lacks is a refusal, and nothing is written. Two calls for
   * the same family and styles at once share one fetch.
   */
  ensure(family: string, styles: readonly FontStyle[], signal?: AbortSignal): Promise<FontFetch>;
  /**
   * The stylesheet to link for the family in these styles, or `undefined`
   * when it has not been fetched or a file it names is gone. Synchronous, for
   * a page render: it costs a `stat` while the stylesheet is unchanged.
   */
  stylesheet(family: string, styles: readonly FontStyle[]): FontStylesheet | undefined;
  /** A file the store wrote, for the font route, or `undefined` for any other name. */
  file(slug: string, name: string): StaticAsset | undefined;
  /** Resolve once every fetch in flight has finished. */
  settled(): Promise<void>;
}

export function createFontStore(options: CreateFontStoreOptions): FontStore {
  const { dataDir, hostLookup } = options;
  const inFlight = new Map<string, Promise<FontFetch>>();
  const known = new Map<string, { etag: string; stylesheet: FontStylesheet | undefined }>();

  function stylesheetName(styles: readonly FontStyle[]): string {
    return `${styles.map(styleKey).join('-')}.css`;
  }

  function folderOf(slug: string): string {
    return path.join(dataFolder(dataDir, FONTS), slug);
  }

  function present(slug: string, name: string, fresh: boolean): FontStylesheet | undefined {
    const asset = findAsset(name, [folderOf(slug)]);
    if (asset === undefined) return undefined;
    const memo = known.get(asset.file);
    if (!fresh && memo?.etag === asset.etag) return memo.stylesheet;

    const css = readFileSync(asset.file, 'utf8');
    const family = /font-family: '([^']*)'/.exec(css)?.[1];
    const prefix = `${FONT_PATH_PREFIX}${slug}/`;
    const files = [...css.matchAll(/url\(([^)]*)\)/g)].map(([, href = '']) =>
      href.startsWith(prefix) ? href.slice(prefix.length) : '',
    );
    const whole =
      family !== undefined &&
      files.length > 0 &&
      files.every(
        (file) => FILE_NAME.test(file) && existsSync(dataPath(dataDir, FONTS, slug, file)),
      );
    const stylesheet = whole
      ? { href: `${prefix}${name}?v=${assetVersion(asset)}`, family }
      : undefined;
    known.set(asset.file, { etag: asset.etag, stylesheet });
    return stylesheet;
  }

  async function fetchFamily(
    family: string,
    styles: readonly FontStyle[],
    signal: AbortSignal | undefined,
  ): Promise<FontFetch> {
    const slug = fontFamilySlug(family);
    const name = stylesheetName(styles);
    const held = present(slug, name, true);
    if (held !== undefined) return { ok: true, stylesheet: held, fetched: false };

    const refuse = (message: string): FontFetch => ({
      ok: false,
      refusal: {
        kind: 'unavailable',
        family,
        message: `${family} could not be fetched from Google Fonts: ${message}.`,
      },
    });

    const css = await fetchCss(css2Url(family, styles), hostLookup, signal);
    if (css.kind === 'missing')
      return { ok: false, refusal: await whatIsMissing(family, styles, hostLookup, signal) };
    if (css.kind === 'unavailable') return refuse(css.reason);

    const parsed = parseGoogleCss(css.text);
    if (!parsed.ok) return refuse(parsed.reason);
    const lacking = styles.filter(
      (style) => !parsed.faces.some((face) => styleKey(face.style) === styleKey(style)),
    );
    if (lacking.length > 0) return { ok: false, refusal: missingStyles(family, lacking) };
    if (parsed.faces.length > MAX_FILES)
      return refuse(`it lists more than ${String(MAX_FILES)} files`);

    const downloaded = await downloadAll(parsed.faces, hostLookup, signal);
    if (!downloaded.ok) return refuse(downloaded.reason);

    const rules: string[] = [];
    for (const face of parsed.faces) {
      const bytes = downloaded.files.get(face.src);
      if (bytes === undefined) return refuse(`${face.src} was not downloaded`);
      const file = `${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.woff2`;
      const target = dataPath(dataDir, FONTS, slug, file);
      if (!existsSync(target)) await writeFileAtomically(target, bytes);
      rules.push(faceRule(face, `${FONT_PATH_PREFIX}${slug}/${file}`));
    }
    await writeFileAtomically(dataPath(dataDir, FONTS, slug, name), rules.join('\n'));

    const written = present(slug, name, true);
    if (written === undefined) return refuse('its files were not all written');
    return { ok: true, stylesheet: written, fetched: true };
  }

  return {
    ensure(family, styles, signal) {
      if (!isFontFamilyName(family)) {
        return Promise.resolve({
          ok: false,
          refusal: {
            kind: 'invalid-name',
            family,
            message: `${JSON.stringify(family)} is not a Google Fonts family name.`,
          },
        });
      }
      const canonical = canonicalStyles(styles);
      if (canonical.length === 0 || !canonical.every(isFontStyle)) {
        throw new Error(`Fetching ${family} needs at least one style of weight 100 to 900.`);
      }
      const key = `${fontFamilySlug(family)}/${stylesheetName(canonical)}`;
      const running = inFlight.get(key);
      if (running !== undefined) return running;
      const started = fetchFamily(family, canonical, signal).finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    },

    stylesheet(family, styles) {
      if (!isFontFamilyName(family)) return undefined;
      return present(fontFamilySlug(family), stylesheetName(canonicalStyles(styles)), false);
    },

    file(slug, name) {
      if (!SLUG.test(slug) || !(FILE_NAME.test(name) || STYLESHEET_NAME.test(name))) {
        return undefined;
      }
      return findAsset(name, [folderOf(slug)]);
    },

    async settled() {
      await Promise.allSettled([...inFlight.values()]);
    },
  };
}

function missingStyles(family: string, styles: readonly FontStyle[]): FontRefusal {
  return {
    kind: 'missing-styles',
    family,
    styles,
    message: `${family} has no ${styles.map(styleLabel).join(' or ')} on Google Fonts.`,
  };
}

type CssAnswer =
  | { readonly kind: 'css'; readonly text: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable'; readonly reason: string };

function timeoutSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

/** The CSS2 API's answer. Google says 400 for a family or a style it does not have. */
async function fetchCss(
  url: string,
  lookup: HostLookup,
  signal: AbortSignal | undefined,
): Promise<CssAnswer> {
  const fetched = await fetchPublic(url, {
    lookup,
    signal: timeoutSignal(signal),
    maxBytes: CSS_MAX_BYTES,
    accept: 'text/css,*/*;q=0.1',
    userAgent: FONT_FETCH_USER_AGENT,
    allowed: (at) => at.origin === CSS2_ORIGIN,
    contentType: { pattern: /^\s*text\/css\s*(;|$)/i, name: 'a stylesheet' },
  });
  if (fetched.ok) return { kind: 'css', text: Buffer.from(fetched.body).toString('utf8') };
  if (fetched.status === 400) return { kind: 'missing' };
  return { kind: 'unavailable', reason: fetched.reason };
}

async function whatIsMissing(
  family: string,
  styles: readonly FontStyle[],
  lookup: HostLookup,
  signal: AbortSignal | undefined,
): Promise<FontRefusal> {
  const lacking: FontStyle[] = [];
  for (const style of styles) {
    const answer = await fetchCss(css2Url(family, [style]), lookup, signal);
    if (answer.kind === 'unavailable') {
      return {
        kind: 'unavailable',
        family,
        message: `${family} could not be fetched from Google Fonts: ${answer.reason}.`,
      };
    }
    if (answer.kind === 'missing') lacking.push(style);
  }
  if (lacking.length < styles.length) return missingStyles(family, lacking);

  const alone = await fetchCss(css2Url(family, []), lookup, signal);
  if (alone.kind === 'css') return missingStyles(family, styles);
  return {
    kind: 'unknown-family',
    family,
    message: `Google Fonts has no family called ${family}.`,
  };
}

type Downloaded =
  | { readonly ok: true; readonly files: ReadonlyMap<string, Uint8Array> }
  | { readonly ok: false; readonly reason: string };

async function downloadAll(
  faces: readonly GoogleFace[],
  lookup: HostLookup,
  signal: AbortSignal | undefined,
): Promise<Downloaded> {
  const sources = [...new Set(faces.map((face) => face.src))];
  const files = new Map<string, Uint8Array>();
  let total = 0;
  let failure: string | undefined;
  let next = 0;

  async function worker(): Promise<void> {
    while (failure === undefined && next < sources.length) {
      const source = sources[next] ?? '';
      next += 1;
      const fetched = await fetchPublic(source, {
        lookup,
        signal: timeoutSignal(signal),
        maxBytes: FILE_MAX_BYTES,
        accept: 'font/woff2',
        userAgent: FONT_FETCH_USER_AGENT,
        allowed: isFontFileUrl,
        contentType: { pattern: /^\s*font\/woff2\s*(;|$)/i, name: 'a WOFF2 font' },
      });
      if (!fetched.ok) {
        failure ??= `${source} ${fetched.reason}`;
        return;
      }
      if (Buffer.from(fetched.body.subarray(0, 4)).toString('latin1') !== 'wOF2') {
        failure ??= `${source} is not a WOFF2 file`;
        return;
      }
      total += fetched.body.length;
      if (total > FAMILY_MAX_BYTES) {
        failure ??= `its files come to more than ${String(FAMILY_MAX_BYTES)} bytes`;
        return;
      }
      files.set(source, fetched.body);
    }
  }

  await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, worker));
  return failure === undefined ? { ok: true, files } : { ok: false, reason: failure };
}
