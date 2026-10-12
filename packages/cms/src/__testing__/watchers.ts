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
