export type Ending = 'drain' | 'close';

export interface Service {
  readonly name: string;
  start?(): void | Promise<void>;
  stop?(ending: Ending): void | Promise<void>;
  settled?(ending: Ending): Promise<void>;
  release?(): void;
}

export const DRAIN_PATIENCE_MS = 10_000;

export interface EndOptions {
  readonly patienceMs?: number;
  readonly warn?: (line: string) => void;
}

export async function startServices(services: readonly Service[]): Promise<void> {
  for (const service of services) await service.start?.();
}

/**
 * End the services for a reload, waiting at most the patience for each, then
 * `cutOff` the writes. A service left behind is still running, so the cut-off
 * is what keeps it from writing beside the next worker.
 */
export async function drainServices(
  services: readonly Service[],
  cutOff: () => void,
  options: EndOptions = {},
): Promise<void> {
  for (const service of services.toReversed()) {
    await withPatience(service.name, service.stop?.('drain'), options);
  }
  for (const service of services) {
    await withPatience(service.name, service.settled?.('drain'), options);
  }
  cutOff();
}

export async function closeServices(services: readonly Service[]): Promise<void> {
  for (const service of services.toReversed()) await service.stop?.('close');
  for (const service of services) await service.settled?.('close');
}

export function releaseServices(services: readonly Service[]): void {
  for (const service of services) service.release?.();
}

async function withPatience(
  name: string,
  work: void | Promise<void>,
  { patienceMs = DRAIN_PATIENCE_MS, warn = console.warn }: EndOptions,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const finished = await Promise.race([
    Promise.resolve(work).then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), patienceMs);
    }),
  ]);
  clearTimeout(timer);
  if (!finished) {
    warn(
      `Draining: ${name} had not finished after ${String(patienceMs / 1000)} s, so the reload goes on without it.`,
    );
  }
}
