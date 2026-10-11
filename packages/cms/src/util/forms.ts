export function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function trimmedField(body: Readonly<Record<string, unknown>>, name: string): string {
  return stringOrEmpty(body[name]).trim();
}

/** The indexes of a form's numbered rows, in order, read off the names `prefix0`, `prefix1`… */
export function rowIndexes(body: Readonly<Record<string, unknown>>, prefix: string): number[] {
  return Object.keys(body)
    .map((name) => new RegExp(`^${prefix}(\\d+)$`).exec(name)?.[1])
    .filter((index) => index !== undefined)
    .map(Number)
    .sort((left, right) => left - right);
}
