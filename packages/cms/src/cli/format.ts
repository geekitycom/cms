export function table(rows: readonly (readonly string[])[]): string {
  const widths =
    rows[0]?.map((_, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0))) ?? [];
  return rows
    .map(
      (row) =>
        `${row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0))).join('  ')}\n`,
    )
    .join('');
}

/** "1 follower", "2 followers". The plural is the singular plus s unless told. */
export function count(howMany: number, singular: string, plural = `${singular}s`): string {
  return `${String(howMany)} ${howMany === 1 ? singular : plural}`;
}
