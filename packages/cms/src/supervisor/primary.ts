/**
 * `geekity serve`'s supervisor (TASK-288, decision-33): the primary process
 * that owns the port and runs the CMS in one worker, replacing it on a reload
 * and respawning it when it crashes.
 *
 * The port stays open only while some worker listens on it, so a reload
 * starts the new worker before it retires the old one. And only one worker
 * writes at a time: the old one drains (refuses writes, stops its timers,
 * empties its queues, goes read-only) before the new one is forked, so the
 * new worker's boot migrations run alone.
 *
 * This module is the state machine alone. The workers, the clock and the
 * process are handed in, so the order of a reload is tested without
 * starting a process; {@link superviseCluster} binds it to `node:cluster`.
 */

import cluster from 'node:cluster';

import { isWorkerMessage } from './protocol.ts';
import type { SupervisorMessage, WorkerMessage } from './protocol.ts';

/** A running worker, as the supervisor reaches it. */
export interface WorkerHandle {
  readonly id: number;
  send(message: SupervisorMessage): void;
  kill(): void;
}

export interface Cancel {
  cancel(): void;
}

export interface SupervisorOptions {
  fork(): WorkerHandle;
  schedule(task: () => void, ms: number): Cancel;
  now(): number;
  log(line: string): void;
  exit(code: number): void;
}

export interface Supervisor {
  start(): void;
  message(worker: WorkerHandle, message: WorkerMessage): void;
  exited(worker: WorkerHandle, code: number | null): void;
  /** SIGTERM or SIGINT: shut every worker down, then exit. */
  stop(): void;
}

/** The first respawn waits this long, doubling with each crash after it. */
const RESPAWN_BASE_MS = 500;
const RESPAWN_MAX_MS = 30_000;
/** A worker that served this long resets the backoff. */
const STABLE_MS = 60_000;
/** How long a new worker may take to boot during a reload: a large site's scan, at most. */
const RELOAD_BOOT_MS = 5 * 60_000;
/** How long the workers may take to close on a signal before they are killed. */
const SHUTDOWN_MS = 60_000;

type State =
  /** A worker is booting with none serving: the first, or a respawn. */
  | { readonly phase: 'booting'; readonly worker: WorkerHandle }
  | { readonly phase: 'serving'; readonly worker: WorkerHandle; readonly since: number }
  /** The old worker is draining; nothing new boots until it writes nothing. */
  | { readonly phase: 'draining'; readonly old: WorkerHandle }
  /** The old worker serves reads while the new one boots. */
  | {
      readonly phase: 'replacing';
      readonly old: WorkerHandle;
      readonly next: WorkerHandle;
      readonly deadline: Cancel;
    }
  /** No worker; one is forked when the backoff runs out. */
  | { readonly phase: 'waiting'; readonly timer: Cancel }
  | { readonly phase: 'stopping' };

