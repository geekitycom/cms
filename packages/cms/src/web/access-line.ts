/**
 * One line in the access log's field order: what was asked, the status, how
 * long it took, and the client address when there is one to give.
 */
export function accessLine(
  method: string,
  target: string,
  status: number,
  started: number,
  address: string | undefined,
): string {
  const elapsed = (performance.now() - started).toFixed(1);
  const line = `${method} ${target} ${String(status)} ${elapsed}ms`;
  return address === undefined ? line : `${line} ${address}`;
}
