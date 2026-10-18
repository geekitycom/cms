/** How long the watcher waits for a path to stop changing before re-reading it. */
const DEFAULT_DEBOUNCE_MS = 100;

/**
 * How the watcher waits for a changed path to stand still. It is called on
 * every event for `path` with the run that re-reads the path, and returns the
 * function that cancels that run, which the sync calls when the path changes
 * again before the run has gone ahead.
 */
export type WatchDebounce = (path: string, run: () => void) => () => void;

export function debounceFor(ms: number): WatchDebounce {
  return (_path, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  };
}

export const defaultWatchDebounce: WatchDebounce = debounceFor(DEFAULT_DEBOUNCE_MS);
