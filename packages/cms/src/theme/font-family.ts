const MAX_FAMILY_LENGTH = 64;

/**
 * Whether `name` can be a Google Fonts family name: letters and digits in
 * words split by single spaces, as every family Google lists is. It is the
 * check that lets a family name be printed into CSS and a URL with nothing
 * to escape, which is why the `headingFont` and `bodyFont` settings and the
 * font store both hold to it (decision-61).
 */
export function isFontFamilyName(name: string): boolean {
  return name.length <= MAX_FAMILY_LENGTH && /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(name);
}
