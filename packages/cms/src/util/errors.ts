/** What was thrown, as text a log line or a flash can carry. */
export function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * What was thrown, as one line safe to print to a terminal: a remote server's
 * error body can carry newlines that forge further log lines and escape
 * sequences that drive the terminal reading the log.
 */
export function oneLineMessageOf(thrown: unknown): string {
  const [firstLine = ''] = messageOf(thrown).split(/\r\n|\r|\n/, 1);
  return firstLine.replace(
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    /[\u0000-\u001f\u007f-\u009f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