export function createSupervisor(options: SupervisorOptions): Supervisor {
  const live = new Set<WorkerHandle>();
  const bootErrors = new Map<WorkerHandle, string>();
  let state: State = { phase: 'stopping' };
  let everServed = false;
  let crashes = 0;

  function fork(): WorkerHandle {
    const worker = options.fork();
    live.add(worker);
    return worker;
  }

  function respawnLater(reason: string): void {
    const delay = Math.min(RESPAWN_BASE_MS * 2 ** crashes, RESPAWN_MAX_MS);
    crashes += 1;
    options.log(`${reason}; starting another in ${(delay / 1000).toFixed(1)} s.`);
    state = {
      phase: 'waiting',
      timer: options.schedule(() => {
        state = { phase: 'booting', worker: fork() };
      }, delay),
    };
  }

  /** The new worker did not boot: the old one carries on, and is told why. */
  function keepOld(old: WorkerHandle, next: WorkerHandle, error: string): void {
    if (state.phase === 'replacing') state.deadline.cancel();
    options.log(`Reload failed, so the running server carries on: ${error}`);
    old.send({ type: 'resume', error });
    if (live.has(next)) next.kill();
    state = { phase: 'serving', worker: old, since: options.now() };
  }

  function bootError(worker: WorkerHandle, code: number | null): string {
    return (
      bootErrors.get(worker) ??
      `The new server exited${code === null ? '' : ` with code ${String(code)}`} before it was ready.`
    );
  }

  return {
    start() {
      state = { phase: 'booting', worker: fork() };
    },

    message(worker, message) {
      switch (message.type) {
        case 'ready':
          if (state.phase === 'booting' && state.worker === worker) {
            everServed = true;
            state = { phase: 'serving', worker, since: options.now() };
          } else if (state.phase === 'replacing' && state.next === worker) {
            state.deadline.cancel();
            state.old.send({ type: 'retire' });
            options.log('Reloaded: the new server is serving and the old one is retiring.');
            state = { phase: 'serving', worker, since: options.now() };
          }
          return;

        case 'boot-failed':
          bootErrors.set(worker, message.error);
          if (state.phase === 'replacing' && state.next === worker) {
            keepOld(state.old, worker, message.error);
          }
          return;

        case 'reload':
          if (state.phase === 'serving' && state.worker === worker) {
            options.log('Reloading: the running server is draining.');
            worker.send({ type: 'drain' });
            state = { phase: 'draining', old: worker };
          }
          return;

        case 'drained':
          if (state.phase === 'draining' && state.old === worker) {
            const next = fork();
            const deadline = options.schedule(() => {
              keepOld(worker, next, 'The new server did not start in time.');
            }, RELOAD_BOOT_MS);
            state = { phase: 'replacing', old: worker, next, deadline };
          }
          return;
      }
    },

    exited(worker, code) {
      live.delete(worker);
      const error = bootError(worker, code);
      bootErrors.delete(worker);

      switch (state.phase) {
        case 'stopping':
          if (live.size === 0) options.exit(0);
          return;

        case 'booting':
          if (state.worker !== worker) return;
          if (!everServed) {
            options.log(error);
            options.exit(1);
            return;
          }
          respawnLater(`The server did not start: ${error}`);
          return;

        case 'serving':
          if (state.worker !== worker) return;
          if (options.now() - state.since >= STABLE_MS) crashes = 0;
          respawnLater(`The server exited${code === null ? '' : ` with code ${String(code)}`}`);
          return;

        case 'draining':
          if (state.old === worker) respawnLater('The server exited while it drained');
          return;

        case 'replacing':
          if (state.next === worker) {
            keepOld(state.old, worker, error);
          } else if (state.old === worker) {
            state.deadline.cancel();
            state = { phase: 'booting', worker: state.next };
          }
          return;

        case 'waiting':
          return;
      }
    },

    stop() {
      if (state.phase === 'waiting') state.timer.cancel();
      if (state.phase === 'replacing') state.deadline.cancel();
      state = { phase: 'stopping' };
      if (live.size === 0) {
        options.exit(0);
        return;
      }
      for (const worker of live) worker.send({ type: 'shutdown' });
      options.schedule(() => {
        for (const worker of live) worker.kill();
      }, SHUTDOWN_MS);
    },
  };
}

/**
 * Run the supervisor over `node:cluster` workers, each of which runs this
 * same command. SIGTERM and SIGINT reach the supervisor, which is the process
 * an image's init signals.
 */
export function superviseCluster(): void {
  const supervisor = createSupervisor({
    fork() {
      const worker = cluster.fork();
      const handle: WorkerHandle = {
        id: worker.id,
        send(message) {
          if (worker.isConnected()) worker.send(message);
        },
        kill() {
          worker.process.kill('SIGKILL');
        },
      };
      worker.on('message', (message: unknown) => {
        if (isWorkerMessage(message)) supervisor.message(handle, message);
      });
      worker.on('exit', (code: number | null) => {
        supervisor.exited(handle, code);
      });
      return handle;
    },
    schedule(task, ms) {
      const timer = setTimeout(task, ms);
      return { cancel: () => clearTimeout(timer) };
    },
    now: () => Date.now(),
    log: (line) => process.stderr.write(`${line}\n`),
    exit: (code) => process.exit(code),
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => supervisor.stop());
  }
  supervisor.start();
}
