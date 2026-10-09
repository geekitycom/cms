/**
 * What a CMS running under `geekity serve`'s supervisor knows about it
 * (TASK-288): which plugin folders it loaded, how to ask for a reload, and
 * why the last one failed.
 */

import type { PluginFolder } from '../plugins/folder.ts';

export type ReloadOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface Supervision {
  /** The plugin folders this worker loaded at boot. */
  readonly loaded: readonly PluginFolder[];
  /**
   * Ask the supervisor for a new worker. Resolves once the new worker serves,
   * when this one is about to retire, or with why it did not boot, when this
   * one carries on.
   */
  reload(): Promise<ReloadOutcome>;
  /** Why this worker's last reload failed, or `undefined`. */
  readonly lastFailure: string | undefined;
}

export function leavingWriteGate(
  supervision: Supervision | undefined,
  leave: () => void,
): Supervision | undefined {
  if (supervision === undefined) return undefined;
  return {
    loaded: supervision.loaded,
    get lastFailure() {
      return supervision.lastFailure;
    },
    reload() {
      leave();
      return supervision.reload();
    },
  };
}
