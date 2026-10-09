/**
 * The worker's half of `geekity serve`'s supervision (TASK-288): the
 * {@link Supervision} the Plugins screen asks for a reload, and the answers
 * to what the supervisor tells this worker to do.
 */

import type { Cms } from '../index.ts';
import { pluginsFingerprint } from '../plugins/folder.ts';
import type { PluginFolder } from '../plugins/folder.ts';
import { EXIT_FOR_REPLACEMENT, isSupervisorMessage } from './protocol.ts';
import type { SupervisorMessage, WorkerMessage } from './protocol.ts';
import type { ReloadOutcome, Supervision } from './supervision.ts';

export interface WorkerChannel {
  send(message: WorkerMessage, sent?: () => void): void;
  onMessage(handler: (message: SupervisorMessage) => void): void;
  /** The supervisor went away without saying so. */
  onDisconnect(handler: () => void): void;
}

export interface SupervisedWorker {
  readonly supervision: Supervision;
  /** The CMS listens: tell the supervisor, and do what it says from here on. */
  serving(cms: Pick<Cms, 'drain' | 'resume' | 'close'>): void;
}

export function superviseWorker(options: {
  channel: WorkerChannel;
  loaded: readonly PluginFolder[];
  exit: (code: number) => void;
  log: (line: string) => void;
}): SupervisedWorker {
  const { channel, exit, log } = options;
  let pending:
    { promise: Promise<ReloadOutcome>; resolve: (outcome: ReloadOutcome) => void } | undefined;
  let lastFailure: string | undefined;

  function settle(outcome: ReloadOutcome): void {
    pending?.resolve(outcome);
    pending = undefined;
  }

  const supervision: Supervision = {
    loaded: options.loaded,
    get lastFailure() {
      return lastFailure;
    },
    reload() {
      if (pending === undefined) {
        let resolve: (outcome: ReloadOutcome) => void = () => undefined;
        const promise = new Promise<ReloadOutcome>((done) => {
          resolve = done;
        });
        pending = { promise, resolve };
        channel.send({ type: 'reload' });
      }
      return pending.promise;
    },
  };

  return {
    supervision,

    serving(cms) {
      let closing: Promise<void> | undefined;
      let exitCode: number | undefined;
      let disconnected = false;
      const close = (): Promise<void> => {
        closing ??= cms
          .close()
          .then(
            () => 0,
            (error: unknown) => {
              log(`The server did not close cleanly: ${messageOf(error)}`);
              return 1;
            },
          )
          .then((code) => {
            exitCode = code;
            if (disconnected) exit(code);
            else channel.send({ type: 'closed' });
          });
        return closing;
      };

      channel.onMessage((message) => {
        void (async () => {
          switch (message.type) {
            case 'drain':
              try {
                await cms.drain();
              } catch (error) {
                log(`The server could not drain for a reload: ${messageOf(error)}`);
                exit(EXIT_FOR_REPLACEMENT);
                return;
              }
              channel.send({ type: 'drained' });
              return;
            case 'resume':
              lastFailure = message.error;
              await cms.resume();
              settle({ ok: false, error: message.error });
              return;
            case 'retire': {
              // Close before answering the request that asked for the reload,
              // so the page it redirects to is asked of the new worker.
              const closing = close();
              settle({ ok: true });
              await closing;
              return;
            }
            case 'shutdown':
              await close();
              return;
            case 'exit':
              exit(exitCode ?? 0);
              return;
          }
        })();
      });
      channel.onDisconnect(() => {
        disconnected = true;
        if (exitCode === undefined) void close();
        else exit(exitCode);
      });
      channel.send({ type: 'ready', pluginsFingerprint: pluginsFingerprint(options.loaded) });
    },
  };
}

/** This process's IPC channel to the supervisor that forked it. */
export function processChannel(): WorkerChannel {
  return {
    send(message, sent) {
      process.send?.(message, undefined, {}, () => sent?.());
    },
    onMessage(handler) {
      process.on('message', (message: unknown) => {
        if (isSupervisorMessage(message)) handler(message);
      });
    },
    onDisconnect(handler) {
      process.on('disconnect', handler);
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
