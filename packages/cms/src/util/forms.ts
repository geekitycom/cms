export function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
