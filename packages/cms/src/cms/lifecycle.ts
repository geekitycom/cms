export type Ending = 'drain' | 'close';

export interface Service {
  start?(): void | Promise<void>;
  stop?(ending: Ending): void | Promise<void>;
  settled?(ending: Ending): Promise<void>;
  release?(): void;
}

export async function startServices(services: readonly Service[]): Promise<void> {
  for (const service of services) await service.start?.();
}

export async function endServices(services: readonly Service[], ending: Ending): Promise<void> {
  for (const service of services.toReversed()) await service.stop?.(ending);
  for (const service of services) await service.settled?.(ending);
}

export function releaseServices(services: readonly Service[]): void {
  for (const service of services) service.release?.();
}
