/** Whether a parsed value is a plain object whose keys can be read. Arrays are not. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonEmptyStrings(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item !== '');
}
