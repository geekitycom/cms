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
