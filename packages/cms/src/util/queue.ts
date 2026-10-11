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

function ignore(): void {}
