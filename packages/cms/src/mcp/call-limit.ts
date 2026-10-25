import type { Clock } from '../util/clock.ts';

/**
 * Whether one more call fits under the limit. A refusal says how many
 * seconds are left in the window, and whether it is the first refusal there,
 * so the caller can record a run of refusals once.
 */
export type LimitDecision =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'refused'; readonly retryAfter: number; readonly first: boolean };

export interface CallLimit {
  take(key: string): LimitDecision;
}

export interface CallLimitOptions {
  readonly calls: number;
  readonly windowSeconds: number;
  readonly now: Clock;
}

/**
 * A fixed window of calls per key, held in memory like the request limits in
 * `web/throttle.ts`: a restart clears it, which costs a looping client one
 * extra window at most.
 */
export function createCallLimit(options: CallLimitOptions): CallLimit {
  const window = options.windowSeconds * 1000;
  const windows = new Map<string, { count: number; endsAt: number }>();

  return {
    take(key) {
      const at = options.now().getTime();
      for (const [each, entry] of windows) {
        if (at >= entry.endsAt) windows.delete(each);
      }
      const entry = windows.get(key) ?? { count: 0, endsAt: at + window };
      entry.count += 1;
      windows.set(key, entry);
      if (entry.count <= options.calls) return { kind: 'allowed' };
      return {
        kind: 'refused',
        retryAfter: Math.max(1, Math.ceil((entry.endsAt - at) / 1000)),
        first: entry.count === options.calls + 1,
      };
    },
  };
}
