/**
 * The messages between `geekity serve`'s supervisor and the worker that runs
 * the CMS (TASK-288). A reload is: the serving worker asks (`reload`); the
 * supervisor tells it to `drain`; it answers `drained` once it writes
 * nothing more; a new worker boots and says `ready`; the old one is told to
 * `retire`. A new worker that does not boot says `boot-failed`, and the old
 * one is told to `resume`, with the reason.
 */

export type WorkerMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'boot-failed'; readonly error: string }
  | { readonly type: 'reload' }
  | { readonly type: 'drained' };

export type SupervisorMessage =
  | { readonly type: 'drain' }
  | { readonly type: 'resume'; readonly error: string }
  | { readonly type: 'retire' }
  | { readonly type: 'shutdown' };

const WORKER_TYPES: ReadonlySet<string> = new Set(['ready', 'boot-failed', 'reload', 'drained']);
const SUPERVISOR_TYPES: ReadonlySet<string> = new Set(['drain', 'resume', 'retire', 'shutdown']);

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  return hasType(value, WORKER_TYPES);
}

export function isSupervisorMessage(value: unknown): value is SupervisorMessage {
  return hasType(value, SUPERVISOR_TYPES);
}

function hasType(value: unknown, types: ReadonlySet<string>): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && types.has(type);
}
