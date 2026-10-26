export type Ending = 'drain' | 'close';

export interface Service {
  /** What a drain calls it when it will not wait for it any longer. */
  readonly name: string;
  start?(): void | Promise<void>;
  stop?(ending: Ending): void | Promise<void>;
  settled?(ending: Ending): Promise<void>;
  release?(): void;
}

/**
 * How long a drain waits for any one service to stop or settle. A service it
 * gives up on is cut off by the read-only switch that follows, as a request
 * write past the write gate's wait is, so the next worker still writes alone.
 */
export const DRAIN_PATIENCE_MS = 10_000;

export interface EndOptions {
  readonly patienceMs?: number;
  readonly warn?: (line: string) => void;
}

export async function startServices(services: readonly Service[]): Promise<void> {
  for (const service of services) await service.start?.();
}

export async function endServices(
  services: readonly Service[],
  ending: Ending,
  options: EndOptions = {},
): Promise<void> {
  const end = async (service: Service, work: void | Promise<void>): Promise<void> => {
    if (ending === 'close') {
      await work;
      return;
    }
    await withPatience(service.name, work, options);
  };
  for (const service of services.toReversed()) await end(service, service.stop?.(ending));
  for (const service of services) await end(service, service.settled?.(ending));
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
