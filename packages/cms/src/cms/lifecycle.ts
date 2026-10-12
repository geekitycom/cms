/** Why a CMS is ending its services: a drain may be resumed, a close may not. */
export type Ending = 'drain' | 'close';

/**
 * One part of a running CMS as serving, draining, resuming and closing see it.
 * Every step is optional: a sender has only a queue to wait for, a sweep has a
 * timer and a queue.
 */
export interface Service {
  /** Begin work once the site serves, and again on a resume. */
  start?(): void | Promise<void>;
  /** Take no new work: clear a timer, stop a watcher, stop the plugins. */
  stop?(ending: Ending): void | Promise<void>;
  /** Resolve once the work already queued has finished. */
  settled?(ending: Ending): Promise<void>;
  /** Let go of what keeps the process alive, once everything has settled. Close only. */
  release?(): void;
}

export async function startServices(services: readonly Service[]): Promise<void> {
  for (const service of services) await service.start?.();
}

/**
 * Stop every service, the last started first, and then wait for each queue in
 * list order, so a service that hands work to one later in the list is
 * settled before that one is.
 */
export async function endServices(services: readonly Service[], ending: Ending): Promise<void> {
  for (const service of services.toReversed()) await service.stop?.(ending);
  for (const service of services) await service.settled?.(ending);
}

export function releaseServices(services: readonly Service[]): void {
  for (const service of services) service.release?.();
}
