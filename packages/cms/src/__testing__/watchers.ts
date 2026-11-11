import fs from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

export function liveWatchers(): { watching(): boolean; restore(): void } {
  const original = fs.watch;
  const live = new Set<FSWatcher>();
  fs.watch = ((...args: Parameters<typeof fs.watch>) => {
    const opened = original(...args);
    live.add(opened);
    const close = opened.close.bind(opened);
    opened.close = () => {
      live.delete(opened);
      close();
    };
    return opened;
  }) as typeof fs.watch;
  syncBuiltinESMExports();
  return {
    watching: () => live.size > 0,
    restore() {
      fs.watch = original;
      syncBuiltinESMExports();
    },
  };
}

/**
 * Hold back every watch event whose filename `holds` picks until `release`,
 * the way a busy machine can report the two paths of one rename far apart.
 */
export function heldWatchEvents(holds: (filename: string) => boolean): {
  release(): void;
  restore(): void;
} {
  const original = fs.watch;
  const held: (() => void)[] = [];
  let holding = true;
  fs.watch = ((...args: Parameters<typeof fs.watch>) => {
    const opened = original(...args);
    const emit = opened.emit.bind(opened);
    opened.emit = (event: string | symbol, ...rest: unknown[]) => {
      if (holding && event === 'change' && holds(String(rest[1]))) {
        held.push(() => emit(event, ...rest));
        return true;
      }
      return emit(event, ...rest);
    };
    return opened;
  }) as typeof fs.watch;
  syncBuiltinESMExports();
  return {
    release() {
      holding = false;
      for (const deliver of held.splice(0)) deliver();
    },
    restore() {
      fs.watch = original;
      syncBuiltinESMExports();
    },
  };
}
