/**
 * `geekity serve`'s supervisor: the primary process
 * that owns the port and runs the CMS in one worker, replacing it on a reload
 * and respawning it when it crashes.
 *
 * The port stays open only while some worker listens on it, so a reload
 * starts the new worker before it retires the old one. And only one worker
 * writes at a time: the old one drains (refuses writes, stops its timers,
 * empties its queues, goes read-only) before the new one is forked, so the
 * new worker's boot migrations run alone.
 *
 * This module is the state machine alone. The workers, the clock, the folder
 * and the process are handed in, so the order of a reload is tested without
 * starting a process; {@link superviseCluster} binds it to `node:cluster`.
 * The plugins folder watch and the requests waiting on a reload keep their
 * own state, in `plugin-watcher.ts` and `reload-queue.ts`.
 */

import cluster from 'node:cluster';

import { pluginFolderSignature, pluginsFingerprint, scanPluginFolders } from '../plugins/folder.ts';
import { listenForControl } from './control.ts';
import { createPluginWatcher } from './plugin-watcher.ts';
import type { PluginWatch } from './plugin-watcher.ts';
import { isWorkerMessage } from './protocol.ts';
import type { SupervisorMessage, WorkerMessage } from './protocol.ts';
import { createReloadQueue } from './reload-queue.ts';
import type { ReloadOutcome } from './supervision.ts';

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
  watch?: PluginWatch | 'off' | undefined;
}

export interface Supervisor {
  start(): void;
  message(worker: WorkerHandle, message: WorkerMessage): void;
  exited(worker: WorkerHandle, code: number | null): void;
  reload(): Promise<ReloadOutcome>;
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
  /**
   * The new worker did not boot and is being killed. The old one resumes once
   * it has exited, so that the old one's job recovery finds a job the new one
   * claimed cut off rather than still running.
   */
  | {
      readonly phase: 'abandoning';
      readonly old: WorkerHandle;
      readonly next: WorkerHandle;
      readonly error: string;
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
  const reloads = createReloadQueue();
  const plugins = createPluginWatcher({
    watch: options.watch === 'off' ? undefined : options.watch,
    schedule: (task, ms) => options.schedule(task, ms),
    now: () => options.now(),
    log: (line) => options.log(line),
    isServing: () => state.phase === 'serving',
    reload(folder) {
      if (state.phase === 'serving') beginReload(state.worker, folder);
    },
  });

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

  function beginReload(worker: WorkerHandle, folder = plugins.fingerprint()): void {
    options.log('Reloading: the running server is draining.');
    worker.send({ type: 'drain' });
    state = { phase: 'draining', old: worker };
    plugins.reloading(folder);
    reloads.begin();
  }

  function serve(worker: WorkerHandle, loaded: string | undefined): void {
    state = { phase: 'serving', worker, since: options.now() };
    if (loaded !== undefined) plugins.loaded(loaded);
    if (reloads.hasAsked()) beginReload(worker);
  }

  function keepOld(old: WorkerHandle, next: WorkerHandle, error: string): void {
    if (state.phase === 'replacing') state.deadline.cancel();
    if (live.has(next)) {
      next.kill();
      state = { phase: 'abandoning', old, next, error };
      return;
    }
    options.log(`Reload failed, so the running server carries on: ${error}`);
    old.send({ type: 'resume', error });
    plugins.failed();
    reloads.answer({ ok: false, error });
    serve(old, undefined);
  }

  function bootError(worker: WorkerHandle, code: number | null): string {
    return (
      bootErrors.get(worker) ??
      `The new server exited${code === null ? '' : ` with code ${String(code)}`} before it was ready.`
    );
  }

  return {
    start() {
      if (options.watch === 'off') {
        options.log(
          'The plugins folder is not watched: press Reload on the Plugins screen to load a change.',
        );
      }
      state = { phase: 'booting', worker: fork() };
      plugins.start();
    },

    message(worker, message) {
      switch (message.type) {
        case 'ready':
          if (state.phase === 'booting' && state.worker === worker) {
            everServed = true;
            reloads.answer({ ok: true });
            serve(worker, message.pluginsFingerprint);
          } else if (state.phase === 'replacing' && state.next === worker) {
            state.deadline.cancel();
            state.old.send({ type: 'retire' });
            options.log('Reloaded: the new server is serving and the old one is retiring.');
            reloads.answer({ ok: true });
            serve(worker, message.pluginsFingerprint);
          }
          return;

        case 'boot-failed':
          bootErrors.set(worker, message.error);
          if (state.phase === 'replacing' && state.next === worker) {
            keepOld(state.old, worker, message.error);
          }
          return;

        case 'reload':
          if (state.phase === 'serving' && state.worker === worker) beginReload(worker);
          return;

        case 'closed':
          worker.send({ type: 'exit' });
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
          if (state.old !== worker) return;
          respawnLater('The server exited while it drained');
          reloads.answer({ ok: false, error: 'The server exited while it drained.' });
          return;

        case 'replacing':
          if (state.next === worker) {
            keepOld(state.old, worker, error);
          } else if (state.old === worker) {
            state.deadline.cancel();
            state = { phase: 'booting', worker: state.next };
          }
          return;

        case 'abandoning':
          if (state.next === worker) {
            keepOld(state.old, worker, state.error);
          } else if (state.old === worker) {
            const failure = state.error;
            respawnLater('The server exited while a failed reload was undone');
            reloads.answer({ ok: false, error: failure });
          }
          return;

        case 'waiting':
          return;
      }
    },

    reload() {
      if (state.phase === 'stopping') {
        return Promise.resolve({ ok: false, error: 'The server is shutting down.' });
      }
      const outcome = reloads.ask();
      if (state.phase === 'serving') beginReload(state.worker);
      return outcome;
    },

    stop() {
      if (state.phase === 'waiting') state.timer.cancel();
      if (state.phase === 'replacing') state.deadline.cancel();
      plugins.stop();
      state = { phase: 'stopping' };
      reloads.answerAll({ ok: false, error: 'The server is shutting down.' });
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
 * an image's init signals. `geekity plugin` reaches it over the control
 * socket for `dataDir`.
 */
export function superviseCluster(options: {
  dataDir: string;
  pluginsDir: string | undefined;
  pluginWatch: boolean;
}): void {
  const { pluginsDir } = options;
  const log = (line: string) => process.stderr.write(`${line}\n`);
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
      // A message to a worker that is exiting fails with EPIPE; its exit
      // event follows and is what the supervisor acts on.
      worker.on('error', () => undefined);
      return handle;
    },
    schedule(task, ms) {
      const timer = setTimeout(task, ms);
      return { cancel: () => clearTimeout(timer) };
    },
    now: () => Date.now(),
    log,
    exit(code) {
      control.close();
      process.exit(code);
    },
    watch:
      pluginsDir === undefined
        ? undefined
        : !options.pluginWatch
          ? 'off'
          : {
              signature: () => pluginFolderSignature(pluginsDir),
              fingerprint: () => pluginsFingerprint(scanPluginFolders(pluginsDir)),
            },
  });
  const control = listenForControl({
    dataDir: options.dataDir,
    reload: () => supervisor.reload(),
    log,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => supervisor.stop());
  }
  supervisor.start();
}
