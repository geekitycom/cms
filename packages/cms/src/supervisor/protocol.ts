/**
 * The messages between `geekity serve`'s supervisor and the worker that runs
 * the CMS (TASK-288). A reload is: the serving worker asks (`reload`); the
 * supervisor tells it to `drain`; it answers `drained` once it writes
 * nothing more; a new worker boots and says `ready`; the old one is told to
 * `retire`. A new worker that does not boot says `boot-failed`, and the old
 * one is told to `resume`, with the reason.
 *
 * A worker that has closed says `closed` and exits only when told `exit`.
 * Under `node:cluster`'s round-robin the supervisor may have handed this
 * worker a connection just before it stopped listening; the worker sends
 * such a connection back, but only while it runs. The `exit` comes down the
 * same channel as those connections, after them, so none is lost with the
 * process and left unanswered.
 */

/**
 * How a worker that cannot carry on gives up: it exits with this code, and the
 * supervisor boots a replacement, as it does for any serving or draining
 * worker that exits without being told to.
 */
export const EXIT_FOR_REPLACEMENT = 1;

export type WorkerMessage =
  | { readonly type: 'ready'; readonly pluginsFingerprint: string }
  | { readonly type: 'boot-failed'; readonly error: string }
  | { readonly type: 'reload' }
  | { readonly type: 'drained' }
  | { readonly type: 'closed' };

export type SupervisorMessage =
  | { readonly type: 'drain' }
  | { readonly type: 'resume'; readonly error: string }
  | { readonly type: 'retire' }
  | { readonly type: 'shutdown' }
  | { readonly type: 'exit' };

const WORKER_TYPES: ReadonlySet<string> = new Set([
  'ready',
  'boot-failed',
  'reload',
  'drained',
  'closed',
]);
const SUPERVISOR_TYPES: ReadonlySet<string> = new Set([
  'drain',
  'resume',
  'retire',
  'shutdown',
  'exit',
]);

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
