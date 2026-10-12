/**
 * Waiting in a test for the event it is really waiting for, rather than for
 * time to pass (TASK-371).
 */

/**
 * Long enough that only a test whose event is not coming ever waits it out:
 * the wait ends the moment the event arrives, so the bound costs nothing on a
 * busy machine and turns a missing event into a failure instead of a hang.
 */
export const EVENT_TIMEOUT_MS = 15_000;

/**
 * Subscribe with `listen`, and resolve with the value it hands `done`. `fail`
 * ends the wait at once, for a listener that learns the event cannot come
 * (the process it watches exited). `listen` returns the function that
 * unsubscribes, which runs however the wait ends.
 */
export function nextEvent<T = void>(
  what: string,
  listen: (done: (value: T) => void, fail: (error: Error) => void) => (() => void) | void,
  timeoutMs = EVENT_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let ended = false;
    let stop = (): void => undefined;
    const timer = setTimeout(() => {
      end();
      reject(new Error(`${what} never came within ${String(timeoutMs)} ms`));
    }, timeoutMs);

    function end(): void {
      ended = true;
      clearTimeout(timer);
      stop();
    }

    const unsubscribe = listen(
      (value) => {
        if (ended) return;
        end();
        resolve(value);
      },
      (error) => {
        if (ended) return;
        end();
        reject(new Error(`${what}: ${error.message}`));
      },
    );
    stop = () => unsubscribe?.();
    if (ended) stop();
  });
}
