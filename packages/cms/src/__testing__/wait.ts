export const EVENT_TIMEOUT_MS = 15_000;

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
