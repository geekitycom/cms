/** Jobs run one at a time, in the order they were queued. */
export interface SerialQueue {
  /**
   * Queue a job. The promise settles as the job does; a job that rejects
   * hands its rejection to this caller and does not hold up the next one.
   */
  run<T>(job: () => Promise<T>): Promise<T>;
  /** Resolve once the queue is empty, including jobs queued while it drains. */
  settled(): Promise<void>;
  /** Jobs queued and not yet finished, the running one included. */
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

function ignore(): void {
  // The caller of `run` has the job's outcome; the queue only needs it over.
}
