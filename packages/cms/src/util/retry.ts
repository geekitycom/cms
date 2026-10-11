export interface RetryOptions {
  /** How many tries in all. Fewer than one still tries once. */
  attempts: number;
  /** How long to wait after try `n` before the next. */
  backoffMs: (attempt: number) => number;
  /** How the wait is taken. Defaults to a timer; a test hands in a stub. */
  wait?: ((ms: number) => Promise<void>) | undefined;
}

/** What one try came to, and whether another could do better. */
export interface Tried<T> {
  readonly value: T;
  readonly retry: boolean;
}

/** Try until a try says to stop or the attempts run out, answering the last try's value. */
export async function retry<T>(
  options: RetryOptions,
  attemptOnce: (attempt: number) => Promise<Tried<T>>,
): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  const wait = options.wait ?? sleep;
  for (let attempt = 1; ; attempt += 1) {
    const tried = await attemptOnce(attempt);
    if (!tried.retry || attempt >= attempts) return tried.value;
    await wait(options.backoffMs(attempt));
  }
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
