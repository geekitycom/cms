/** One face of a family: a weight, upright or italic. */
export type FontStyle = {
  /** 100 to 900, in hundreds. */
  readonly weight: number;
  readonly italic: boolean;
};

/** Where the CSS2 API is asked for a family's stylesheet. */
export const CSS2_ORIGIN = 'https://fonts.googleapis.com';

/** Where the files the CSS2 stylesheet lists are served from. */
export const FONT_FILES_ORIGIN = 'https://fonts.gstatic.com';

/** The folder name a family's files live under: `atkinson-hyperlegible`. */
export function fontFamilySlug(family: string): string {
  return family.toLowerCase().replaceAll(' ', '-');
}

export function isFontStyle(style: FontStyle): boolean {
  return (
    Number.isInteger(style.weight) &&
    style.weight >= 100 &&
    style.weight <= 900 &&
    style.weight % 100 === 0
  );
}

/** The styles once each, upright before italic and lighter before bolder, which is the order Google wants. */
export function canonicalStyles(styles: readonly FontStyle[]): FontStyle[] {
  const unique = new Map(styles.map((style) => [styleKey(style), style]));
  return [...unique.values()]
    .map(({ weight, italic }) => ({ weight, italic }))
    .sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight);
}

/** `400`, or `400i` for an italic. */
export function styleKey(style: FontStyle): string {
  return `${String(style.weight)}${style.italic ? 'i' : ''}`;
}

/** `400 italic`, as a refusal names it. */
export function styleLabel(style: FontStyle): string {
  return `${String(style.weight)}${style.italic ? ' italic' : ''}`;
}

/**
 * The CSS2 API URL for a family in these styles, or for the family alone when
 * `styles` is empty. Spaces are `+` and the axis tuples are sorted, as the
 * API requires.
 */
export function css2Url(family: string, styles: readonly FontStyle[]): string {
  const name = family.replaceAll(' ', '+');
  const tuples = canonicalStyles(styles)
    .map((style) => `${style.italic ? '1' : '0'},${String(style.weight)}`)
    .join(';');
  const axes = tuples === '' ? '' : `:ital,wght@${tuples}`;
  return `${CSS2_ORIGIN}/css2?family=${name}${axes}&display=swap`;
}
