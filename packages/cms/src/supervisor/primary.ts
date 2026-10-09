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
 * This module is the state machine alone. The workers, the clock, the folder
 * and the process are handed in, so the order of a reload is tested without
 * starting a process; {@link superviseCluster} binds it to `node:cluster`.
 */

import cluster from 'node:cluster';

import { pluginFolderSignature, pluginsFingerprint, scanPluginFolders } from '../plugins/folder.ts';
import { listenForControl } from './control.ts';
import { isWorkerMessage } from './protocol.ts';
import type { SupervisorMessage, WorkerMessage } from './protocol.ts';
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

export interface PluginWatch {
  signature(): string;
  fingerprint(): string;
}

export interface SupervisorOptions {
  fork(): WorkerHandle;
  schedule(task: () => void, ms: number): Cancel;
  now(): number;
  log(line: string): void;
  exit(code: number): void;
  watch?: PluginWatch | undefined;
}

export interface Supervisor {
  start(): void;
  message(worker: WorkerHandle, message: WorkerMessage): void;
  exited(worker: WorkerHandle, code: number | null): void;
  reload(): Promise<ReloadOutcome>;
  /** SIGTERM or SIGINT: shut every worker down, then exit. */
  stop(): void;
}

export const PLUGIN_POLL_MS = 1_000;
export const PLUGIN_SETTLE_MS = 5_000;

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

  let loaded: string | undefined;
  let reloading: string | undefined;
  let failed: string | undefined;
  let waiting: ((outcome: ReloadOutcome) => void)[] = [];
  let queued: ((outcome: ReloadOutcome) => void)[] = [];
  let seen: { signature: string | undefined; since: number } = { signature: undefined, since: 0 };
  let compared: string | undefined;
  let polling: Cancel | undefined;

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

  function beginReload(worker: WorkerHandle, folder = fingerprint()): void {
    options.log('Reloading: the running server is draining.');
    worker.send({ type: 'drain' });
    state = { phase: 'draining', old: worker };
    reloading = folder;
    waiting = [...waiting, ...queued];
    queued = [];
  }

  function settle(outcome: ReloadOutcome): void {
    for (const done of waiting) done(outcome);
    waiting = [];
  }

  function serve(worker: WorkerHandle, plugins: string | undefined): void {
    state = { phase: 'serving', worker, since: options.now() };
    if (plugins !== undefined) loaded = plugins;
    if (queued.length > 0) beginReload(worker);
  }

  /** The new worker did not boot: the old one carries on, and is told why. */
  function keepOld(old: WorkerHandle, next: WorkerHandle, error: string): void {
    if (state.phase === 'replacing') state.deadline.cancel();
    options.log(`Reload failed, so the running server carries on: ${error}`);
    old.send({ type: 'resume', error });
    if (live.has(next)) next.kill();
    failed = reloading;
    settle({ ok: false, error });
    serve(old, undefined);
  }

  function fingerprint(): string | undefined {
    const { watch } = options;
    return watch === undefined ? undefined : attempt(() => watch.fingerprint());
  }

  function poll(watch: PluginWatch): void {
    polling = options.schedule(() => {
      look(watch);
      poll(watch);
    }, PLUGIN_POLL_MS);
  }

  function look(watch: PluginWatch): void {
    const signature = attempt(() => watch.signature());
    const now = options.now();
    if (signature === undefined || signature !== seen.signature) {
      seen = { signature, since: now };
      return;
    }
    if (state.phase !== 'serving' || signature === compared) return;
    if (now - seen.since < PLUGIN_SETTLE_MS) return;
    compared = signature;
    const folder = fingerprint();
    if (folder === undefined) {
      compared = undefined;
      return;
    }
    if (folder === loaded || folder === failed) return;
    options.log('The plugins folder changed and has settled.');
    beginReload(state.worker, folder);
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
      if (options.watch !== undefined) poll(options.watch);
    },

    message(worker, message) {
      switch (message.type) {
        case 'ready':
          if (state.phase === 'booting' && state.worker === worker) {
            everServed = true;
            settle({ ok: true });
            serve(worker, message.pluginsFingerprint);
          } else if (state.phase === 'replacing' && state.next === worker) {
            state.deadline.cancel();
            state.old.send({ type: 'retire' });
            options.log('Reloaded: the new server is serving and the old one is retiring.');
            settle({ ok: true });
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
          settle({ ok: false, error: 'The server exited while it drained.' });
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

    reload() {
      if (state.phase === 'stopping') {
        return Promise.resolve({ ok: false, error: 'The server is shutting down.' });
      }
      return new Promise<ReloadOutcome>((resolve) => {
        queued.push(resolve);
        if (state.phase === 'serving') beginReload(state.worker);
      });
    },

    stop() {
      if (state.phase === 'waiting') state.timer.cancel();
      if (state.phase === 'replacing') state.deadline.cancel();
      polling?.cancel();
      state = { phase: 'stopping' };
      waiting = [...waiting, ...queued];
      queued = [];
      settle({ ok: false, error: 'The server is shutting down.' });
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

function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
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
      pluginsDir === undefined || !options.pluginWatch
        ? undefined
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
