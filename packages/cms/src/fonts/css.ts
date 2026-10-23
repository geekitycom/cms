import { isFontFamilyName } from '../theme/font-family.ts';
import { FONT_FILES_ORIGIN } from './family.ts';
import type { FontStyle } from './family.ts';

/** One `@font-face` of a CSS2 stylesheet, read and checked. */
export interface GoogleFace {
  readonly family: string;
  readonly style: FontStyle;
  /** An https URL on fonts.gstatic.com. */
  readonly src: string;
  readonly unicodeRange: string | undefined;
}

export type GoogleCss =
  | { readonly ok: true; readonly faces: readonly GoogleFace[] }
  | { readonly ok: false; readonly reason: string };

const URL_TOKEN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g;
const FACE_BLOCK = /@font-face\s*\{([^{}]*)\}/g;
const UNICODE_RANGE =
  /^U\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?(?:\s*,\s*U\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?)*$/;

/** Whether a URL is one of Google's font files: https, on fonts.gstatic.com. */
export function isFontFileUrl(url: URL): boolean {
  return url.origin === FONT_FILES_ORIGIN && url.username === '' && url.password === '';
}

/**
 * The faces a CSS2 stylesheet declares. Every `url()` in it has to be an https
 * URL on fonts.gstatic.com and every block an `@font-face` whose values read
 * as what they claim to be, because the stylesheet the site serves is written
 * from these values and nothing else.
 */
export function parseGoogleCss(text: string): GoogleCss {
  for (const [, , value = ''] of text.matchAll(URL_TOKEN)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return { ok: false, reason: `the stylesheet names ${value}, which is not a URL` };
    }
    if (!isFontFileUrl(url)) {
      return {
        ok: false,
        reason: `the stylesheet names ${url.href}, which is not on ${FONT_FILES_ORIGIN}`,
      };
    }
  }

  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  if (css.replace(FACE_BLOCK, '').trim() !== '') {
    return { ok: false, reason: 'the stylesheet holds more than @font-face rules' };
  }

  const faces: GoogleFace[] = [];
  for (const [, body = ''] of css.matchAll(FACE_BLOCK)) {
    const face = readFace(body);
    if (typeof face === 'string') return { ok: false, reason: face };
    faces.push(face);
  }
  if (faces.length === 0) return { ok: false, reason: 'the stylesheet declares no faces' };
  return { ok: true, faces };
}

function readFace(body: string): GoogleFace | string {
  const declarations = new Map<string, string>();
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    declarations.set(
      declaration.slice(0, colon).trim().toLowerCase(),
      declaration.slice(colon + 1).trim(),
    );
  }

  const family = /^(['"])(.*)\1$/.exec(declarations.get('font-family') ?? '')?.[2];
  if (family === undefined || !isFontFamilyName(family)) {
    return `a face names the family ${String(declarations.get('font-family'))}`;
  }

  const fontStyle = declarations.get('font-style') ?? 'normal';
  if (fontStyle !== 'normal' && fontStyle !== 'italic') return `a face has the style ${fontStyle}`;

  const weightText = declarations.get('font-weight') ?? '400';
  const weight = /^\d{3}$/.test(weightText) ? Number(weightText) : Number.NaN;
  if (!Number.isInteger(weight)) return `a face has the weight ${weightText}`;

  const srcText = declarations.get('src') ?? '';
  const src = /^url\(\s*(['"]?)([^'")]*)\1\s*\)\s*format\(\s*(['"])woff2\3\s*\)$/.exec(
    srcText,
  )?.[2];
  if (src === undefined) return `a face's source is ${srcText}, not one WOFF2 file`;

  const unicodeRange = declarations.get('unicode-range');
  if (unicodeRange !== undefined && !UNICODE_RANGE.test(unicodeRange)) {
    return `a face has the unicode-range ${unicodeRange}`;
  }

  return { family, style: { weight, italic: fontStyle === 'italic' }, src, unicodeRange };
}

/** One face as the site serves it, pointing at its own copy of the file. */
export function faceRule(face: GoogleFace, href: string): string {
  return [
    '@font-face {',
    `  font-family: '${face.family}';`,
    `  font-style: ${face.style.italic ? 'italic' : 'normal'};`,
    `  font-weight: ${String(face.style.weight)};`,
    '  font-display: swap;',
    `  src: url(${href}) format('woff2');`,
    ...(face.unicodeRange === undefined ? [] : [`  unicode-range: ${face.unicodeRange};`]),
    '}',
    '',
  ].join('\n');
}
