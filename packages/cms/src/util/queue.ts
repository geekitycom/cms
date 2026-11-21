export interface SerialQueue {
  run<T>(job: () => Promise<T>): Promise<T>;
  settled(): Promise<void>;
  pending(): number;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let count = 0;

  return {
    run(job) {
      count += 1;
      const result = tail.then(job).finally(() => {
        count -= 1;
      });
      tail = result.then(ignore, ignore);
      return result;
    },

    async settled() {
      while (count > 0) await tail;
    },

    pending() {
      return count;
    },
  };
}

/** Runs jobs at most `limit` at a time, the rest waiting their turn in order. */
export interface ConcurrencyLimit {
  run<T>(job: () => Promise<T>): Promise<T>;
}

export function createConcurrencyLimit(limit: number): ConcurrencyLimit {
  let running = 0;
  const waiting: (() => void)[] = [];

  return {
    async run(job) {
      if (running >= limit) {
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
      }
      running += 1;
      try {
        return await job();
      } finally {
        running -= 1;
        waiting.shift()?.();
      }
    },
  };
}

/** A {@link ConcurrencyLimit} for each key, kept only while it has a job running or waiting. */
export interface KeyedConcurrencyLimit {
  run<T>(key: string, job: () => Promise<T>): Promise<T>;
}

export function createKeyedConcurrencyLimit(limit: number): KeyedConcurrencyLimit {
  const limits = new Map<string, { limit: ConcurrencyLimit; jobs: number }>();

  return {
    async run(key, job) {
      const held = limits.get(key) ?? { limit: createConcurrencyLimit(limit), jobs: 0 };
      limits.set(key, held);
      held.jobs += 1;
      try {
        return await held.limit.run(job);
      } finally {
        held.jobs -= 1;
        if (held.jobs === 0) limits.delete(key);
      }
    },
  };
}

function ignore(): void {}
