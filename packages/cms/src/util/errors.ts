/** What was thrown, as text a log line or a flash can carry. */
export function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
