import fs from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

export function liveWatchers(): { live(): number; restore(): void } {
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
    live: () => live.size,
    restore() {
      fs.watch = original;
      syncBuiltinESMExports();
    },
  };
}
