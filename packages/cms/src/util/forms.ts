/** A form field or stored value as a string. A file upload, a missing field or any other shape is the empty one. */
export function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A value as the text it holds, or `null` when it is empty or not a string. */
export function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
